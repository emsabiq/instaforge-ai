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
    console.error(error);
    process.exitCode = 1;
  });

