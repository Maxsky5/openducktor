import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Effect, Exit, Scope } from "effect";
import { z } from "zod";
import { evaluateResultSchema } from "../ports/browser-cdp-schemas";
import type {
  BrowserEngineEvent,
  BrowserEnginePort,
  CdpEvent,
  CdpPayload,
  CdpSession,
} from "../ports/browser-engine-port";

export const WAIT_TIMEOUT_MS = 10_000;

const html = (title: string, body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

/** The test pages. Each check loads one of them from a loopback HTTP server. */
const conformancePage = (pathname: string): { type: string; body: string } | null => {
  switch (pathname) {
    case "/page":
      return { type: "text/html", body: html("Conformance page", "<h1>Conformance</h1>") };
    case "/second":
      return { type: "text/html", body: html("Second page", "<h1>Second</h1>") };
    case "/agent":
      return {
        type: "text/html",
        body: html(
          "Agent page",
          `<button onclick="document.title = 'Pressed'; console.log('pressed')">Press</button>`,
        ),
      };
    case "/form":
      return {
        type: "text/html",
        body: html(
          "Form page",
          `<label>Name <input id="name" required></label><label>Note <input id="note"></label>`,
        ),
      };
    case "/beforeunload":
      return {
        type: "text/html",
        body: html(
          "Before unload page",
          `<script>addEventListener("beforeunload", (event) => { event.preventDefault(); event.returnValue = "stay"; });</script>`,
        ),
      };
    default:
      return null;
  }
};

export type BrowserConformancePages = {
  /** For example `http://127.0.0.1:41234`. */
  readonly origin: string;
  close(): Promise<void>;
};

/** Serves the conformance pages on a loopback port. */
export const startBrowserConformancePages = async (): Promise<BrowserConformancePages> => {
  const server = createServer((request, response) => {
    const page = conformancePage(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    if (page === null) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "content-type": page.type });
    response.end(page.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = z.object({ port: z.number() }).parse(server.address());
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};

export type BrowserConformanceInput = {
  readonly engine: BrowserEnginePort;
  readonly pages: BrowserConformancePages;
  /** A workspace that only the conformance run uses. */
  readonly workspaceId: string;
};

export const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const withTimeout = async <A>(promise: Promise<A>, description: string): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Timed out after ${WAIT_TIMEOUT_MS} ms waiting for ${description}.`)),
          WAIT_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Records engine events from the start of a check, so no event is lost before a wait. */
export const recordEngineEvents = (engine: BrowserEnginePort) => {
  const seen: BrowserEngineEvent[] = [];
  const waiters = new Set<() => void>();
  const unsubscribe = engine.subscribe((event) => {
    seen.push(event);
    for (const waiter of Array.from(waiters)) waiter();
  });
  return {
    next<T extends BrowserEngineEvent>(
      description: string,
      matches: (event: BrowserEngineEvent) => event is T,
    ): Promise<T> {
      return withTimeout(
        new Promise<T>((resolve) => {
          const check = () => {
            const found = seen.find(matches);
            if (found) {
              waiters.delete(check);
              resolve(found);
            }
          };
          waiters.add(check);
          check();
        }),
        description,
      );
    },
    stop: unsubscribe,
  };
};

export const nextSessionEvent = (
  session: CdpSession,
  method: string,
  matches: (event: CdpEvent) => boolean = () => true,
): Promise<CdpEvent> =>
  withTimeout(
    new Promise<CdpEvent>((resolve) => {
      const unsubscribe = session.subscribe((event) => {
        if (event.method === method && matches(event)) {
          unsubscribe();
          resolve(event);
        }
      });
    }),
    method,
  );

export const evaluate = async (session: CdpSession, expression: string): Promise<CdpPayload> =>
  session.request("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });

export const evaluateValue = async (session: CdpSession, expression: string) =>
  evaluateResultSchema.parse(await evaluate(session, expression)).result.value ?? null;

export const waitForValue = async (
  session: CdpSession,
  expression: string,
  expected: string | number | boolean,
): Promise<void> => {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let last = "nothing";
  while (Date.now() < deadline) {
    const value = await evaluateValue(session, expression).catch(() => null);
    if (value === expected) return;
    last = JSON.stringify(value);
    await delay(50);
  }
  throw new Error(`Expected ${expression} to be ${String(expected)}, got ${last}.`);
};

export const isTabAttached =
  (tabId: string) =>
  (event: BrowserEngineEvent): event is Extract<BrowserEngineEvent, { type: "tab_attached" }> =>
    event.type === "tab_attached" && event.tabId === tabId;

/** Opens a tab and waits until its page accepts sessions. */
export const openTab = async (input: BrowserConformanceInput, path: string): Promise<string> => {
  const events = recordEngineEvents(input.engine);
  const tabId = randomUUID();
  try {
    await run(
      input.engine.createTab({
        tabId,
        workspaceId: input.workspaceId,
        url: `${input.pages.origin}${path}`,
      }),
    );
    await events.next("tab_attached", isTabAttached(tabId));
    return tabId;
  } finally {
    events.stop();
  }
};

export const closeTab = (input: BrowserConformanceInput, tabId: string) =>
  run(Effect.ignore(input.engine.closeTab(tabId)));

/** Runs `use` with one CDP session of the tab, then closes the session. */
export const withSession = async <A>(
  input: BrowserConformanceInput,
  tabId: string,
  use: (session: CdpSession) => Promise<A>,
): Promise<A> => {
  const scope = await run(Scope.make());
  try {
    const session = await run(Scope.provide(input.engine.openSession(tabId), scope));
    return await use(session);
  } finally {
    await run(Scope.close(scope, Exit.void));
  }
};

export const withTab = async (
  input: BrowserConformanceInput,
  path: string,
  use: (tabId: string) => Promise<void>,
): Promise<void> => {
  const tabId = await openTab(input, path);
  try {
    await use(tabId);
  } finally {
    await closeTab(input, tabId);
  }
};

export const waitForPage = (session: CdpSession, title: string) =>
  waitForValue(session, "document.readyState === 'complete' ? document.title : ''", title);
