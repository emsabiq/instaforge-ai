import {
  clean,
  dispatchWorkflow,
  makeId,
  methodAllowed,
  readBody,
  requireAuth,
  sendJson
} from "./_utils.js";

export default async function handler(req, res) {
  if (!methodAllowed(req, res, ["POST"])) return;
  if (!requireAuth(req, res)) return;

  try {
    const body = await readBody(req);
    const prompt = clean(body.prompt);
    if (!prompt) throw new Error("Prompt video wajib diisi.");

    const duration = String(Math.max(12, Math.min(60, Number(body.duration_seconds || 15) || 15)));
    const inputs = {
      prompt,
      mood: clean(body.mood || "clean"),
      engine: clean(body.engine || "replicate"),
      audience: clean(body.audience || "children"),
      aspect_ratio: clean(body.aspect_ratio || "16:9"),
      duration_seconds: duration,
      publish: body.publish === true || body.publish === "true" ? "true" : "false"
    };

    const dispatch = await dispatchWorkflow(inputs);
    sendJson(res, 200, {
      id: makeId("run"),
      status: "queued",
      startedAt: new Date().toISOString(),
      result: {
        status: "workflow_dispatch_queued",
        repo: dispatch.repo,
        workflow: dispatch.workflow,
        ref: dispatch.ref
      },
      logs: [
        {
          at: new Date().toISOString(),
          level: "system",
          text: "Workflow berhasil dipicu. Refresh beberapa detik lagi untuk melihat status run."
        }
      ]
    });
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}
