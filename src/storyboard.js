export const NARA_CHARACTER = {
  name: "Nara",
  age: "7",
  description:
    "Nara, a cheerful 7-year-old Indonesian child with short black bob hair, warm brown eyes, a round friendly face, a yellow hoodie, denim shorts, blue sneakers, and a small star patch on the hoodie",
  style:
    "high-quality warm 3D children's animation, soft daylight, rounded shapes, expressive but gentle faces, colorful village garden setting"
};

const CHILD_UNSAFE_PATTERN =
  /\b(bunuh|membunuh|darah|berdarah|sadis|horor|horror|hantu|senjata|pistol|pisau|perang|seks|sex|telanjang|narkoba|judi|bunuh diri|suicide|self-harm|deepfake)\b/i;

export function assertChildSafePrompt(prompt) {
  const text = String(prompt || "");
  if (CHILD_UNSAFE_PATTERN.test(text)) {
    throw new Error("Prompt mengandung tema yang tidak aman untuk video anak-anak.");
  }
}

export function childSafeNegativePrompt() {
  return [
    "scary",
    "horror",
    "violence",
    "weapons",
    "blood",
    "injury",
    "adult content",
    "unsafe behavior",
    "crying child",
    "distorted face",
    "extra fingers",
    "deformed hands",
    "text",
    "subtitles",
    "logo",
    "watermark",
    "low quality",
    "blurry",
    "jittery",
    "flicker",
    "inconsistent character"
  ].join(", ");
}

export function fallbackChildrenPlan({ prompt, mood, durationSeconds }) {
  const title = "Nara Belajar Berbagi";
  const sceneDuration = Math.max(3, Math.round(Number(durationSeconds || 15) / 5));

  return {
    title,
    caption:
      `${prompt}\n\nCerita pendek anak tentang berbagi, jujur, dan berani melakukan hal baik. ` +
      "#VideoAnak #CeritaAnak #AIStory",
    audience: "children",
    mood,
    character: NARA_CHARACTER,
    scenes: [
      {
        text: "Nara menemukan keranjang buah kecil.",
        visual_prompt: "Nara walks into a sunny garden and finds a small basket of bright apples near a wooden bench",
        action: "She looks curious, smiles, and gently picks up one apple",
        camera: "slow dolly in",
        narration: "Pagi itu, Nara menemukan keranjang buah di taman.",
        duration: sceneDuration,
        color: "0x14532d"
      },
      {
        text: "Ia ingat teman-temannya juga lapar.",
        visual_prompt: "Nara sees three children sitting under a tree, looking happy but tired after playing",
        action: "She pauses, thinks kindly, and looks from the apple to her friends",
        camera: "soft pan right",
        narration: "Nara ingin makan sendiri, tapi ia teringat teman-temannya.",
        duration: sceneDuration,
        color: "0x0f766e"
      },
      {
        text: "Nara membagi buah dengan senyum.",
        visual_prompt: "Nara shares the apples with her friends in the garden",
        action: "Everyone receives one apple and smiles warmly",
        camera: "medium shot with gentle handheld motion",
        narration: "Ia membagi buah itu satu per satu.",
        duration: sceneDuration,
        color: "0x1d4ed8"
      },
      {
        text: "Teman-teman ikut membantu merapikan taman.",
        visual_prompt: "The children happily collect leaves and tidy the garden together",
        action: "Nara and friends work together, laughing softly and helping each other",
        camera: "wide shot",
        narration: "Kebaikan kecil membuat semua orang ingin ikut membantu.",
        duration: sceneDuration,
        color: "0x7c2d12"
      },
      {
        text: "Berbagi membuat hari terasa lebih cerah.",
        visual_prompt: "Nara and friends sit in a circle under warm sunlight, holding apples and smiling",
        action: "They wave happily as sunlight glows through the leaves",
        camera: "slow pull back",
        narration: "Nara belajar, berbagi membuat hati jadi hangat.",
        duration: sceneDuration,
        color: "0x312e81"
      }
    ]
  };
}

export function buildReplicatePrompt({ plan, durationSeconds, aspectRatio }) {
  const character = plan.character || NARA_CHARACTER;
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
  const formatLabel = aspectRatio === "9:16" ? "vertical" : aspectRatio === "1:1" ? "square" : "landscape";
  const sceneLines = scenes.map((scene, index) => {
    const seconds = Number(scene.duration || durationSeconds / Math.max(1, scenes.length));
    return [
      `Beat ${index + 1}, about ${Math.round(seconds)} seconds:`,
      scene.visual_prompt || scene.text,
      scene.action ? `Action: ${scene.action}.` : "",
      scene.camera ? `Camera: ${scene.camera}.` : ""
    ].filter(Boolean).join(" ");
  });

  return [
    `Create one continuous ${durationSeconds}-second ${aspectRatio} ${formatLabel} children's animated short.`,
    `Main character continuity is critical: ${character.description}.`,
    `The character must look identical in every beat: same face, hair, yellow hoodie, star patch, denim shorts, and blue sneakers.`,
    `Visual style: ${character.style}.`,
    "No on-screen text, no captions, no logos, no watermark.",
    "Gentle, safe, wholesome, bright, suitable for children under adult supervision.",
    `Story title: ${plan.title}.`,
    ...sceneLines,
    "End with a warm friendly smile and a calm hopeful feeling."
  ].join(" ");
}
