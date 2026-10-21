import { Effect, Exit, Scope } from "effect";
import { createPlaywrightBrowserAutomation } from "../adapters/browser/playwright/playwright-browser-automation";
import { type CdpProxyClient, openCdpProxyClient } from "../application/browser/browser-cdp-proxy";
import type {
  BrowserAutomationMessage,
  BrowserAutomationPage,
} from "../ports/browser-automation-port";
import { evaluateResultSchema, targetInfoResultSchema } from "../ports/browser-cdp-schemas";
import type { BrowserEngineEvent, CdpPayload } from "../ports/browser-engine-port";
import {
  type BrowserConformanceInput,
  closeTab,
  evaluate,
  evaluateValue,
  isTabAttached,
  nextSessionEvent,
  openTab,
  recordEngineEvents,
  run,
  WAIT_TIMEOUT_MS,
  waitForPage,
  waitForValue,
  withSession,
  withTab,
  withTimeout,
} from "./browser-engine-conformance-support";

/** `createTab` gives `tab_attached`, and the page loads its URL. */
const verifyTabAttach = (input: BrowserConformanceInput): Promise<void> =>
  withTab(input, "/page", (tabId) =>
    withSession(input, tabId, (session) => waitForPage(session, "Conformance page")),
  );

/** `Runtime.evaluate` returns the value of an expression. */
const verifyEvaluate = (input: BrowserConformanceInput): Promise<void> =>
  withTab(input, "/page", (tabId) =>
    withSession(input, tabId, async (session) => {
      const value = await evaluateValue(session, "6 * 7");
      if (value !== 42) throw new Error(`Runtime.evaluate returned ${String(value)}, not 42.`);
    }),
  );

/** Two sessions of one tab are independent: one detaches and the other still works. */
const verifyIndependentSessions = (input: BrowserConformanceInput): Promise<void> =>
  withTab(input, "/page", (tabId) =>
    withSession(input, tabId, async (kept) => {
      let keptDetached = false;
      kept.onDetached(() => {
        keptDetached = true;
      });
      let closedDetached = false;
      await withSession(input, tabId, async (session) => {
        session.onDetached(() => {
          closedDetached = true;
        });
        await evaluate(session, "1");
      });
      if (!closedDetached) throw new Error("The closed session is still attached.");
      if (keptDetached) throw new Error("Closing one session detached the other session.");
      const value = await evaluateValue(kept, "2 + 3");
      if (value !== 5) throw new Error("The remaining session stopped working.");
    }),
  );

/** `Page.navigate` loads a loopback page. */
const verifyLoopbackNavigation = (input: BrowserConformanceInput): Promise<void> =>
  withTab(input, "/page", (tabId) =>
    withSession(input, tabId, async (session) => {
      await waitForPage(session, "Conformance page");
      await session.request("Page.navigate", { url: `${input.pages.origin}/second` });
      await waitForPage(session, "Second page");
      await waitForValue(session, "location.href", `${input.pages.origin}/second`);
    }),
  );

/** A JS `confirm` reaches `Page.javascriptDialogOpening`, and `Page.handleJavaScriptDialog` answers it. */
const verifyConfirmDialog = (input: BrowserConformanceInput): Promise<void> =>
  withTab(input, "/page", (tabId) =>
    withSession(input, tabId, async (session) => {
      await waitForPage(session, "Conformance page");
      await session.request("Page.enable");
      const opened = nextSessionEvent(session, "Page.javascriptDialogOpening");
      await evaluate(
        session,
        "setTimeout(() => { window.conformanceAnswer = confirm('Proceed?'); }, 0); true",
      );
      const dialog = await opened;
      if (dialog.params.type !== "confirm" || dialog.params.message !== "Proceed?") {
        throw new Error(`Unexpected dialog: ${JSON.stringify(dialog.params)}`);
      }
      await session.request("Page.handleJavaScriptDialog", { accept: true });
      await waitForValue(session, "window.conformanceAnswer", true);
    }),
  );

