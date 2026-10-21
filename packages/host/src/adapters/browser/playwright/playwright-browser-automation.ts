import { Effect } from "effect";
import {
  type Browser,
  type ConnectOverCDPTransport,
  chromium,
  errors,
  type Page,
} from "playwright-core";
import { z } from "zod";
import {
  BrowserAutomationError,
  type BrowserAutomationTransport,
  type BrowserAutomationPage,
  type BrowserAutomationPort,
} from "../../../ports/browser-automation-port";
import { StaleRefError, toAutomationError } from "./playwright-automation-errors";
import { markRequiredSnapshotFields, snapshotFieldRefs } from "./playwright-snapshot-fields";

/**
 * Drives one page with playwright-core over the in-process CDP transport of a proxy client, so it
 * opens no network port. `noDefaults` keeps the download, focus,
 * and media overrides of Playwright away from the page that the user shares.
 */
export const createPlaywrightBrowserAutomation = (): BrowserAutomationPort => ({
  connect: (proxy: BrowserAutomationTransport, timeoutMs: number) =>
    Effect.gen(function* () {
      const transport: ConnectOverCDPTransport = {
        // Playwright leaves `undefined` fields in params. A JSON round trip drops them like a socket would.
        send: (message) => proxy.send(commandSchema.parse(JSON.parse(JSON.stringify(message)))),
        // A socket reports its own close too. `browser.close()` waits for `onclose`, and the
        // proxy reports only the end of the page.
        close: () => {
          proxy.close();
          setImmediate(() => transport.onclose?.("The automation client closed the stream."));
        },
      };
      // Like a socket, deliver each message in its own task, in order. Playwright registers a reply
      // callback after `send` returns, and it handles a reply in promise jobs that must finish
      // before the next message. For example, it drops a page context event that arrives before
      // it handled the frame tree reply.
      proxy.receive((message) => setImmediate(() => transport.onmessage?.(message)));
      proxy.onClose((reason) => setImmediate(() => transport.onclose?.(reason)));
      const browser = yield* attempt("Connect", () =>
        chromium.connectOverCDP(transport, { noDefaults: true, timeout: timeoutMs }),
      );
      const page = browser.contexts()[0]?.pages()[0];
      if (page === undefined) {
        yield* Effect.promise(() => browser.close());
        return yield* new BrowserAutomationError({
          kind: "failed",
          message: "The automation client found no page in this tab.",
        });
      }
      return createPage(browser, page);
    }),
});

const commandSchema = z.object({
  id: z.number().int(),
  method: z.string(),
  params: z.record(z.string(), z.json()).optional(),
  sessionId: z.string().optional(),
});

const attempt = <A>(action: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => toAutomationError(cause, action) });

/**
 * Resolves a ref from the latest snapshot. A locator for a ref that matches nothing would wait
 * until its timeout, so an unknown or outdated ref fails at once.
 */
const locator = async (page: Page, ref: string) => {
  const element = page.locator(`aria-ref=${ref}`);
  if ((await element.count()) === 0) {
    throw new StaleRefError(`Element ref ${ref} is not on the page.`);
  }
  return element;
};

/** How long a mark waits for a field of the snapshot. A field that left the page gets no mark. */
const FIELD_MARK_TIMEOUT_MS = 1_000;

/**
 * Tells if a field is required. `getAttribute` resolves the ref in the utility world of the
 * snapshot; an `evaluate` would run in the main world, which does not know the refs.
 */
const isRequiredField = async (page: Page, ref: string): Promise<boolean> => {
  const field = page.locator(`aria-ref=${ref}`);
  const options = { timeout: FIELD_MARK_TIMEOUT_MS };
  try {
    const [required, ariaRequired] = await Promise.all([
      field.getAttribute("required", options),
      field.getAttribute("aria-required", options),
    ]);
    return required !== null || ariaRequired === "true";
  } catch (cause) {
    if (cause instanceof errors.TimeoutError) return false;
    throw cause;
  }
};

/** Marks the required fields of a snapshot. */
const markRequiredFields = async (page: Page, snapshot: string): Promise<string> => {
  const refs = snapshotFieldRefs(snapshot);
  const required = await Promise.all(refs.map((ref) => isRequiredField(page, ref)));
  return markRequiredSnapshotFields(
    snapshot,
    new Set(refs.filter((_ref, index) => required[index])),
  );
};

const createPage = (browser: Browser, page: Page): BrowserAutomationPage => {
  // Playwright dismisses dialogs that have no listener. The host prompt answers them instead.
  page.on("dialog", () => {});
  return {
    snapshot: (timeoutMs) =>
      attempt("Snapshot", async () =>
        markRequiredFields(page, await page.ariaSnapshot({ mode: "ai", timeout: timeoutMs })),
      ),
    elementPoint: (ref, timeoutMs) =>
      attempt("Locate element", async () => {
        const box = await (await locator(page, ref)).boundingBox({ timeout: timeoutMs });
        return box === null ? null : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }),
    click: (ref, options, timeoutMs) =>
      attempt("Click", async () => {
        const element = await locator(page, ref);
        const clickOptions = {
          button: options.button,
          modifiers: [...options.modifiers],
          timeout: timeoutMs,
        };
        return options.doubleClick ? element.dblclick(clickOptions) : element.click(clickOptions);
      }),
    hover: (ref, timeoutMs) =>
      attempt("Hover", async () => (await locator(page, ref)).hover({ timeout: timeoutMs })),
    fill: (ref, text, timeoutMs) =>
      attempt("Type", async () => (await locator(page, ref)).fill(text, { timeout: timeoutMs })),
    press: (ref, key, timeoutMs) =>
      attempt("Press", async () =>
        ref === null
          ? page.keyboard.press(key)
          : (await locator(page, ref)).press(key, { timeout: timeoutMs }),
      ),
    selectOptions: (ref, values, timeoutMs) =>
      attempt("Select", async () =>
        (await locator(page, ref)).selectOption([...values], { timeout: timeoutMs }),
      ),
    scrollIntoView: (ref, timeoutMs) =>
      attempt("Scroll", async () =>
        (await locator(page, ref)).scrollIntoViewIfNeeded({ timeout: timeoutMs }),
      ),
    scrollBy: (deltaX, deltaY) =>
      attempt("Scroll", async () => {
        const size = await page.evaluate(() => ({
          width: globalThis.innerWidth,
          height: globalThis.innerHeight,
        }));
        await page.mouse.move(size.width / 2, size.height / 2);
        await page.mouse.wheel(deltaX, deltaY);
      }),
    screenshot: (ref, timeoutMs) =>
      attempt("Screenshot", async () => {
        const shot = { type: "png", scale: "css", timeout: timeoutMs } as const;
        const image =
          ref === null
            ? await page.screenshot(shot)
            : await (await locator(page, ref)).screenshot(shot);
        return new Uint8Array(image);
      }),
    waitFor: (condition, timeoutMs) =>
      attempt("Wait", async () => {
        if ("text" in condition) {
          await page
            .getByText(condition.text)
            .first()
            .waitFor({ state: "visible", timeout: timeoutMs });
        } else if ("ref" in condition) {
          // A wait for a ref must wait for an element that is not on the page yet, so it does not
          // use `locator`, which fails at once.
          await page
            .locator(`aria-ref=${condition.ref}`)
            .waitFor({ state: "visible", timeout: timeoutMs });
        } else if ("url" in condition) {
          await page.waitForURL(condition.url, { timeout: timeoutMs });
        } else {
          await page.waitForLoadState(condition.load, { timeout: timeoutMs });
        }
      }),
    close: () => Effect.promise(() => browser.close()),
  };
};
