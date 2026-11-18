// Renders a product scene or a film to an H.264 MP4 file, frame by frame, for social media. It
// serves the video page with Vite, opens it in headless Chromium, seeks the scene or the film to
// each frame time, takes a screenshot, and sends the frames to ffmpeg. The same command gives the
// same frames. `--snap` saves still images at some times instead of a video. `--blur N` takes N
// screenshots in the first half of each frame where the camera of a film moves, and mixes them, as
// the shutter of a camera, so a fast move shows motion blur and a still frame stays sharp.
// Usage: bun run render:video -- --scene hero [--format 16:9|1:1|9:16] [--theme light|dark]
//   [--keys mac|pc] [--fps 60] [--scale 1|2] [--blur N] [--from S] [--seconds N] [--out file.mp4]
//   [--frames dir]
//   bun run render:video -- --film release-1-2-2 [--theme light|dark] [--snap 5,12.5] ...
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { FILM_NAMES, FILMS } from "../src/films/registry";
import { filmName } from "./film";
import { VIDEO_SCENES, videoScene } from "./scenes";

/** The size of each video format, in pixels. */
const FORMATS = new Map<string, { width: number; height: number }>([
  ["16:9", { width: 1920, height: 1080 }],
  ["1:1", { width: 1080, height: 1080 }],
  ["9:16", { width: 1080, height: 1920 }],
]);

const VIDEO_DIR = import.meta.dir;

const USAGE = `Usage: bun run render:video -- --scene <name> | --film <name> [--format 16:9|1:1|9:16] [--theme light|dark] [--keys mac|pc] [--fps 60] [--scale 1|2] [--blur N] [--from S] [--seconds N] [--out file.mp4] [--frames dir] [--snap S1,S2]
Scenes: ${VIDEO_SCENES.join(", ")}
Films: ${FILM_NAMES.join(", ")}`;

/** What the job renders: a loop scene, or a film at the size of its frame. */
type Subject = { kind: "scene" | "film"; name: string };

type Job = {
  subject: Subject;
  format: string;
  width: number;
  height: number;
  theme: string;
  keys: string;
  fps: number;
  /** The pixels of the video for each CSS pixel of the page: 2 renders a 1920 x 1080 frame in 4K. */
  scale: number;
  /** The screenshots that each frame mixes, 1 for no motion blur. */
  blur: number;
  from: number;
  seconds: number | undefined;
  out: string;
  frames: string | undefined;
  /** The times of the still images, or nothing for a video. */
  snaps: number[] | undefined;
};

/** Reads a time in seconds that is 0 or more. */
function seconds(value: string, option: string): number {
  const time = Number(value);
  if (!(time >= 0)) throw new Error(`Set ${option} to a time in seconds, 0 or more.`);
  return time;
}

