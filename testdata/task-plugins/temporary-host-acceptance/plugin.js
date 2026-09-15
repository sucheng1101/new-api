export const meta = {
  apiVersion: 1,
  key: "temporary-host-acceptance",
  name: "Temporary Host Acceptance",
  version: "1.0.0",
  author: {name: "Test"},
  models: ["temporary-video"],
  fetchMode: "per_task",
  protocols: ["openai_video"],
  usageSchema: {
    seconds: {type: "number", unit: "second"},
    resolution: {enum: ["768", "2K"]},
  },
};

export function value() { return "dry-run-ok"; }

export function buildSubmitRequest(ctx) {
  const request = ctx.requestBody || {};
  return {
    url: ctx.baseUrl + "/v1/videos",
    method: "POST",
    body: {
      model: ctx.upstreamModel || ctx.model,
      prompt: request.prompt || "temporary acceptance",
      duration_seconds: request.seconds || 5,
      resolution: request.size || "768",
    },
  };
}

export function parseSubmitResponse(ctx, response) {
  const body = response.body || {};
  return {taskId: body.id || body.task_id || "temporary-task", taskData: body};
}

export function buildQueryRequest(ctx) {
  return {url: ctx.baseUrl + "/v1/videos/" + ctx.taskId, method: "GET"};
}

export function parseTaskResult(ctx, response) {
  const body = response.body || {};
  const status = body.status || "SUCCESS";
  return {status: status, taskId: body.id || ctx.taskId, taskData: body};
}

export function extractUsage(ctx) {
  const request = ctx.requestBody || {};
  return {
    seconds: request.seconds || 5,
    resolution: request.size || "768",
  };
}

export function extractUsageOnSubmit(ctx, data) {
  return {
    seconds: data.seconds || 5,
    resolution: data.resolution || "768",
  };
}

export function listArtifacts() {
  return [{key: "video", type: "video", mimeType: "video/mp4"}];
}

export function buildContentRequest(ctx) {
  return {
    url: ctx.baseUrl + "/v1/videos/" + ctx.upstreamTaskId + "/content",
    method: ctx.clientRequest.method,
  };
}

export const protocols = {
  openai_video: {
    decodeRequest(ctx) {
      return {kind: "submit", model: ctx.model, requestBody: ctx.body.value};
    },
    render(ctx, task) {
      return {id: task.task_id, status: task.status, model: ctx.model};
    },
  },
};
