import { config } from "./config.js";

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, ms || 40000));
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  };
}

function outputTextFromOpenAi(data) {
  if (data?.output_text) return String(data.output_text).trim();
  const texts = [];
  for (const item of data?.output || []) {
    for (const part of item?.content || []) {
      if (part?.text) texts.push(part.text);
    }
  }
  return texts.join("").trim();
}

function jsonFromText(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] || raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  return JSON.parse(body);
}

function fallbackPlan({ prompt, mood, durationSeconds }) {
  const title = "Mulai Dari Satu Langkah";
  return normalizePlan({
    title,
    caption:
      `${prompt}\n\nHal kecil yang dilakukan konsisten bisa jadi perubahan besar. ` +
      "#AIVideo #ReelsIndonesia #Motivasi",
    scenes: [
      { text: "Semua perubahan besar biasanya dimulai dari langkah yang kelihatan kecil.", color: "0x101820" },
      { text: "Pilih satu hal yang bisa kamu lakukan hari ini, lalu ulangi besok.", color: "0x0f766e" },
      { text: "Bukan harus sempurna. Yang penting, mulai dan jangan hilang dari proses.", color: "0x312e81" }
    ],
    mood
  }, durationSeconds);
}

function normalizePlan(plan, durationSeconds) {
  const scenes = Array.isArray(plan?.scenes) && plan.scenes.length ? plan.scenes : [];
  const safeScenes = scenes.slice(0, 6).map((scene, index) => ({
    text: String(scene?.text || scene?.line || "").trim() || `Scene ${index + 1}`,
    color: normalizeColor(scene?.color, index)
  }));

  while (safeScenes.length < 3) {
    safeScenes.push({
      text: safeScenes.at(-1)?.text || "Buat satu langkah kecil hari ini.",
      color: normalizeColor("", safeScenes.length)
    });
  }

  return {
    title: String(plan?.title || "InstaForge AI").trim().slice(0, 90),
    caption: String(plan?.caption || "").trim().slice(0, 2100),
    scenes: safeScenes,
    durationSeconds
  };
}

function normalizeColor(value, index) {
  const palette = ["0x101820", "0x0f766e", "0x312e81", "0x7c2d12", "0x1f2937", "0x164e63"];
  const text = String(value || "").trim().replace(/^#/, "0x");
  return /^0x[0-9a-f]{6}$/i.test(text) ? text : palette[index % palette.length];
}

export async function generateVideoPlan({ prompt, mood = "clean", durationSeconds = 24 }) {
  const safePrompt = String(prompt || "").trim();
  if (!safePrompt) throw new Error("Prompt video wajib diisi.");
  if (!config.openai.apiKey) {
    return fallbackPlan({ prompt: safePrompt, mood, durationSeconds });
  }

  const systemPrompt = `
Buat konsep video Reels vertikal dalam bahasa Indonesia.
Balas hanya JSON valid tanpa markdown.
Format:
{
  "title": "judul pendek",
  "caption": "caption Instagram lengkap dengan 3-6 hashtag",
  "scenes": [
    { "text": "kalimat overlay maksimal 18 kata", "color": "0x101820" }
  ]
}
Aturan:
- Buat 3 sampai 5 scene.
- Gaya: ${mood}.
- Durasi target: ${durationSeconds} detik.
- Teks harus ringkas, natural, dan kuat untuk video pendek.
- Jangan membuat klaim medis, finansial, atau hukum yang berisiko.
Prompt user: ${safePrompt}
`.trim();

  const body = {
    model: config.openai.model,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: systemPrompt }]
      }
    ],
    max_output_tokens: 900
  };
  if (!String(config.openai.model).startsWith("gpt-5")) {
    body.temperature = config.openai.temperature;
  }

  const timeout = timeoutSignal(config.openai.requestTimeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: timeout.signal,
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error?.message || `OpenAI request failed: ${response.status}`);
    }
    return normalizePlan(jsonFromText(outputTextFromOpenAi(data)), durationSeconds);
  } catch (error) {
    console.warn(`OpenAI plan gagal, memakai fallback lokal: ${error.message}`);
    return fallbackPlan({ prompt: safePrompt, mood, durationSeconds });
  } finally {
    timeout.clear();
  }
}
