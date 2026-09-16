const ASPECT_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];

// Prompt Hubs documents use 768, while a few existing clients send 768P.
// Keep the billing fact and provider wire value canonical at 768.
const RESOLUTION_ALIASES = {
  "768": "768",
  "768p": "768",
  "1080p": "1080p",
  "2k": "2K",
  "4k": "4K",
};

// The host lifecycle deliberately follows the same submit -> poll -> artifact
// -> settlement shape as the Hailuo task plugin. Only this profile table and
// the Prompt Hubs wire adapter below are provider-specific.
const MODEL_PROFILES = [
  {
    model: "minimax_h3",
    wireModel: "minimax_h3",
    minSeconds: 4,
    maxSeconds: 15,
    resolutions: ["768", "1080p", "2K", "4K"],
    referenceRequiredFor: ["2K", "4K"],
  },
  {
    // Keep the catalog/price identity separate from the Prompt Hubs wire name.
    model: "MiniMax-H3",
    wireModel: "minimax_h3",
    forceWireModel: true,
    minSeconds: 4,
    maxSeconds: 15,
    resolutions: ["768", "1080p", "2K", "4K"],
    referenceRequiredFor: ["2K", "4K"],
  },
  {
    model: "MiniMax-H3-漫剧优化",
    wireModel: "MiniMax-H3-漫剧优化",
    minSeconds: 4,
    maxSeconds: 15,
    resolutions: ["768", "2K", "4K"],
  },
  {
    model: "MiniMax-H3-量化版",
    wireModel: "MiniMax-H3-量化版",
    minSeconds: 4,
    maxSeconds: 10,
    resolutions: ["768"],
  },
  {
    model: "MiniMax-H3-四步采样版",
    wireModel: "MiniMax-H3-四步采样版",
    minSeconds: 4,
    maxSeconds: 15,
    resolutions: ["768", "1080p"],
  },
];

