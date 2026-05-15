import { runWorkflow } from "./workflow.js";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return fallback;
  return value;
}

function hasArg(name) {
  return process.argv.includes(name);
}

const options = {
  prompt: argValue("--prompt", process.env.PROMPT || ""),
  mood: argValue("--mood", process.env.MOOD || "clean"),
  durationSeconds: Number(argValue("--duration", process.env.DURATION_SECONDS || "24")),
  engine: argValue("--engine", process.env.VIDEO_ENGINE || ""),
  audience: argValue("--audience", process.env.VIDEO_AUDIENCE || ""),
  aspectRatio: argValue("--aspect", process.env.VIDEO_ASPECT_RATIO || ""),
  publish: hasArg("--publish")
};

if (hasArg("--no-publish") || hasArg("--dry-run")) {
  options.publish = false;
}

runWorkflow(options)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    const message = String(error?.message || error).replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
    console.error(message);
    process.exitCode = 1;
  });
