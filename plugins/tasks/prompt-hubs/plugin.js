const ASPECT_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];

const MODEL_RULES = {
  minimax_h3: {
    minSeconds: 4,
    maxSeconds: 15,
    resolutions: ["768", "1080p", "2K", "4K"],
    referenceRequiredFor: ["2K", "4K"],
  },
  "MiniMax-H3-漫剧优化": {
    minSeconds: 4,
    maxSeconds: 15,
    resolutions: ["768", "2K", "4K"],
  },
  "MiniMax-H3-量化版": {
    minSeconds: 4,
    maxSeconds: 10,
    resolutions: ["768"],
  },
  "MiniMax-H3-四步采样版": {
    minSeconds: 4,
    maxSeconds: 15,
    resolutions: ["768", "1080p"],
  },
};

const MODEL_IDS = Object.keys(MODEL_RULES);

function resolutionSchema(resolutions) {
  const enumLabels = {};
  for (const resolution of resolutions) enumLabels[resolution] = { en: resolution, zh: resolution };
  return {
    enum: resolutions.slice(),
    enumLabels: enumLabels,
    description: { en: "Output video resolution", zh: "输出视频分辨率" },
  };
}

function usageSchemaFor(resolutions) {
  return {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video generation unit price", zh: "视频生成单价" },
    },
    resolution: resolutionSchema(resolutions),
  };
}

function examplesFor(model, rule) {
  const highResolution = rule.resolutions[rule.resolutions.length - 1];
  return [
    { label: model + " " + rule.minSeconds + "s " + rule.resolutions[0], facts: { seconds: rule.minSeconds, resolution: rule.resolutions[0] } },
    { label: model + " " + rule.maxSeconds + "s " + highResolution, facts: { seconds: rule.maxSeconds, resolution: highResolution } },
  ];
}

export const meta = {
  apiVersion: 1,
  key: "prompt-hubs",
  name: "Prompt Hubs Video",
  icon: "Video",
  description: {
    en: "Prompt Hubs asynchronous MiniMax video generation",
    zh: "Prompt Hubs 异步 MiniMax 视频生成",
  },
  version: "1.0.2",
  author: { name: "Skye" },
  baseUrl: "https://console.prompt-hubs.com",
  models: MODEL_IDS,
  fetchMode: "per_task",
  usageSchema: usageSchemaFor(MODEL_RULES.minimax_h3.resolutions),
  usageExamples: examplesFor("minimax_h3", MODEL_RULES.minimax_h3),
  usageProfiles: MODEL_IDS.map(function (model) {
    return {
      models: [model],
      schema: usageSchemaFor(MODEL_RULES[model].resolutions),
      examples: examplesFor(model, MODEL_RULES[model]),
    };
  }),
  protocols: [{ name: "openai_responses", supports: ["stream", "sync", "background"] }, "openai_video"],
};

function trimmed(value) {
  return typeof value === "string" ? value.trim() : value === undefined || value === null ? "" : String(value).trim();
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function providerURL(ctx, path) {
  const baseURL = trimmed(ctx && ctx.baseUrl) || meta.baseUrl;
  return baseURL.replace(/\/+$/, "") + path;
}

function ruleFor(model) {
  const rule = MODEL_RULES[trimmed(model)];
  if (!rule) throw new Error("Prompt Hubs does not support model " + trimmed(model));
  return rule;
}

function metadataFor(req) {
  const metadata = req && req.metadata;
  if (metadata === undefined || metadata === null || metadata === "") return {};
  if (!isObject(metadata)) throw new Error("metadata must be an object");
  return metadata;
}

function rejectUnsupportedFields(req, metadata) {
  for (const field of ["quality", "ratio", "n"]) {
    if ((hasOwn(req, field) && req[field] !== undefined && req[field] !== null) || (hasOwn(metadata, field) && metadata[field] !== undefined && metadata[field] !== null)) {
      throw new Error("Prompt Hubs does not support " + field);
    }
  }
}

function durationFor(req, rule, model) {
  let raw;
  if (hasOwn(req, "seconds")) raw = req.seconds;
  else if (hasOwn(req, "duration")) raw = req.duration;
  if (raw === undefined || raw === null || raw === "") return rule.minSeconds;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < rule.minSeconds || seconds > rule.maxSeconds) {
    throw new Error(model + " seconds must be an integer between " + rule.minSeconds + " and " + rule.maxSeconds);
  }
  return seconds;
}