/** `closeTab` ends a page with a `beforeunload` handler at once. */
const verifyCloseIgnoresBeforeUnload = async (input: BrowserConformanceInput): Promise<void> => {
  const tabId = await openTab(input, "/beforeunload");
  const scope = await run(Scope.make());
  try {
    const session = await run(Scope.provide(input.engine.openSession(tabId), scope));
    await waitForPage(session, "Before unload page");
    // `beforeunload` asks only after a user gesture on the page.
    for (const type of ["mousePressed", "mouseReleased"]) {
      await session.request("Input.dispatchMouseEvent", {
        type,
        x: 10,
        y: 10,
        button: "left",
        clickCount: 1,
      });
    }
    const ended = withTimeout(
      new Promise<void>((resolve) => session.onDetached(() => resolve())),
      "the page to end",
    );
    const started = Date.now();
    await run(input.engine.closeTab(tabId));
    await ended;
    if (Date.now() - started > 3_000) {
      throw new Error("closeTab waited for the beforeunload handler.");
    }
  } finally {
    await run(Scope.close(scope, Exit.void));
    await closeTab(input, tabId);
  }
};

/** `window.open` gives `popup_opened` and a new attached tab. */
const verifyPopup = (input: BrowserConformanceInput): Promise<void> =>
  withTab(input, "/page", async (tabId) => {
    const events = recordEngineEvents(input.engine);
    let popupTabId: string | null = null;
    try {
      await withSession(input, tabId, async (session) => {
        await waitForPage(session, "Conformance page");
        await session.request("Runtime.evaluate", {
          expression: `window.open(${JSON.stringify(`${input.pages.origin}/second`)}, "_blank"); true`,
          userGesture: true,
        });
      });
      const popup = await events.next(
        "popup_opened",
        (event): event is Extract<BrowserEngineEvent, { type: "popup_opened" }> =>
          event.type === "popup_opened" && event.openerTabId === tabId,
      );
      popupTabId = popup.tabId;
      await events.next("the popup tab_attached", isTabAttached(popup.tabId));
      await withSession(input, popup.tabId, (session) => waitForPage(session, "Second page"));
    } finally {
      events.stop();
      if (popupTabId !== null) await closeTab(input, popupTabId);
    }
  });

type EventMessage = Extract<BrowserAutomationMessage, { method: string }>;

/** A `devtools` client of the CDP proxy, with each reply matched to its command. */
const openDevToolsClient = async (input: BrowserConformanceInput, tabId: string) => {
  let nextId = 1;
  let ended = false;
  const replies = new Map<number, (message: BrowserAutomationMessage) => void>();
  const listeners = new Set<(message: EventMessage) => void>();
  const proxy = await run(
    openCdpProxyClient({
      kind: "devtools",
      tabId,
      engine: input.engine,
      send: (message) => {
        if ("id" in message) {
          replies.get(message.id)?.(message);
          replies.delete(message.id);
          return;
        }
        for (const listener of Array.from(listeners)) listener(message);
      },
      onEnded: () => {
        ended = true;
      },
    }),
  );
  const request = (method: string, params?: CdpPayload): Promise<CdpPayload> =>
    withTimeout(
      new Promise<CdpPayload>((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        replies.set(id, (message) => {
          if ("error" in message) reject(new Error(`${method}: ${message.error.message}`));
          else if ("result" in message) resolve(message.result);
        });
        proxy.receive(params === undefined ? { id, method } : { id, method, params });
      }),
      `the DevTools reply to ${method}`,
    );
  return {
    request,
    evaluate: async (expression: string) =>
      evaluateResultSchema.parse(
        await request("Runtime.evaluate", { expression, returnByValue: true }),
      ).result.value ?? null,
    /** The next page event with this method. */
    nextEvent: (method: string): Promise<EventMessage> =>
      withTimeout(
        new Promise<EventMessage>((resolve) => {
          const listener = (message: EventMessage) => {
            if (message.method !== method || message.sessionId !== undefined) return;
            listeners.delete(listener);
            resolve(message);
          };
          listeners.add(listener);
        }),
        `the DevTools event ${method}`,
      ),
    ended: () => ended,
    close: () => run(proxy.close()),
  };
};

