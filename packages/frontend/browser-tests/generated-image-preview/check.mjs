import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "vite";
import config from "./vite.config.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const artifacts = join(workspaceRoot, "dist/image-generation-layout");
const require = createRequire(import.meta.url);
const cli = require.resolve("agent-browser/bin/agent-browser.js");
const exec = promisify(execFile);
const session = `image-preview-${randomUUID()}`;
const browser = async (...args) =>
  (
    await exec(process.execPath, [cli, "--session", session, ...args], {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    })
  ).stdout;
await rm(artifacts, { recursive: true, force: true });
await mkdir(artifacts, { recursive: true });
const server = await createServer({
  ...config,
  configFile: false,
  server: { ...config.server, port: 0 },
  logLevel: "error",
});
const trigger = 'button[aria-label="Open generated image preview"]';
const checkLayout = `(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const image = dialog.querySelector('img');
  const box = image.getBoundingClientRect();
  const bounds = dialog.getBoundingClientRect();
  if (!image.complete || image.naturalWidth !== 800 || image.naturalHeight !== 600) throw new Error('PNG did not decode');
  if (box.height < Math.min(250, innerHeight / 2) || box.width < 200) throw new Error('Larger image lost usable space: ' + JSON.stringify(box));
  if (bounds.top < 0 || bounds.bottom > innerHeight || bounds.left < 0 || bounds.right > innerWidth) throw new Error('Dialog exceeds viewport');
  if (getComputedStyle(image).objectFit !== 'contain') throw new Error('Image aspect ratio is not preserved');
  if (image.alt.length < 4150) throw new Error('Long prompt fixture is missing');
  if (document.querySelector('#root').textContent.indexOf(image.alt) < 0) throw new Error('Full prompt is missing from transcript');
  if (dialog.textContent.includes(image.alt)) throw new Error('Full prompt consumes dialog space');
  return { viewport: [innerWidth, innerHeight], image: [box.width, box.height], theme: document.documentElement.className };
})()`;

let failure;
const errors = [];
let browserStarted = false;
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error("The image fixture server has no local URL.");
  for (const theme of ["light", "dark"]) {
    for (const [width, height] of [
      [1280, 577],
      [390, 320],
    ]) {
      browserStarted = true;
      await browser("set", "viewport", String(width), String(height));
      await browser("open", url);
      await browser("wait", trigger);
      await browser("eval", `document.documentElement.className = '${theme}'`);
      await browser("focus", trigger);
      await browser("press", "Enter");
      await browser("wait", '[role="dialog"] img');
      await browser(
        "eval",
        "Promise.all(document.getAnimations().map(animation => animation.finished))",
      );
      const result = await browser("eval", checkLayout);
      console.log(result.trim());
      const name = `${theme}-${width}x${height}`;
      await writeFile(join(artifacts, `${name}.json`), result);
      await browser("screenshot", join(artifacts, `${name}.png`));
      await browser("press", "Escape");
      await browser(
        "eval",
        "Promise.all(document.getAnimations().map(animation => animation.finished))",
      );
      await browser(
        "eval",
        `if (document.querySelector('[role="dialog"]') || document.activeElement !== document.querySelector('${trigger}')) throw new Error('Escape did not close and restore focus')`,
      );
    }
  }
} catch (error) {
  failure = error;
  await writeFile(join(artifacts, "failure.log"), String(error));
  if (browserStarted) {
    const capture = await Promise.allSettled([
      browser("screenshot", join(artifacts, "failure.png")),
    ]);
    if (capture[0].status === "rejected")
      console.error("Could not capture the failed preview:", capture[0].reason);
  }
} finally {
  const cleanup = await Promise.allSettled([
    server.close(),
    ...(browserStarted ? [browser("close")] : []),
  ]);
  errors.push(
    ...cleanup.filter((result) => result.status === "rejected").map((result) => result.reason),
  );
}

if (failure !== undefined) errors.unshift(failure);
if (errors.length) throw new AggregateError(errors, "Generated image layout check failed");
