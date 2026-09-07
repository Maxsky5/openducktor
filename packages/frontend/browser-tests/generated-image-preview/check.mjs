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
  if (document.querySelector('#root').textContent.includes(image.alt)) throw new Error('Prompt should remain collapsed while previewing');
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
      await browser(
        "eval",
        `(() => {
        const root = document.querySelector('#root');
        const image = root.querySelector('img');
        const card = root.firstElementChild;
        if (Math.abs(card.getBoundingClientRect().width - root.getBoundingClientRect().width) > 1) throw new Error('Completed card does not fill the available width');
        const button = root.querySelector('[data-slot="collapsible-trigger"]');
        if (button.getAttribute('aria-expanded') !== 'false' || root.textContent.includes(image.alt)) throw new Error('Prompt is not collapsed by default');
        if (!root.textContent.includes('/runtime/generated/images/') || !root.textContent.includes('Opaque')) throw new Error('File and background details are not visible');
        const copy = root.querySelector('button[aria-label="Copy generated image path"]');
        const path = copy.parentElement.querySelector('span');
        const range = document.createRange();
        range.selectNodeContents(path);
        const lastLine = [...range.getClientRects()].at(-1);
        const copyBox = copy.getBoundingClientRect();
        if (copyBox.left - lastLine.right < 0 || copyBox.left - lastLine.right > 8 || copyBox.top > lastLine.bottom || copyBox.bottom < lastLine.top) throw new Error('Copy button does not follow the end of the path');
        const box = image.getBoundingClientRect();
        if (box.width < 300 || box.height < 200) throw new Error('Card preview is too small');
        if (root.scrollWidth > innerWidth) throw new Error('Card exceeds viewport');
      })()`,
      );
      const name = `${theme}-${width}x${height}`;
      await browser("screenshot", join(artifacts, `${name}-card.png`), "--full");
      await browser("focus", '[data-slot="collapsible-trigger"]');
      await browser("press", "Enter");
      await browser(
        "eval",
        `(() => {
        const root = document.querySelector('#root');
        if (!root.textContent.includes(root.querySelector('img').alt)) throw new Error('Prompt did not expand in full');
        const prompt = [...root.querySelectorAll('p')].find(p => p.textContent === root.querySelector('img').alt);
        if (prompt.scrollHeight > prompt.clientHeight + 1 || getComputedStyle(prompt).maxHeight !== 'none') throw new Error('Prompt has an inner scroll area');
        if (root.querySelector('[data-slot="collapsible-trigger"]').getAttribute('aria-expanded') !== 'true') throw new Error('Expanded state is missing');
        if (root.scrollWidth > innerWidth) throw new Error('Expanded prompt exceeds viewport');
      })()`,
      );
      await browser("screenshot", join(artifacts, `${name}-prompt.png`));
      await browser("press", "Enter");
      await browser("focus", trigger);
      await browser("press", "Enter");
      await browser("wait", '[role="dialog"] img');
      await browser(
        "eval",
        "Promise.all(document.getAnimations().map(animation => animation.finished))",
      );
      const result = await browser("eval", checkLayout);
      console.log(result.trim());
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
      await browser("open", `${url}?running`);
      await browser("wait", '[role="status"]');
      await browser("eval", `document.documentElement.className = '${theme}'`);
      await browser(
        "eval",
        `(() => {
        const root = document.querySelector('#root');
        const skeleton = root.querySelector('[data-slot="skeleton"]');
        if (!skeleton || skeleton.getBoundingClientRect().height < 200) throw new Error('Generating skeleton is missing or too small');
        if (root.querySelector('img') || root.querySelector('[role="progressbar"]')) throw new Error('Generating state claims output or progress');
        if (root.scrollWidth > innerWidth) throw new Error('Generating card exceeds viewport');
      })()`,
      );
      await browser("screenshot", join(artifacts, `${name}-running.png`));
      await browser("open", `${url}?failed`);
      await browser("wait", '[role="alert"]');
      await browser("eval", `document.documentElement.className = '${theme}'`);
      await browser(
        "eval",
        `(() => {
        const root = document.querySelector('#root');
        const alert = root.querySelector('[role="alert"]');
        if (!alert.textContent.includes('It did not include a reason in the image result.') || !alert.textContent.includes('Ask the agent to explain this failure before trying again.')) throw new Error('Failure lacks an explanation or next action');
        if (root.querySelector('img') || root.querySelector('[data-slot="skeleton"]')) throw new Error('Failed generation shows output or a loading skeleton');
        if (root.scrollWidth > innerWidth) throw new Error('Failed card exceeds viewport');
      })()`,
      );
      await browser("screenshot", join(artifacts, `${name}-failed.png`));
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
  for (const result of cleanup) {
    if (result.status === "rejected") errors.push(result.reason);
  }
}

if (failure !== undefined) errors.unshift(failure);
if (errors.length) throw new AggregateError(errors, "Generated image layout check failed");