function resolutionFor(req, metadata, rule, model) {
  let raw;
  if (hasOwn(req, "size")) raw = req.size;
  else if (hasOwn(req, "resolution")) raw = req.resolution;
  else raw = metadata.resolution;
  if (raw === undefined || raw === null || trimmed(raw) === "") return "768";
  const normalized = { "768": "768", "1080p": "1080p", "2k": "2K", "4k": "4K" }[trimmed(raw).toLowerCase()];
  if (!normalized || rule.resolutions.indexOf(normalized) < 0) {
    throw new Error(model + " resolution must be one of " + rule.resolutions.join(", "));
  }
  return normalized;
}

function aspectRatioFor(req, metadata) {
  const ratio = trimmed(req.aspect_ratio) || trimmed(metadata.aspect_ratio) || "16:9";
  if (ASPECT_RATIOS.indexOf(ratio) < 0) throw new Error("aspect_ratio must be one of " + ASPECT_RATIOS.join(", "));
  return ratio;
}

function appendUnique(target, values) {
  for (const value of values) {
    if (target.indexOf(value) < 0) target.push(value);
  }
  return target;
}

function parseReferenceJSON(value, field) {
  const text = trimmed(value);
  if (!text || (text[0] !== "[" && text[0] !== "{")) return value;
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(field + " must contain public HTTP(S) URLs");
  }
}

function referenceValues(value, field) {
  const result = [];
  const append = function (item) {
    if (item === undefined || item === null || item === "") return;
    if (typeof item === "string") {
      const parsed = parseReferenceJSON(item, field);
      if (parsed !== item) {
        append(parsed);
        return;
      }
      const url = trimmed(item);
      if (!url) return;
      result.push(url);
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) append(child);
      return;
    }
    if (isObject(item) && typeof item.url === "string") {
      append(item.url);
      return;
    }
    throw new Error(field + " must contain public HTTP(S) URLs");
  };
  append(value);
  return result;
}