// Each catalog model owns an independent usage profile and Model Pricing entry.
const MODEL_IDS = MODEL_PROFILES.map(function (profile) {
  return profile.model;
});

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
  version: "1.0.5",
  author: { name: "Skye" },
  baseUrl: "https://console.prompt-hubs.com",
  models: MODEL_IDS,
  fetchMode: "per_task",
  usageSchema: usageSchemaFor(profileFor("minimax_h3").resolutions),
  usageExamples: examplesFor("MiniMax-H3", profileFor("MiniMax-H3")),
  usageProfiles: MODEL_PROFILES.map(function (profile) {
    return {
      models: [profile.model],
      schema: usageSchemaFor(profile.resolutions),
      examples: examplesFor(profile.model, profile),
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

function profileFor(publicModel, upstreamModel) {
  const publicName = trimmed(publicModel);
  const publicProfile = MODEL_PROFILES.find(function (profile) {
    return profile.model === publicName;
  });
  if (publicProfile) return publicProfile;
  const upstreamName = trimmed(upstreamModel);
  const upstreamProfile = MODEL_PROFILES.find(function (profile) {
    return profile.model === upstreamName;
  });
  if (upstreamProfile) return upstreamProfile;
  throw new Error("Prompt Hubs does not support model " + (publicName || upstreamName));
}

function outboundModelFor(profile, channelUpstreamModel) {
  // A public MiniMax-H3 request is always sent to Prompt Hubs as minimax_h3.
  // The other catalog models retain an explicit channel mapping when present.
  if (profile.forceWireModel) return profile.wireModel;
  return trimmed(channelUpstreamModel) || profile.wireModel;
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

function promptEnhanceFor(req, metadata) {
  const value = hasOwn(req, "prompt_enhance") ? req.prompt_enhance : metadata.prompt_enhance;
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "boolean") throw new Error("prompt_enhance must be a boolean");
  return value;
}

function durationFor(req, rule, model) {
  let raw;
  if (hasOwn(req, "seconds")) raw = req.seconds;
  else if (hasOwn(req, "duration")) raw = req.duration;
  else if (hasOwn(req, "duration_seconds")) raw = req.duration_seconds;
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
  const normalized = RESOLUTION_ALIASES[trimmed(raw).toLowerCase()];
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
  const profile = profileFor(model, upstreamModel);
  const executingModel = outboundModelFor(profile, upstreamModel);
  const metadata = metadataFor(req);
  rejectUnsupportedFields(req, metadata);
  const prompt = trimmed((input && input.prompt) || req.prompt);
  if (!prompt) throw new Error("prompt is required");
  const references = referencesFor(req, metadata, input && input.references);
  const duration = durationFor(req, profile, model);
  const resolution = resolutionFor(req, metadata, profile, model);
  if (profile.referenceRequiredFor && profile.referenceRequiredFor.indexOf(resolution) >= 0) {
    const count = references.images.length + references.videos.length + references.audios.length;
    if (count === 0) throw new Error(model + " " + resolution + " requires at least one reference media URL");
  }
  const normalizedMetadata = { aspect_ratio: aspectRatioFor(req, metadata) };
  const promptEnhance = promptEnhanceFor(req, metadata);
  if (promptEnhance !== undefined) normalizedMetadata.prompt_enhance = promptEnhance;
  if (references.images.length) normalizedMetadata.reference_images = references.images;
  if (references.videos.length) normalizedMetadata.reference_videos = references.videos;
  if (references.audios.length) normalizedMetadata.reference_audios = references.audios;
  return {
    model: model,
    upstreamModel: executingModel,
    prompt: prompt,
    duration: duration,
    size: resolution,
    metadata: normalizedMetadata,
  };
}

function actionFor(req) {
  const metadata = (req && req.metadata) || {};
  return (metadata.reference_images && metadata.reference_images.length) || (metadata.reference_videos && metadata.reference_videos.length)
    || (metadata.reference_audios && metadata.reference_audios.length)
    ? "image_to_video"
    : "text_to_video";
}

function usageFactsFor(request) {
  return { seconds: request.duration, resolution: request.size };
}

function promptHubsSubmitBody(request) {
  const metadata = request.metadata;
  const body = {
    model: request.upstreamModel,
    prompt: request.prompt,
    duration_seconds: request.duration,
    resolution: request.size,
    aspect_ratio: metadata.aspect_ratio,
  };
  if (metadata.prompt_enhance !== undefined) body.prompt_enhance = metadata.prompt_enhance;
  if (metadata.reference_images && metadata.reference_images.length) body.reference_images = metadata.reference_images;
  if (metadata.reference_videos && metadata.reference_videos.length) body.reference_videos = metadata.reference_videos;
  if (metadata.reference_audios && metadata.reference_audios.length) body.reference_audios = metadata.reference_audios;
  return body;
}

export function buildSubmitRequest(ctx) {
  const request = normalizeRequest((ctx && ctx.requestBody) || {}, ctx && ctx.model, ctx && ctx.upstreamModel);
  return {
    url: providerURL(ctx, "/v1/videos"),
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: "Bearer " + trimmed(ctx && ctx.apiKey) },
    body: promptHubsSubmitBody(request),
    action: actionFor(request),
  };
}

function promptHubsError(body) {
  if (!isObject(body)) return "";
  if (isObject(body.error)) return trimmed(body.error.message) || trimmed(body.error.reason) || trimmed(body.error.code);
  const direct = trimmed(body.error) || trimmed(body.message) || trimmed(body.reason);
  if (direct) return direct;
  for (const key of ["data", "result", "output"]) {
    if (isObject(body[key])) {
      const nested = promptHubsError(body[key]);
      if (nested) return nested;
    }
  }
  return "";
}

function promptHubsTaskID(body) {
  if (!isObject(body)) return "";
  for (const key of ["id", "task_id"]) {
    if (typeof body[key] === "string" && trimmed(body[key])) return trimmed(body[key]);
  }
  for (const key of ["data", "result", "output"]) {
    if (isObject(body[key])) {
      const nested = promptHubsTaskID(body[key]);
      if (nested) return nested;
    }
  }
  return "";
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp && resp.body;
  if (!isObject(body)) throw new Error("Prompt Hubs submit response must be a JSON object");
  const id = promptHubsTaskID(body);
  if (!id) {
    const message = promptHubsError(body);
    if (message) throw new Error("Prompt Hubs submit failed: " + message);
    throw new Error("Prompt Hubs submit response is missing id/task_id");
  }
  const parsed = { taskId: id, taskData: body };
  if (ctx && isObject(ctx.requestBody) && (trimmed(ctx.model) || trimmed(ctx.requestBody.model))) {
    const request = normalizeRequest(ctx.requestBody, ctx.model, ctx.upstreamModel);
    // Prompt Hubs completion payloads may omit dimensions. Persist the
    // prevalidated values so completion settlement has a bounded fallback.
    parsed.state = { usageFacts: usageFactsFor(request) };
  }
  return parsed;
}

export function extractUsage(ctx) {
  if (ctx && ctx.usagePurpose === "billing_ratios") return null;
  const request = normalizeRequest((ctx && ctx.requestBody) || {}, ctx && ctx.model, ctx && ctx.upstreamModel);
  return usageFactsFor(request);
}

export function buildQueryRequest(ctx) {
  return {
    url: providerURL(ctx, "/v1/videos/" + encodeURIComponent(trimmed(ctx && ctx.taskId))),
    method: "GET",
    headers: { Accept: "application/json", Authorization: "Bearer " + trimmed(ctx && ctx.apiKey) },
  };
}

function promptHubsTask(body) {
  if (!isObject(body)) return null;
  if (!trimmed(body.status) && isObject(body.data)) return body.data;
  return body;
}

function promptHubsArtifactURL(body) {
  const result = promptHubsTask(body);
  if (!result) return "";
  const outputs = Array.isArray(result.outputs) ? result.outputs : [];
  const first = outputs.length && isObject(outputs[0]) ? outputs[0] : {};
  for (const value of [result.download_url, result.content_url, result.video_url, result.result_url, result.url, first.download_url, first.content_url, first.url]) {
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
  const resultBody = promptHubsTask(body);
  if (!resultBody) throw new Error("Prompt Hubs task response must be a JSON object");
  const rawStatus = trimmed(resultBody.status).toLowerCase();
  const statuses = {
    pending: "QUEUED",
    queued: "QUEUED",
    processing: "IN_PROGRESS",
    running: "IN_PROGRESS",
    in_progress: "IN_PROGRESS",
    completed: "SUCCESS",
    succeeded: "SUCCESS",
    success: "SUCCESS",
    failed: "FAILURE",
    failure: "FAILURE",
    cancelled: "FAILURE",
    canceled: "FAILURE",
  };
  const status = statuses[rawStatus];
  if (!status) {
    const message = promptHubsError(resultBody);
    if (message) return { status: "FAILURE", progress: "100%", reason: message };
    return { status: "UNKNOWN", reason: "unrecognized status: " + rawStatus };
  }
  const task = { status: status, progress: progressFor(resultBody.progress, status) };
  if (status === "SUCCESS") {
    const url = promptHubsArtifactURL(resultBody);
    if (url) task.url = url;
  }
  if (status === "FAILURE") task.reason = promptHubsError(resultBody) || "task " + rawStatus;
  return task;
}

export function listArtifacts(task) {
  return task && task.status === "SUCCESS" && promptHubsArtifactURL(task.data) ? [{ key: "video", type: "video", mimeType: "video/mp4" }] : [];
}

export function buildContentRequest(ctx) {
  if (!ctx || ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  const method = trimmed(ctx.clientRequest && ctx.clientRequest.method).toUpperCase();
  const taskId = trimmed(ctx.upstreamTaskId);
  if (taskId) {
    // Status payload URLs are often signed CDN links with a short lifetime.
    // Re-resolve through the authenticated provider endpoint and deliberately
    // remove the provider credential if it redirects to a media host.
    return {
      url: providerURL(ctx, "/v1/videos/" + encodeURIComponent(taskId) + "/content"),
      method: method || "GET",
      headers: { Authorization: "Bearer " + trimmed(ctx.apiKey) },
      dropCredentialsOnRedirect: true,
    };
  }
  const persistedURL = promptHubsArtifactURL(ctx.data);
  if (persistedURL) {
    return { url: persistedURL, method: method || "GET", credentialless: true };
  }
  throw new Error("artifact_not_found");
}

export function extractUsageOnComplete(_task, _taskResult, _body) {
  const task = _task || {};
  const body = promptHubsTask(_body);
  let profile;
  try {
    profile = profileFor(task.model, task.upstreamModel);
  } catch (_error) {
    return null;
  }
  const facts = {};
  const rawSeconds = body && (hasOwn(body, "seconds") ? body.seconds : hasOwn(body, "duration_seconds") ? body.duration_seconds : body.duration);
  if (rawSeconds !== undefined && rawSeconds !== null && rawSeconds !== "") {
    const seconds = Number(rawSeconds);
    if (Number.isInteger(seconds) && seconds >= profile.minSeconds && seconds <= profile.maxSeconds) facts.seconds = seconds;
  }
  const rawResolution = body && (hasOwn(body, "resolution") ? body.resolution : body.size);
  if (rawResolution !== undefined && rawResolution !== null && trimmed(rawResolution) !== "") {
    const resolution = RESOLUTION_ALIASES[trimmed(rawResolution).toLowerCase()];
    if (resolution && profile.resolutions.indexOf(resolution) >= 0) facts.resolution = resolution;
  }
  const stored = isObject(task.state) && isObject(task.state.usageFacts) ? task.state.usageFacts : {};
  if (facts.seconds === undefined) {
    const seconds = Number(stored.seconds);
    if (Number.isInteger(seconds) && seconds >= profile.minSeconds && seconds <= profile.maxSeconds) facts.seconds = seconds;
  }
  if (facts.resolution === undefined) {
    const resolution = RESOLUTION_ALIASES[trimmed(stored.resolution).toLowerCase()];
    if (resolution && profile.resolutions.indexOf(resolution) >= 0) facts.resolution = resolution;
  }
  return Object.keys(facts).length ? facts : null;
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
  if (req.prompt_enhance !== undefined) {
    const promptEnhance = trimmed(req.prompt_enhance).toLowerCase();
    if (promptEnhance === "true") req.prompt_enhance = true;
    else if (promptEnhance === "false") req.prompt_enhance = false;
    else throw new Error("prompt_enhance must be true or false");
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
      const rawProgress = trimmed(task && task.progress).replace(/%$/, "");
      const numeric = rawProgress === "" ? NaN : Number(rawProgress);
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
