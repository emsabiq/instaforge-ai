export interface WorkerEnv {
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW_FILE?: string;
  GITHUB_BRANCH?: string;
}

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "telegram-ai-frame-worker",
          workflow: env.GITHUB_WORKFLOW_FILE || "generate-video.yml"
        }),
        { headers: jsonHeaders }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const telegramSecret = request.headers.get("x-telegram-bot-api-secret-token");
    if (env.TELEGRAM_WEBHOOK_SECRET && telegramSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    let update: unknown;
    try {
      update = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const workflowFile = env.GITHUB_WORKFLOW_FILE || "generate-video.yml";
    const branch = env.GITHUB_BRANCH || "main";
    const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`;

    const ghResponse = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "telegram-ai-frame-worker"
      },
      body: JSON.stringify({
        ref: branch,
        inputs: {
          telegram_update: JSON.stringify(update)
        }
      })
    });

    if (!ghResponse.ok) {
      const detail = await ghResponse.text();
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Failed to dispatch GitHub Actions workflow",
          detail
        }),
        { status: 502, headers: jsonHeaders }
      );
    }

    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
  }
};