/** An `agent` client of the CDP proxy that Playwright drives, as the agent browser tools do. */
const connectAgent = async (
  input: BrowserConformanceInput,
  tabId: string,
): Promise<{ page: BrowserAutomationPage; proxy: CdpProxyClient }> => {
  let receiver: ((message: BrowserAutomationMessage) => void) | null = null;
  let closeReceiver: ((reason: string) => void) | null = null;
  const proxy = await run(
    openCdpProxyClient({
      kind: "agent",
      tabId,
      engine: input.engine,
      send: (message) => receiver?.(message),
      onEnded: () => closeReceiver?.("The page closed."),
      // The suite runs with no app window, so no focus guard waits for agent presses.
      onPressing: () => {},
    }),
  );
  const page = await run(
    createPlaywrightBrowserAutomation()
      .connect(
        {
          send: (command) => proxy.receive(command),
          receive: (listener) => {
            receiver = listener;
          },
          onClose: (listener) => {
            closeReceiver = listener;
          },
          close: () => {
            Effect.runFork(proxy.close());
          },
        },
        WAIT_TIMEOUT_MS,
      )
      .pipe(Effect.tapError(() => proxy.close())),
  );
  return { page, proxy };
};

/**
 * An agent drives the tab with Playwright through the CDP proxy while a DevTools client is
 * attached to the same tab. Each client has its own session, so both keep working.
 */
const verifyAgentWithDevTools = (input: BrowserConformanceInput): Promise<void> =>
  withTab(input, "/agent", async (tabId) => {
    await withSession(input, tabId, (session) => waitForPage(session, "Agent page"));
    const devTools = await openDevToolsClient(input, tabId);
    try {
      await devTools.request("Runtime.enable");
      const agent = await connectAgent(input, tabId);
      try {
        const snapshot = await run(agent.page.snapshot(WAIT_TIMEOUT_MS));
        const ref = snapshot.match(/button "Press"[^\n]*\[ref=(e\d+)\]/)?.[1];
        if (ref === undefined)
          throw new Error(`The agent snapshot has no Press button:\n${snapshot}`);
        const logged = devTools.nextEvent("Runtime.consoleAPICalled");
        await run(
          agent.page.click(
            ref,
            { button: "left", doubleClick: false, modifiers: [] },
            WAIT_TIMEOUT_MS,
          ),
        );
        await logged;
        const title = await devTools.evaluate("document.title");
        if (title !== "Pressed")
          throw new Error(`The agent click gave the title ${String(title)}.`);
      } finally {
        await run(agent.page.close().pipe(Effect.andThen(agent.proxy.close())));
      }
      const value = await devTools.evaluate("6 * 7");
      if (devTools.ended() || value !== 42) {
        throw new Error("The DevTools client stopped working after the agent left.");
      }
    } finally {
      await devTools.close();
    }
  });

/**
 * An agent types into a field before any click in the tab, and its snapshot marks required
 * fields. An Electron guest drops text input until a mouse press reaches its page.
 */
