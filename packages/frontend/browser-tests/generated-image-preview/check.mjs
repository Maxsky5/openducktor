import { execFileSync } from "node:child_process";

const session = execFileSync(
  "agent-browser",
  ["session", "id", "--scope", "worktree", "--prefix", "image-preview"],
  { encoding: "utf8" },
).trim();
const browser = (...args) =>
  execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8" });
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

try {
  for (const theme of ["light", "dark"]) {
    for (const [width, height] of [
      [1280, 577],
      [390, 320],
    ]) {
      browser("set", "viewport", String(width), String(height));
      browser("open", "http://127.0.0.1:4198");
      browser("wait", trigger);
      browser("eval", `document.documentElement.className = '${theme}'`);
      browser("focus", trigger);
      browser("press", "Enter");
      browser("wait", '[role="dialog"] img');
      // Let the production dialog's entrance animation finish before measuring its bounds.
      browser("eval", "Promise.all(document.getAnimations().map(animation => animation.finished))");
      console.log(browser("eval", checkLayout).trim());
      browser("press", "Escape");
      browser("eval", "Promise.all(document.getAnimations().map(animation => animation.finished))");
      browser(
        "eval",
        `if (document.querySelector('[role="dialog"]') || document.activeElement !== document.querySelector('${trigger}')) throw new Error('Escape did not close and restore focus')`,
      );
    }
  }
} finally {
  browser("close");
}
