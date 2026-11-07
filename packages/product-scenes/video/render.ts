// Renders a product scene to an H.264 MP4 file, frame by frame, for social media. It serves the
// video page with Vite, opens it in headless Chromium, seeks the scene to each frame time, takes a
// screenshot, and sends the frames to ffmpeg. The same command gives the same frames.
// Usage: bun run render:video -- --scene hero [--format 16:9|1:1|9:16] [--theme light|dark]
//   [--keys mac|pc] [--fps 60] [--seconds N] [--out file.mp4] [--frames dir]
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { VIDEO_SCENES, videoScene } from "./scenes";

/** The size of each video format, in pixels. */
const FORMATS = new Map<string, { width: number; height: number }>([
  ["16:9", { width: 1920, height: 1080 }],
  ["1:1", { width: 1080, height: 1080 }],
  ["9:16", { width: 1080, height: 1920 }],
]);

const VIDEO_DIR = import.meta.dir;

const USAGE = `Usage: bun run render:video -- --scene <name> [--format 16:9|1:1|9:16] [--theme light|dark] [--keys mac|pc] [--fps 60] [--seconds N] [--out file.mp4] [--frames dir]
Scenes: ${VIDEO_SCENES.join(", ")}`;

type Job = {
  scene: string;
  format: string;
  width: number;
  height: number;
  theme: string;
  keys: string;
  fps: number;
  seconds: number | undefined;
  out: string;
  frames: string | undefined;
};

function readJob(): Job {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      scene: { type: "string" },
      format: { type: "string", default: "16:9" },
      theme: { type: "string", default: "light" },
      keys: { type: "string", default: "mac" },
      fps: { type: "string", default: "60" },
      seconds: { type: "string" },
      out: { type: "string" },
      frames: { type: "string" },
    },
  });
  if (!values.scene) throw new Error(`Give a scene.\n${USAGE}`);
  const scene = videoScene(values.scene);
  const size = FORMATS.get(values.format);
  if (!size) throw new Error(`Set --format to ${[...FORMATS.keys()].join(", ")}.`);
  if (values.theme !== "light" && values.theme !== "dark") {
    throw new Error("Set --theme to light or dark.");
  }
  if (values.keys !== "mac" && values.keys !== "pc") throw new Error("Set --keys to mac or pc.");
  const fps = Number(values.fps);
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) {
    throw new Error("Set --fps to a whole number from 1 to 120.");
  }
  const seconds = values.seconds === undefined ? undefined : Number(values.seconds);
  if (seconds !== undefined && !(seconds > 0))
    throw new Error("Set --seconds to a positive number.");
  const slug = `${scene}-${values.format.replace(":", "x")}-${values.theme}`;
  return {
    scene,
    format: values.format,
    ...size,
    theme: values.theme,
    keys: values.keys,
    fps,
    seconds,
    out: resolve(values.out ?? join(VIDEO_DIR, "out", `${slug}.mp4`)),
    frames: values.frames === undefined ? undefined : resolve(values.frames),
  };
}

/** The path of ffmpeg. The renderer has no other encoder. */
function findFfmpeg(): string {
  const path = Bun.which("ffmpeg");
  if (!path) {
    throw new Error(
      "ffmpeg is not on the PATH. Install it (macOS: brew install ffmpeg) and run the command again.",
    );
  }
  return path;
}

/** Starts ffmpeg, which reads PNG frames on its input and writes an H.264 MP4 file in BT.709. */
function startEncoder(ffmpeg: string, job: Job): Bun.Subprocess<"pipe", "ignore", "pipe"> {
  mkdirSync(dirname(job.out), { recursive: true });
  return Bun.spawn(
    [
      ffmpeg,
      "-y",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-framerate",
      String(job.fps),
      "-c:v",
      "png",
      "-i",
      "-",
      "-vf",
      "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "18",
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-movflags",
      "+faststart",
      job.out,
    ],
    { stdin: "pipe", stdout: "ignore", stderr: "pipe" },
  );
}

async function render(job: Job): Promise<void> {
  const ffmpeg = findFfmpeg();
  const server = await createServer({
    configFile: false,
    root: VIDEO_DIR,
    cacheDir: join(VIDEO_DIR, "../node_modules/.vite-video"),
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
  try {
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error("The Vite server of the video page has no local address.");
    const context = await browser.newContext({
      viewport: { width: job.width, height: job.height },
      deviceScaleFactor: 1,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    const query = new URLSearchParams({
      scene: job.scene,
      theme: job.theme,
      keys: job.keys,
      width: String(job.width),
      height: String(job.height),
    });
    await page.goto(`${base}?${query}`);
    await page.waitForFunction(() => window.__sceneVideo !== undefined);
    const duration = await page.evaluate(() => window.__sceneVideo?.ready);
    if (duration === undefined) throw new Error("The video page did not mount the scene.");
    const seconds = job.seconds ?? duration;
    if (seconds > duration) {
      throw new Error(
        `The ${job.scene} scene lasts ${duration.toFixed(2)} s. Set --seconds to that or less.`,
      );
    }
    // The last frame starts before the end of the run: `seek` accepts times below the duration.
    const count = Math.ceil(seconds * job.fps - 1e-6);
    console.log(
      `Rendering ${job.scene} (${job.format}, ${job.theme}): ${count} frames at ${job.fps} fps.`,
    );
    if (job.frames) mkdirSync(job.frames, { recursive: true });

    const cdp = await context.newCDPSession(page);
    const encoder = startEncoder(ffmpeg, job);
    for (let index = 0; index < count; index += 1) {
      await page.evaluate((time) => window.__sceneVideo?.seek(time), index / job.fps);
      const shot = await cdp.send("Page.captureScreenshot", {
        format: "png",
        optimizeForSpeed: true,
      });
      const png = Buffer.from(shot.data, "base64");
      if (job.frames) {
        await Bun.write(join(job.frames, `frame-${String(index).padStart(5, "0")}.png`), png);
      }
      encoder.stdin.write(png);
      await encoder.stdin.flush();
      const [error] = errors;
      if (error) throw new Error(`The video page failed: ${error.message}`);
    }
    await encoder.stdin.end();
    const code = await encoder.exited;
    if (code !== 0) {
      const log = await new Response(encoder.stderr).text();
      throw new Error(`ffmpeg stopped with code ${code}:\n${log}`);
    }
    console.log(`Wrote ${job.out}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

try {
  await render(readJob());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