const verifyAgentTypesBeforeClick = (input: BrowserConformanceInput): Promise<void> =>
  withTab(input, "/form", async (tabId) => {
    await withSession(input, tabId, (session) => waitForPage(session, "Form page"));
    const agent = await connectAgent(input, tabId);
    try {
      const snapshot = await run(agent.page.snapshot(WAIT_TIMEOUT_MS));
      const nameRef = snapshot.match(/textbox "Name" \[required\] \[ref=(e\d+)\]/)?.[1];
      if (nameRef === undefined || !/textbox "Note" \[ref=e\d+\]/.test(snapshot)) {
        throw new Error(`The agent snapshot does not mark only the required field:\n${snapshot}`);
      }
      await run(agent.page.fill(nameRef, "Ada", WAIT_TIMEOUT_MS));
      const value = await withSession(input, tabId, (session) =>
        evaluateValue(session, "document.getElementById('name').value"),
      );
      if (value !== "Ada") throw new Error(`The agent typed ${JSON.stringify(value)}, not "Ada".`);
    } finally {
      await run(agent.page.close().pipe(Effect.andThen(agent.proxy.close())));
    }
  });

/** An agent screenshot gives a PNG of the viewport in CSS pixels. */
const verifyAgentScreenshot = (input: BrowserConformanceInput): Promise<void> =>
  withTab(input, "/page", async (tabId) => {
    const viewport = await withSession(input, tabId, async (session) => {
      await waitForPage(session, "Conformance page");
      return evaluateValue(session, "[innerWidth, innerHeight].join('x')");
    });
    const agent = await connectAgent(input, tabId);
    try {
      const image = await run(agent.page.screenshot(null, WAIT_TIMEOUT_MS));
      const header = new DataView(image.buffer, image.byteOffset, 24);
      const isPng = header.getUint32(0) === 0x89504e47;
      const size = `${header.getUint32(16)}x${header.getUint32(20)}`;
      if (!isPng || size !== viewport) {
        throw new Error(`The agent screenshot is ${isPng ? size : "not a PNG"}, not ${viewport}.`);
      }
    } finally {
      await run(agent.page.close().pipe(Effect.andThen(agent.proxy.close())));
    }
  });

/**
 * A DevTools client reaches only its tab. Chromium looks up a `targetId` in the whole browser, so
 * the proxy refuses a target ID of another tab.
 */
const verifyDevToolsTargetScope = (input: BrowserConformanceInput): Promise<void> =>
  withTab(input, "/page", (tabId) =>
    withTab(input, "/second", async (otherTabId) => {
      const otherTargetId = await withSession(
        input,
        otherTabId,
        async (session) =>
          targetInfoResultSchema.parse(await session.request("Target.getTargetInfo")).targetInfo
            .targetId,
      );
      const devTools = await openDevToolsClient(input, tabId);
      try {
        const own = targetInfoResultSchema.parse(await devTools.request("Target.getTargetInfo"));
        await devTools.request("Target.getTargetInfo", { targetId: own.targetInfo.targetId });
        const refused = await devTools
          .request("Target.getTargetInfo", { targetId: otherTargetId })
          .then(
            () => false,
            () => true,
          );
        if (!refused) {
          throw new Error("A DevTools client read the target of another tab.");
        }
      } finally {
        await devTools.close();
      }
    }),
  );

/** The engine checks. Each item is a test name and a check that runs against a real browser. */
export const BROWSER_ENGINE_CONFORMANCE_CHECKS: ReadonlyArray<
  readonly [name: string, verify: (input: BrowserConformanceInput) => Promise<void>]
> = [
  ["createTab gives tab_attached", verifyTabAttach],
  ["Runtime.evaluate works", verifyEvaluate],
  ["two sessions on one tab are independent", verifyIndependentSessions],
  ["navigation reaches a loopback page", verifyLoopbackNavigation],
  ["a confirm dialog reaches CDP and CDP answers it", verifyConfirmDialog],
  ["closeTab ends a page with a beforeunload handler at once", verifyCloseIgnoresBeforeUnload],
  ["window.open gives popup_opened", verifyPopup],
  ["an agent drives a tab while DevTools is attached", verifyAgentWithDevTools],
  ["an agent types before any click and sees required fields", verifyAgentTypesBeforeClick],
  ["an agent screenshot gives the viewport", verifyAgentScreenshot],
  ["a DevTools client cannot read the target of another tab", verifyDevToolsTargetScope],
];
