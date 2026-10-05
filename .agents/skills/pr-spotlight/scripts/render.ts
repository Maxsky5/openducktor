import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const revision = "46fd6121d0c2067f22a176e2187924a9914e9453";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const toolchain = resolve(root, "build/pr-spotlight/toolchain", revision);
const binary = resolve(
  toolchain,
  "bin",
  process.platform === "win32" ? "psychopomp.exe" : "psychopomp",
);
const usage = `PR spotlight
  setup
  plan validate|inspect|steps SCENE.json
  plan frame SCENE.json SECONDS OUTPUT.png [--theme NAME] [--shutter]
  plan render SCENE.json OUTPUT.mp4 [--theme NAME] [--cue ID | --range START..END]
  encode INPUT.mp4 OUTPUT.mp4 [MAX_MB=9]

Run with: bun .agents/skills/pr-spotlight/scripts/render.ts <command>
Outputs must use new paths. setup installs pinned Psychopomp with Cargo.
encode needs FFmpeg and ffprobe; frame/render also need a working GPU.
`;

function run(command: string, args: string[], capture = false): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["inherit", capture ? "pipe" : "inherit", "inherit"],
  });
  if (result.error) {
    throw new Error(`Cannot start ${command}: ${result.error.message}. Check its installation.`);
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    throw new Error(
      `${command} failed (${result.signal ?? result.status}). See its diagnostic above.`,
    );
  }
  return result.stdout ?? "";
}

function newOutput(input: string, output: string): void {
  if (resolve(input) === resolve(output)) {
    throw new Error("Input and output must use different paths.");
  }
  if (existsSync(output)) {
    throw new Error(
      `Output already exists: ${output}. Choose a new path or remove the generated file.`,
    );
  }
}

function encode(args: string[]): void {
  const [input, output, limitText = "9"] = args;
  if (!input || !output || args.length > 3) throw new Error(usage);
  newOutput(input, output);
  const limitMb = Number(limitText);
  if (!Number.isFinite(limitMb) || limitMb <= 0) {
    throw new Error("MAX_MB must be a positive finite number.");
  }
  const duration = Number(
    run(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input],
      true,
    ).trim(),
  );
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("ffprobe did not return a positive finite duration.");
  }
  // Reserve ten percent for container overhead and 96 kb/s for optional audio.
  const budget = limitMb * 1_000_000;
  const bitrate = Math.floor((budget * 0.9 * 8) / duration - 96_000);
  if (!Number.isSafeInteger(bitrate) || bitrate < 160_000) {
    throw new Error("The size budget is too small. Shorten the clip or increase MAX_MB.");
  }
  mkdirSync(dirname(resolve(output)), { recursive: true });
  run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-n",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    "fps=30,scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    String(bitrate),
    "-maxrate",
    String(bitrate),
    "-bufsize",
    String(bitrate * 2),
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    output,
  ]);
  const bytes = statSync(output).size;
  if (bytes > budget) {
    throw new Error(
      `Encoded file is ${bytes} bytes, above the ${budget}-byte budget. Do not upload it; shorten the clip or increase MAX_MB and use a new output path.`,
    );
  }
  console.log(`${output}: ${bytes} bytes (budget ${budget})`);
}

function main(args: string[]): void {
  const [command, ...rest] = args;
  if (!command || command === "--help") {
    console.log(usage);
    return;
  }
  if (command === "setup" && rest.length === 0) {
    run("cargo", [
      "install",
      "psychopomp-render",
      "--git",
      "https://github.com/kitlangton/psychopomp",
      "--rev",
      revision,
      "--locked",
      "--bin",
      "psychopomp",
      "--root",
      toolchain,
    ]);
    return;
  }
  if (command === "encode") {
    encode(rest);
    return;
  }
  if (command !== "plan") throw new Error(usage);
  const [operation, input, ...options] = rest;
  if (!input) throw new Error(usage);
  if (operation === "frame" || operation === "render") {
    const output = options[operation === "frame" ? 1 : 0];
    if (!output || output.startsWith("--")) throw new Error(usage);
    newOutput(input, output);
  } else if (!["validate", "inspect", "steps"].includes(operation ?? "") || options.length !== 0) {
    throw new Error(usage);
  }
  if (!existsSync(binary)) {
    throw new Error(
      "Pinned Psychopomp is missing. Run: bun .agents/skills/pr-spotlight/scripts/render.ts setup",
    );
  }
  run(binary, ["plan", ...rest]);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode ||= 1;
}
