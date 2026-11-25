import { afterAll, beforeAll, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

let view: Bun.WebView;

/*
 * The first browser start on a fresh GitHub Linux runner took 1 to 14 seconds, and a second start
 * on the same runner took under 1 second. The test measures the tab, so the browser starts before
 * it.
 */
beforeAll(async () => {
  view = new Bun.WebView({
    backend: process.platform === "darwin" ? "webkit" : { type: "chrome", url: false },
    console: globalThis.console,
  });
  await view.navigate("about:blank");
}, 30_000);

afterAll(() => {
  view.close();
});

// The case bundles its React entry point.
test("a web runner tab opens, takes keyboard focus and keeps its iframe when hidden", async () => {
  const { outputs } = await Bun.build({
    entrypoints: [
      fileURLToPath(
        new URL(
          "../../../frontend/src/features/browser/browser-tab-content.fixture.tsx",
          import.meta.url,
        ),
      ),
    ],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const [script] = outputs;
  if (!script) throw new Error("The browser test bundle has no entry point.");

  const previewRequest = Promise.withResolvers<string>();
  using preview = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      previewRequest.resolve(new URL(request.url).pathname);
      return new Response("<!doctype html><title>Browser tab preview</title>", {
        headers: { "content-type": "text/html" },
      });
    },
  });
  using app = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/": new Response(
        '<!doctype html><title>Browser tab test</title><main id="fixture"></main><script type="module" src="/fixture.js"></script>',
        { headers: { "content-type": "text/html" } },
      ),
      "/fixture.js": new Response(script, { headers: { "content-type": "text/javascript" } }),
      "/favicon.ico": new Response(null, { status: 204 }),
    },
  });
  const url = new URL(app.url);
  url.searchParams.set("preview", preview.url.origin);
  await view.navigate(url.href);
  await view.scrollTo("[data-toggle-tab]", { timeout: 3_000 });
  expect(
    await view.evaluate(`({
      button: document.querySelector('[data-toggle-tab]')?.textContent,
      hasFrame: document.querySelector('iframe') !== null,
    })`),
  ).toEqual({ button: "Show browser tab", hasFrame: false });

  await view.click("[data-toggle-tab]", { timeout: 3_000 });
  await view.scrollTo('iframe[title="Page"]', { timeout: 3_000 });
  expect(await previewRequest.promise).toBe("/");
  expect(
    await view.evaluate(`(() => {
      const frame = document.querySelector('iframe[title="Page"]');
      const slot = document.querySelector('[role="group"][aria-label="Page"]');
      const address = document.querySelector('input[aria-label="Address"]');
      window.testFrame = frame;
      slot.focus();
      const focusedFromSlot = document.activeElement === frame;
      address.focus();
      address.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', bubbles: true, cancelable: true }));
      const storageAccess = 'allow-storage-access-by-user-activation';
      const electronTools = ['Annotate', 'Share with agents', 'Site settings'];
      return {
        focusedFromSlot,
        focusedFromAddress: document.activeElement === frame,
        hasWindow: frame.contentWindow !== null,
        storageAccess: frame.sandbox.supports(storageAccess) && frame.sandbox.contains(storageAccess),
        hasElectronTools: Array.from(document.querySelectorAll('button')).some(button =>
          electronTools.includes(button.getAttribute('aria-label') ?? button.textContent.trim())),
      };
    })()`),
  ).toEqual({
    focusedFromSlot: true,
    focusedFromAddress: true,
    hasWindow: true,
    storageAccess: true,
    hasElectronTools: false,
  });

  await view.click("[data-toggle-tab]", { timeout: 3_000 });
  expect(
    await view.evaluate(`document.querySelector('[role="group"][aria-label="Page"]') === null &&
      document.querySelector('iframe[title="Page"]') === window.testFrame`),
  ).toBe(true);
}, 10_000);
