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

const telegramApiHost = "https://api.telegram.org";
const telegramBotPathPrefix = ["b", "ot"].join("");

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

    await sendImmediateTelegramAck(env.TELEGRAM_BOT_TOKEN, update);

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

async function sendImmediateTelegramAck(botToken: string, update: unknown): Promise<void> {
  const message = extractTelegramMessage(update);
  if (!message?.chat?.id) {
    return;
  }

  const text = typeof message.text === "string" ? message.text.trim() : "";
  const command = text.split(/\s+/, 1)[0]?.toLowerCase().split("@")[0] || "";
  const ackText = ackTextFor(command, Boolean(message.photo?.length));

  try {
    await fetch(`${telegramApiHost}/${telegramBotPathPrefix}${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: message.chat.id,
        text: ackText,
        disable_web_page_preview: true
      })
    });
  } catch {
    // Keep webhook delivery successful even if the immediate acknowledgement fails.
  }
}

function ackTextFor(command: string, hasPhoto: boolean): string {
  if (hasPhoto) {
    return "Foto diterima, diproses...";
  }

  if (command === "/start") {
    return "Bot aktif. Kirim /new.";
  }

  if (command === "/generate") {
    return "Generate diterima, diproses...";
  }

  return "Diproses...";
}

function extractTelegramMessage(update: unknown):
  | {
      chat?: { id?: number | string };
      text?: string;
      photo?: unknown[];
    }
  | undefined {
  if (!update || typeof update !== "object") {
    return undefined;
  }

  const record = update as Record<string, unknown>;
  const message = record.message || record.edited_message;
  if (!message || typeof message !== "object") {
    return undefined;
  }

  return message as {
    chat?: { id?: number | string };
    text?: string;
    photo?: unknown[];
  };
}