function hostFromURL(value) {
  const match = /^https?:\/\/([^/?#:]+|\[[0-9a-fA-F:.]+\])(?::\d{1,5})?(?:[/?#]|$)/i.exec(value);
  if (!match) return "";
  return match[1].replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function isPrivateIPv4(host) {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const values = parts.map(function (part) {
    return /^\d+$/.test(part) ? Number(part) : NaN;
  });
  if (values.some(function (part) { return !Number.isInteger(part) || part < 0 || part > 255; })) return false;
  return (
    values[0] === 0 ||
    values[0] === 10 ||
    values[0] === 127 ||
    (values[0] === 169 && values[1] === 254) ||
    (values[0] === 172 && values[1] >= 16 && values[1] <= 31) ||
    (values[0] === 192 && values[1] === 168)
  );
}

function isPublicHTTPURL(value) {
  const url = trimmed(value);
  const host = hostFromURL(url);
  if (!host || host === "localhost" || host.endsWith(".localhost") || isPrivateIPv4(host)) return false;
  const normalizedIPv6 = host.toLowerCase();
  if (normalizedIPv6 === "::1" || normalizedIPv6.startsWith("fc") || normalizedIPv6.startsWith("fd") || normalizedIPv6.startsWith("fe80")) return false;
  return true;
}

function referencesFor(req, metadata, inputReferences) {
  const aliases = {
    images: ["reference_images", "referenceImages", "reference_image", "referenceImage"],
    videos: ["reference_videos", "referenceVideos", "reference_video", "referenceVideo"],
    audios: ["reference_audios", "referenceAudios", "reference_audio", "referenceAudio"],
  };
  const references = { images: [], videos: [], audios: [] };
  for (const kind of Object.keys(aliases)) {
    const field = "reference_" + kind;
    for (const alias of aliases[kind]) {
      if (hasOwn(req, alias)) appendUnique(references[kind], referenceValues(req[alias], field));
      if (hasOwn(metadata, alias)) appendUnique(references[kind], referenceValues(metadata[alias], field));
    }
    if (inputReferences && Array.isArray(inputReferences[kind])) appendUnique(references[kind], inputReferences[kind]);
  }
  const limits = { images: 9, videos: 3, audios: 3 };
  for (const kind of Object.keys(limits)) {
    if (references[kind].length > limits[kind]) throw new Error("Prompt Hubs accepts at most " + limits[kind] + " reference " + kind);
    for (const value of references[kind]) {
      if (!isPublicHTTPURL(value)) throw new Error("reference_" + kind + " must contain public HTTP(S) URLs");
    }
  }
  const total = references.images.length + references.videos.length + references.audios.length;
  if (total > 12) throw new Error("Prompt Hubs accepts at most 12 reference media items");
  return references;
}

function normalizeRequest(req, publicModel, upstreamModel, input) {
  if (!isObject(req)) throw new Error("request body must be an object");
  const model = trimmed(publicModel) || trimmed(req.model);
  if (!model) throw new Error("model is required");
  const executingModel = trimmed(upstreamModel) || model;
  const rule = ruleFor(executingModel);
  const metadata = metadataFor(req);
  rejectUnsupportedFields(req, metadata);
  const prompt = trimmed((input && input.prompt) || req.prompt);
  if (!prompt) throw new Error("prompt is required");
  const references = referencesFor(req, metadata, input && input.references);
  const duration = durationFor(req, rule, executingModel);
  const resolution = resolutionFor(req, metadata, rule, executingModel);
  if (rule.referenceRequiredFor && rule.referenceRequiredFor.indexOf(resolution) >= 0) {
    const count = references.images.length + references.videos.length + references.audios.length;
    if (count === 0) throw new Error(executingModel + " " + resolution + " requires at least one reference media URL");
  }
  const normalizedMetadata = { aspect_ratio: aspectRatioFor(req, metadata) };
  if (references.images.length) normalizedMetadata.reference_images = references.images;
  if (references.videos.length) normalizedMetadata.reference_videos = references.videos;
  if (references.audios.length) normalizedMetadata.reference_audios = references.audios;
  return {
    model: model,
    prompt: prompt,
    duration: duration,
    size: resolution,
    metadata: normalizedMetadata,
  };
}

function submitModel(ctx, req) {
  return trimmed(ctx && ctx.upstreamModel) || trimmed(req && req.model);
}

function actionFor(req) {
  const metadata = (req && req.metadata) || {};
  return (metadata.reference_images && metadata.reference_images.length) || (metadata.reference_videos && metadata.reference_videos.length)
    ? "image_to_video"
    : "text_to_video";
}

export function buildSubmitRequest(ctx) {
  const request = normalizeRequest((ctx && ctx.requestBody) || {}, ctx && ctx.model, ctx && ctx.upstreamModel);
  const upstreamModel = submitModel(ctx, request);
  const metadata = request.metadata;
  const body = {
    model: upstreamModel,
    prompt: request.prompt,
    duration_seconds: request.duration,
    resolution: request.size,
    aspect_ratio: metadata.aspect_ratio,
  };
  if (metadata.reference_images && metadata.reference_images.length) body.reference_images = metadata.reference_images;
  if (metadata.reference_videos && metadata.reference_videos.length) body.reference_videos = metadata.reference_videos;
  if (metadata.reference_audios && metadata.reference_audios.length) body.reference_audios = metadata.reference_audios;
  return {
    url: providerURL(ctx, "/v1/videos"),
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + trimmed(ctx && ctx.apiKey) },
    body: body,
    action: actionFor(request),
  };
}

function errorMessage(body) {
  if (!isObject(body)) return "";
  if (isObject(body.error)) return trimmed(body.error.message) || trimmed(body.error.reason) || trimmed(body.error.code);
  return trimmed(body.error) || trimmed(body.message) || trimmed(body.reason);
}

function taskID(body) {
  for (const key of ["id", "task_id"]) {
    if (typeof body[key] === "string" && trimmed(body[key])) return trimmed(body[key]);
  }
  return "";
}

export function parseSubmitResponse(_ctx, resp) {
  const body = resp && resp.body;
  if (!isObject(body)) throw new Error("Prompt Hubs submit response must be a JSON object");
  const id = taskID(body);
  if (!id) {
    const message = errorMessage(body);
    if (message) throw new Error("Prompt Hubs submit failed: " + message);
    throw new Error("Prompt Hubs submit response is missing id/task_id");
  }
  return { taskId: id, taskData: body };
}

export function extractUsage(ctx) {
  if (ctx && ctx.usagePurpose === "billing_ratios") return null;
  const request = normalizeRequest((ctx && ctx.requestBody) || {}, ctx && ctx.model, ctx && ctx.upstreamModel);
  return { seconds: request.duration, resolution: request.size };
}

export function buildQueryRequest(ctx) {
  return {
    url: providerURL(ctx, "/v1/videos/" + encodeURIComponent(trimmed(ctx && ctx.taskId))),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + trimmed(ctx && ctx.apiKey) },
  };
}

function resultObject(body) {
  if (!isObject(body)) return null;
  if (!trimmed(body.status) && isObject(body.data)) return body.data;
  return body;
}

function videoURL(body) {
  const result = resultObject(body);
  if (!result) return "";
  const outputs = Array.isArray(result.outputs) ? result.outputs : [];
  const first = outputs.length && isObject(outputs[0]) ? outputs[0] : {};
  for (const value of [result.video_url, result.result_url, first.content_url, first.download_url]) {
    const url = trimmed(value);
    if (url) return url;
  }
  return "";
}

function progressFor(value, status) {
  if (status === "SUCCESS" || status === "FAILURE") return "100%";
  const raw = trimmed(value);
  if (!raw) return "0%";
  const numeric = Number(raw.replace(/%$/, ""));
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return "0%";
  return String(numeric) + "%";
}

export function parseTaskResult(_ctx, body) {
  const resultBody = resultObject(body);
  if (!resultBody) throw new Error("Prompt Hubs task response must be a JSON object");
  const rawStatus = trimmed(resultBody.status).toLowerCase();
  const statuses = {
    queued: "IN_PROGRESS",
    processing: "IN_PROGRESS",
    running: "IN_PROGRESS",
    in_progress: "IN_PROGRESS",
    completed: "SUCCESS",
    succeeded: "SUCCESS",
    failed: "FAILURE",
    cancelled: "FAILURE",
    canceled: "FAILURE",
  };
  const status = statuses[rawStatus];
  if (!status) {
    const message = errorMessage(resultBody);
    if (message) return { status: "FAILURE", progress: "100%", reason: message };
    return { status: "UNKNOWN", reason: "unrecognized status: " + rawStatus };
  }
  const task = { status: status, progress: progressFor(resultBody.progress, status) };
  if (status === "SUCCESS") {
    const url = videoURL(resultBody);
    if (url) task.url = url;
  }
  if (status === "FAILURE") task.reason = errorMessage(resultBody) || "task " + rawStatus;
  return task;
}

function artifactResult(ctx) {
  return resultObject(ctx && ctx.data);
}

export function listArtifacts(task) {
  return task && task.status === "SUCCESS" && videoURL(task.data) ? [{ key: "video", type: "video", mimeType: "video/mp4" }] : [];
}

export function buildContentRequest(ctx) {
  if (!ctx || ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  const upstreamTaskId = trimmed(ctx && ctx.upstreamTaskId);
  if (!upstreamTaskId) throw new Error("artifact_not_found");
  const method = trimmed(ctx.clientRequest && ctx.clientRequest.method).toUpperCase();
  return {
    // Status responses contain expiring signed media URLs. The task content
    // endpoint resolves a fresh artifact for the persisted upstream task ID.
    url: providerURL(ctx, "/v1/videos/" + encodeURIComponent(upstreamTaskId) + "/content"),
    method: method === "HEAD" ? "GET" : method || "GET",
    headers: { Authorization: "Bearer " + trimmed(ctx && ctx.apiKey) },
    dropCredentialsOnRedirect: true,
  };
}

export function extractUsageOnComplete(_task, _taskResult, _body) {
  return null;
}

function responseInput(input) {
  const texts = [];
  const references = { images: [], videos: [], audios: [] };
  const appendURL = function (kind, value) {
    let url = value;
    if (isObject(url)) url = url.url;
    url = trimmed(url);
    if (url) appendUnique(references[kind], [url]);
  };
  const consumePart = function (part) {
    if (typeof part === "string") {
      if (trimmed(part)) texts.push(trimmed(part));
      return;
    }
    if (!isObject(part)) return;
    if (part.type === "input_text" || part.type === "text") {
      if (trimmed(part.text)) texts.push(trimmed(part.text));
      return;
    }
    if (part.type === "input_image" || part.type === "image_url") {
      appendURL("images", part.image_url || part.url);
      return;
    }
    if (part.type === "input_video" || part.type === "video_url") {
      appendURL("videos", part.video_url || part.url);
      return;
    }
    if (part.type === "input_audio" || part.type === "audio_url") appendURL("audios", part.audio_url || part.url);
  };
  const consumeItem = function (item) {
    if (typeof item === "string") {
      consumePart(item);
      return;
    }
    if (!isObject(item)) return;
    if (item.content !== undefined) {
      const content = Array.isArray(item.content) ? item.content : [item.content];
      for (const part of content) consumePart(part);
      return;
    }
    consumePart(item);
  };
  if (typeof input === "string") consumePart(input);
  else if (Array.isArray(input)) for (const item of input) consumeItem(item);
  return { prompt: texts.join("\n"), references: references };
}

function decodeResponsesRequest(ctx) {
  if (!ctx || !ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
  const req = ctx.body.value;
  if (!isObject(req)) throw new Error("request body must be an object");
  if (req.input !== undefined && typeof req.input !== "string" && !Array.isArray(req.input)) throw new Error("input must be a string or array");
  const publicModel = trimmed(ctx.model) || trimmed(req.model);
  const request = normalizeRequest(req, publicModel, ctx.upstreamModel, responseInput(req.input));
  return { kind: "submit", model: publicModel, action: actionFor(request), requestBody: request };
}

function parseMultipartRequest(ctx) {
  const fields = ctx.body.fields || {};
  const referenceFields = [
    "reference_images",
    "referenceImages",
    "reference_image",
    "referenceImage",
    "reference_videos",
    "referenceVideos",
    "reference_video",
    "referenceVideo",
    "reference_audios",
    "referenceAudios",
    "reference_audio",
    "referenceAudio",
  ];
  const req = {};
  for (const name of Object.keys(fields)) {
    const values = Array.isArray(fields[name]) ? fields[name] : [];
    if (referenceFields.indexOf(name) >= 0) {
      req[name] = values.slice();
      continue;
    }
    if (values.length !== 1) throw new Error(name + " must be provided once");
    req[name] = values[0];
  }
  if ((ctx.body.files || []).length) throw new Error("Prompt Hubs requires reference media to be public HTTP(S) URLs");
  if (req.metadata !== undefined) {
    if (typeof req.metadata !== "string") throw new Error("metadata must be a JSON object string");
    try {
      req.metadata = JSON.parse(req.metadata);
    } catch (_error) {
      throw new Error("metadata must be a JSON object string");
    }
    if (!isObject(req.metadata)) throw new Error("metadata must be a JSON object string");
  }
  return req;
}

function decodeVideoRequest(ctx) {
  if (!ctx || !ctx.body || (ctx.body.kind !== "json" && ctx.body.kind !== "multipart")) throw new Error("JSON or multipart body required");
  let req;
  if (ctx.body.kind === "json") {
    if (!isObject(ctx.body.value)) throw new Error("JSON object required");
    req = ctx.body.value;
  } else {
    req = parseMultipartRequest(ctx);
  }
  const publicModel = trimmed(ctx.model) || trimmed(req.model);
  const request = normalizeRequest(req, publicModel, ctx.upstreamModel);
  return { kind: "submit", model: publicModel, action: actionFor(request), requestBody: request };
}

function videoText(ctx) {
  const artifact = ctx && ctx.artifacts && ctx.artifacts.video;
  const url = trimmed(artifact && artifact.url);
  if (!url) throw new Error("video artifact is unavailable");
  const escaped = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return '<video controls src="' + escaped + '"></video>';
}

export const protocols = {
  openai_responses: {
    decodeRequest: decodeResponsesRequest,
    renderEvents: function (ctx, task, previousState) {
      const status = trimmed(task && task.status).toUpperCase() || "UNKNOWN";
      const numeric = Number(trimmed(task && task.progress).replace(/%$/, ""));
      const progress = Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : null;
      const state = { status: status, progress: progress };
      if (status === "SUCCESS") {
        const events = previousState && previousState.status === status ? [] : [{ type: "output", data: videoText(ctx) }];
        return { events: events, state: state, done: true };
      }
      if (status === "FAILURE") {
        return { events: [{ type: "error", code: "task_failed", message: trimmed(task && task.fail_reason) || "task failed" }], state: state, done: true };
      }
      if (previousState && previousState.status === status && previousState.progress === progress) return { events: [], state: state, done: false };
      const event = { type: "progress", message: status.toLowerCase() };
      if (progress !== null) event.progress = progress;
      return { events: [event], state: state, done: false };
    },
    renderFinal: function (ctx, _task) {
      return {
        output: [
          {
            type: "message",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: videoText(ctx), annotations: [], logprobs: [] }],
          },
        ],
        metadata: { vendor: "prompt-hubs" },
      };
    },
  },
};

protocols.openai_video = {
  decodeRequest: decodeVideoRequest,
  render: function (_ctx, task) {
    const statuses = { NOT_START: "queued", SUBMITTED: "queued", QUEUED: "queued", IN_PROGRESS: "in_progress", SUCCESS: "completed", FAILURE: "failed" };
    const output = {
      id: task.task_id,
      object: "video",
      model: task.properties && task.properties.origin_model_name ? task.properties.origin_model_name : "",
      status: statuses[task.status] || "unknown",
      progress: Number(trimmed(task.progress).replace(/%$/, "")) || 0,
      created_at: task.created_at,
    };
    if (task.updated_at) output.completed_at = task.updated_at;
    if (task.status === "FAILURE") output.error = { message: trimmed(task.fail_reason) || "task failed", code: "task_failed" };
    return output;
  },
};
