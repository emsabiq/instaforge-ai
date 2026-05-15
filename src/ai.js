import { config } from "./config.js";
import { assertChildSafePrompt, fallbackChildrenPlan, NARA_CHARACTER } from "./storyboard.js";

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

function fallbackPlan({ prompt, mood, durationSeconds, audience }) {
  if (audience === "children") {
    return normalizePlan(fallbackChildrenPlan({ prompt, mood, durationSeconds }), durationSeconds, audience);
  }

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
    mood,
    audience
  }, durationSeconds, audience);
}

function normalizePlan(plan, durationSeconds, audience = "general") {
  const scenes = Array.isArray(plan?.scenes) && plan.scenes.length ? plan.scenes : [];
  const safeScenes = scenes.slice(0, 6).map((scene, index) => ({
    text: String(scene?.text || scene?.line || "").trim() || `Scene ${index + 1}`,
    visual_prompt: String(scene?.visual_prompt || scene?.visual || scene?.image_prompt || scene?.text || "").trim(),
    action: String(scene?.action || "").trim(),
    camera: String(scene?.camera || "").trim(),
    narration: String(scene?.narration || scene?.voiceover || "").trim(),
    duration: Number(scene?.duration || scene?.duration_seconds || 0) || 0,
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
    audience,
    mood: String(plan?.mood || "").trim(),
    character: audience === "children" ? normalizeCharacter(plan?.character) : plan?.character || null,
    scenes: safeScenes,
    durationSeconds
  };
}

function normalizeCharacter(character) {
  if (!character || typeof character !== "object") return NARA_CHARACTER;
  return {
    name: String(character.name || NARA_CHARACTER.name).trim(),
    age: String(character.age || NARA_CHARACTER.age).trim(),
    description: String(character.description || NARA_CHARACTER.description).trim(),
    style: String(character.style || NARA_CHARACTER.style).trim()
  };
}

function normalizeColor(value, index) {
  const palette = ["0x101820", "0x0f766e", "0x312e81", "0x7c2d12", "0x1f2937", "0x164e63"];
  const text = String(value || "").trim().replace(/^#/, "0x");
  return /^0x[0-9a-f]{6}$/i.test(text) ? text : palette[index % palette.length];
}

export async function generateVideoPlan({ prompt, mood = "clean", durationSeconds = 24, audience = "general" }) {
  const safePrompt = String(prompt || "").trim();
  if (!safePrompt) throw new Error("Prompt video wajib diisi.");
  const safeAudience = audience === "children" ? "children" : "general";
  if (safeAudience === "children") assertChildSafePrompt(safePrompt);

  if (!config.openai.apiKey) {
    return fallbackPlan({ prompt: safePrompt, mood, durationSeconds, audience: safeAudience });
  }

  const systemPrompt = safeAudience === "children" ? `
Buat storyboard video anak-anak dalam bahasa Indonesia.
Balas hanya JSON valid tanpa markdown.
Format:
{
  "title": "judul pendek",
  "caption": "caption pendek dengan 3-5 hashtag",
  "character": {
    "name": "Nara",
    "age": "7",
    "description": "deskripsi karakter konsisten",
    "style": "gaya visual konsisten"
  },
  "scenes": [
    {
      "text": "overlay maksimal 10 kata",
      "visual_prompt": "deskripsi visual bahasa Inggris yang detail",
      "action": "aksi sederhana dan aman",
      "camera": "gerakan kamera sederhana",
      "narration": "narasi bahasa Indonesia satu kalimat",
      "duration": 3,
      "color": "0x101820"
    }
  ]
}
Aturan:
- Buat 5 scene untuk total sekitar ${durationSeconds} detik.
- Karakter wajib konsisten: ${NARA_CHARACTER.description}.
- Gaya visual wajib konsisten: ${NARA_CHARACTER.style}.
- Tema harus aman untuk anak: tidak horor, tidak kekerasan, tidak bahaya, tidak dewasa, tidak tokoh nyata, tidak karakter berhak cipta.
- Cerita harus punya nilai: berbagi, jujur, berani baik, atau rasa ingin tahu.
- Visual prompt jangan meminta teks, logo, watermark, subtitle, atau UI di video.
- Gaya: ${mood}.
Prompt user: ${safePrompt}
`.trim() : `
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
    return normalizePlan(jsonFromText(outputTextFromOpenAi(data)), durationSeconds, safeAudience);
  } catch (error) {
    console.warn(`OpenAI plan gagal, memakai fallback lokal: ${error.message}`);
    return fallbackPlan({ prompt: safePrompt, mood, durationSeconds, audience: safeAudience });
  } finally {
    timeout.clear();
  }
}