function readJob(): Job {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      scene: { type: "string" },
      film: { type: "string" },
      format: { type: "string", default: "16:9" },
      theme: { type: "string", default: "light" },
      keys: { type: "string", default: "mac" },
      fps: { type: "string", default: "60" },
      scale: { type: "string", default: "1" },
      blur: { type: "string", default: "1" },
      from: { type: "string", default: "0" },
      seconds: { type: "string" },
      out: { type: "string" },
      frames: { type: "string" },
      snap: { type: "string" },
    },
  });
  if (Boolean(values.scene) === Boolean(values.film)) {
    throw new Error(`Give a scene or a film.\n${USAGE}`);
  }
  const subject: Subject = values.film
    ? { kind: "film", name: filmName(values.film) }
    : { kind: "scene", name: videoScene(values.scene ?? "") };
  const size =
    subject.kind === "film" ? FILMS[filmName(subject.name)].size : FORMATS.get(values.format);
  if (!size) throw new Error(`Set --format to ${[...FORMATS.keys()].join(", ")}.`);
  if (values.theme !== "light" && values.theme !== "dark") {
    throw new Error("Set --theme to light or dark.");
  }
  if (values.keys !== "mac" && values.keys !== "pc") throw new Error("Set --keys to mac or pc.");
  const fps = Number(values.fps);
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) {
    throw new Error("Set --fps to a whole number from 1 to 120.");
  }
  const scale = Number(values.scale);
  if (scale !== 1 && scale !== 2) throw new Error("Set --scale to 1 or 2.");
  const blur = Number(values.blur);
  if (!Number.isInteger(blur) || blur < 1 || blur > 16) {
    throw new Error("Set --blur to a whole number from 1 (no motion blur) to 16.");
  }
  if (blur > 1 && values.frames !== undefined) {
    throw new Error("Save the frames with --frames without --blur.");
  }
  if (blur > 1 && !values.film) {
    throw new Error("Set --blur only for a film: a scene has no camera that moves.");
  }
  const length = values.seconds === undefined ? undefined : Number(values.seconds);
  if (length !== undefined && !(length > 0)) throw new Error("Set --seconds to a positive number.");
  const format = subject.kind === "film" ? `${size.width}x${size.height}` : values.format;
  const slug = `${subject.name}-${format.replace(":", "x")}-${values.theme}`;
  const snaps = values.snap?.split(",").map((time) => seconds(time, "--snap"));
  return {
    subject,
    format,
    ...size,
    theme: values.theme,
    keys: values.keys,
    fps,
    scale,
    blur,
    from: seconds(values.from, "--from"),
    seconds: length,
    out: resolve(values.out ?? join(VIDEO_DIR, "out", snaps ? slug : `${slug}.mp4`)),
    frames: values.frames === undefined ? undefined : resolve(values.frames),
    snaps: snaps?.toSorted((a, b) => a - b),
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

/**
 * Starts ffmpeg, which reads PNG frames on its input and writes an H.264 MP4 file in BT.709. With
 * motion blur, the input has `blur` screenshots for each frame, and ffmpeg mixes each group into
 * one frame.
 */
function startEncoder(ffmpeg: string, job: Job): Bun.Subprocess<"pipe", "ignore", "pipe"> {
  mkdirSync(dirname(job.out), { recursive: true });
  const { blur } = job;
  const mix =
    blur > 1
      ? [`tmix=frames=${blur}`, `select='eq(mod(n,${blur}),${blur - 1})'`, "setpts=PTS-STARTPTS"]
      : [];
  return Bun.spawn(
    [
      ffmpeg,
      "-y",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-framerate",
      String(job.fps * blur),
      "-c:v",
      "png",
      "-i",
      "-",
      "-vf",
      [...mix, "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"].join(","),
      "-r",
      String(job.fps),
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

/** The query of the video page for the job. */
function pageQuery(job: Job): URLSearchParams {
  const { theme, keys } = job;
  if (job.subject.kind === "film")
    return new URLSearchParams({ film: job.subject.name, theme, keys });
  const size = { width: String(job.width), height: String(job.height) };
  return new URLSearchParams({ scene: job.subject.name, theme, keys, ...size });
}

/** The frame times of the video: from `--from`, for `--seconds` or up to the end. */
function frameTimes(job: Job, duration: number): number[] {
  const name = `${job.subject.kind} ${job.subject.name}`;
  if (job.from >= duration) {
    throw new Error(`The ${name} lasts ${duration.toFixed(2)} s. Set --from below that.`);
  }
  const length = job.seconds ?? duration - job.from;
  if (job.from + length > duration + 1e-6) {
    throw new Error(
      `The ${name} lasts ${duration.toFixed(2)} s. Set --from and --seconds to end there or before.`,
    );
  }
  // The last frame starts before the end of the run: `seek` accepts times below the duration.
  const count = Math.ceil(length * job.fps - 1e-6);
  return Array.from({ length: count }, (_, index) => job.from + index / job.fps);
}

async function render(job: Job): Promise<void> {
  const ffmpeg = job.snaps ? undefined : findFfmpeg();
  const server = await createServer({
    configFile: false,
    root: VIDEO_DIR,
    cacheDir: join(VIDEO_DIR, "../node_modules/.vite-video"),
    logLevel: "error",
    // The page loads the sources once. A change of a source while the job runs must not reload
    // the page, so the server neither watches the files nor sends updates.
    server: { host: "127.0.0.1", port: 0, strictPort: true, hmr: false, watch: null },
  });
  const browser = await chromium.launch({ args: ["--force-color-profile=srgb"] });
  try {
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error("The Vite server of the video page has no local address.");
    const context = await browser.newContext({
      viewport: { width: job.width, height: job.height },
      deviceScaleFactor: job.scale,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    // The screenshots of this session have the pixels of the screen only with its own metrics.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: job.width,
      height: job.height,
      deviceScaleFactor: job.scale,
      mobile: false,
    });
    await page.goto(`${base}?${pageQuery(job)}`);
    await page.waitForFunction(() => window.__sceneVideo !== undefined);
    const duration = await page.evaluate(() => window.__sceneVideo?.ready);
    if (duration === undefined) throw new Error("The video page did not mount the scene.");
    const capture = async (time: number): Promise<Buffer> => {
      await page.evaluate((at) => window.__sceneVideo?.seek(at), time);
      const shot = await cdp.send("Page.captureScreenshot", {
        format: "png",
        optimizeForSpeed: true,
      });
      const [error] = errors;
      if (error) throw new Error(`The video page failed: ${error.message}`);
      return Buffer.from(shot.data, "base64");
    };

    if (job.snaps) {
      mkdirSync(job.out, { recursive: true });
      for (const time of job.snaps) {
        if (time >= duration)
          throw new Error(`Set each --snap time below ${duration.toFixed(2)} s.`);
        const file = join(job.out, `snap-${time.toFixed(2).padStart(6, "0")}.png`);
        await Bun.write(file, await capture(time));
        console.log(`Wrote ${file}`);
      }
      return;
    }

    const times = frameTimes(job, duration);
    const blurred = job.blur > 1 ? `, ${job.blur} screenshots each` : "";
    console.log(
      `Rendering ${job.subject.name} (${job.format}, ${job.theme}): ${times.length} frames at ${job.fps} fps${blurred}.`,
    );
    // The frames before --from show no image, but the page plays them, in steps.
    if (job.from > 0) await page.evaluate((at) => window.__sceneVideo?.seek(at), job.from);
    if (job.frames) mkdirSync(job.frames, { recursive: true });
    if (!ffmpeg) throw new Error("A video needs ffmpeg.");
    const encoder = startEncoder(ffmpeg, job);
    try {
      // The screenshots of a frame cover the first half of its time, as a shutter of 180 degrees.
      // A frame where the camera of a film does not move repeats its first screenshot, because a
      // still image needs no motion blur.
      const step = 0.5 / job.fps / job.blur;
      const moved = (): Promise<boolean> =>
        page.evaluate(() => window.__sceneVideo?.moved() ?? false);
      for (const [index, time] of times.entries()) {
        if (index > 0 && index % (job.fps * 10) === 0) {
          console.log(
            `${(index / job.fps).toFixed(0)} s of ${(times.length / job.fps).toFixed(0)} s`,
          );
        }
        const first = await capture(time);
        if (job.frames) {
          await Bun.write(join(job.frames, `frame-${String(index).padStart(5, "0")}.png`), first);
        }
        encoder.stdin.write(first);
        await encoder.stdin.flush();
        const blurred = job.blur > 1 && (await moved());
        for (let shot = 1; shot < job.blur; shot += 1) {
          encoder.stdin.write(
            blurred ? await capture(Math.min(duration, time + shot * step)) : first,
          );
          await encoder.stdin.flush();
        }
      }
    } catch (error) {
      // ffmpeg waits for more frames, so it stops here and the command can end with the error.
      encoder.kill();
      throw error;
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
