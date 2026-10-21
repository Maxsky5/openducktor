import { describe, expect, test } from "bun:test";
import { ODT_BROWSER_TOOL_TIMEOUT_MS } from "@openducktor/contracts";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { BrowserEngineEvent } from "../../ports/browser-engine-port";
import { createBrowserPageSessionTestDouble } from "../../test-support/browser-page-session-test-double";
import {
  createBrowserServiceHarness,
  tabId,
  taskOwner,
  waitUntil,
} from "./test-support/browser-service-harness";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

/** A user tab whose page session runs on a scripted CDP session. */
const startLiveTab = async (
  options: Pick<
    Parameters<typeof createBrowserServiceHarness>[0] & {},
    "beforeSitePermissionRead" | "engine"
  > = {},
) => {
  const page = createBrowserPageSessionTestDouble("http://localhost:3000/");
  const harness = createBrowserServiceHarness({
    ...options,
    engine: { ...options.engine, openSession: () => Effect.succeed(page.session) },
  });
  await run(
    harness.service.openTab({
      owner: taskOwner,
      tabId: tabId(1),
      address: "http://localhost:3000/",
    }),
  );
  const summary = () =>
    Effect.runSync(harness.service.listTabs()).find((tab) => tab.tabId === tabId(1));
  harness.engine.emit({ type: "tab_attached", tabId: tabId(1) });
  await waitUntil(() => summary()?.live === true);
  return { harness, page, summary };
};

/** A permission request that records every answer, also an answer after its end. */
const permissionRequest = (origin: string) => {
  const answers: boolean[] = [];
  const endListeners = new Set<() => void>();
  const event: BrowserEngineEvent = {
    type: "permission_requested",
    tabId: tabId(1),
    origin,
    permission: "camera",
    respond: (granted) => {
      answers.push(granted);
    },
    onEnded: (listener) => {
      endListeners.add(listener);
      return () => endListeners.delete(listener);
    },
  };
  return {
    event,
    answers,
    end: () => {
      for (const listener of Array.from(endListeners)) listener();
    },
  };
};

describe("browser service with a live page", () => {
  test("a request whose document ends during the saved read gets no prompt and no grant", async () => {
    const read = Deferred.makeUnsafe<void>();
    // The tab is not attached yet: the request comes while the page loads.
    const harness = createBrowserServiceHarness({ beforeSitePermissionRead: Deferred.await(read) });
    harness.sitePermissionFiles.set("workspace-1", {
      version: 1,
      sites: { "https://old.example": { camera: "granted" } },
    });
    await run(harness.service.openTab({ owner: taskOwner, tabId: tabId(1), address: null }));
    const request = permissionRequest("https://old.example");

    harness.engine.emit(request.event);
    request.end();
    // Requests of one workspace run in order, so the prompt of a later request shows that the
    // first request finished.
    const later = permissionRequest("https://later.example");
    harness.engine.emit(later.event);
    Deferred.doneUnsafe(read, Exit.void);
    const prompts = () => Effect.runSync(harness.service.listTabs())[0]?.prompts ?? [];
    await waitUntil(() => prompts().length > 0);

    expect(request.answers).toEqual([]);
    expect(prompts()).toMatchObject([{ kind: "permission", origin: "https://later.example" }]);
  });

  test("an answer that waits behind other permission work does nothing after its document ends", async () => {
    const resetHeld = Deferred.makeUnsafe<void>();
    const { harness, summary } = await startLiveTab({
      engine: { revokeSitePermissions: () => Deferred.await(resetHeld) },
    });
    const request = permissionRequest("https://old.example");
    harness.engine.emit(request.event);
    await waitUntil(() => summary()?.prompts.length === 1);
    const promptId = summary()?.prompts[0]?.promptId ?? "";

    const reset = run(
      harness.service.resetSitePermissions({
        workspaceId: "workspace-1",
        origin: "https://other.example",
        permission: null,
      }),
    );
    const answered = run(
      harness.service.answerPrompt({
        tabId: tabId(1),
        promptId,
        answer: { kind: "permission", allow: true },
      }),
    );
    request.end();
    Deferred.doneUnsafe(resetHeld, Exit.void);
    await Promise.all([reset, answered]);

    expect(request.answers).toEqual([]);
    expect(harness.sitePermissionFiles.get("workspace-1")?.sites["https://old.example"]).toBe(
      undefined,
    );
  });

  test("a prompt goes away when its document ends, and a navigation denies its request", async () => {
    const { harness, page, summary } = await startLiveTab();
    const ended = permissionRequest("http://localhost:3000");
    harness.engine.emit(ended.event);
    await waitUntil(() => summary()?.prompts.length === 1);

    ended.end();
    expect(summary()?.prompts).toEqual([]);

    const navigated = permissionRequest("http://localhost:3000");
    harness.engine.emit(navigated.event);
    await waitUntil(() => summary()?.prompts.length === 1);
    page.emit("Page.frameNavigated", { frame: { id: "T1", url: "http://localhost:3000/next" } });

    expect(summary()?.prompts).toEqual([]);
    expect(navigated.answers).toEqual([false]);
  });

  test("ends an agent call at its time limit, before the MCP client stops waiting", async () => {
    const harness = createBrowserServiceHarness({
      engine: {
        state: () => ({ kind: "not_installed", version: "1", downloadBytes: 10 }),
        // The install never reports an outcome, so only the call time limit ends the call.
        installer: { start: () => Effect.never, cancel: () => Effect.void },
      },
    });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const call = yield* Effect.forkChild(
          Effect.flip(
            harness.service.runAgentTool(taskOwner, "odt_browser_open", {
              url: "http://localhost:3000/",
            }),
          ),
        );
        yield* TestClock.adjust(ODT_BROWSER_TOOL_TIMEOUT_MS);
        return yield* Fiber.join(call);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(error).toMatchObject({
      code: "browser_timeout",
      operation: "browser.agent.odt_browser_open",
    });
    expect(error.message).toContain("take a snapshot before you try again");
    expect(harness.engine.created).toEqual([]);
  });

  test("opening an agent tab returns the dialog of its first page while the page loads", async () => {
    const page = createBrowserPageSessionTestDouble("http://localhost:3000/consent");
    const harness = createBrowserServiceHarness({
      engine: { openSession: () => Effect.succeed(page.session) },
    });
    // The page session does not finish its start, so the tab stays loading.
    page.hold("Page.getNavigationHistory");

    const call = run(
      harness.service.runAgentTool(taskOwner, "odt_browser_open", {
        url: "http://localhost:3000/consent",
      }),
    );
    await waitUntil(() => harness.engine.created.length === 1);
    const agentTabId = harness.engine.created[0] ?? "";
    harness.engine.emit({ type: "tab_attached", tabId: agentTabId });
    await waitUntil(() =>
      page.sent.some((command) => command.method === "Page.getNavigationHistory"),
    );
    page.emit("Page.javascriptDialogOpening", {
      url: "http://localhost:3000/consent",
      frameId: "T1",
      message: "Consent?",
      type: "confirm",
      hasBrowserHandler: true,
    });
    const result = await call;

    const text = result.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
    expect(text.join("\n")).toContain("opened a JS confirm dialog in tab");
    expect(text.join("\n")).toContain('"Consent?"');
    const tab = () =>
      Effect.runSync(harness.service.listTabs()).find((entry) => entry.tabId === agentTabId);
    expect(tab()?.prompts).toMatchObject([{ kind: "dialog", startedByAgent: true }]);
    expect(tab()?.agentActive).toBe(false);

    // A dialog that opens outside an agent action belongs to the user.
    page.emit("Page.javascriptDialogOpening", {
      url: "http://localhost:3000/consent",
      frameId: "T1",
      message: "Leave?",
      type: "confirm",
      hasBrowserHandler: true,
    });
    expect(tab()?.prompts).toMatchObject([{ kind: "dialog", startedByAgent: false }]);
    page.release("Page.getNavigationHistory");
  });

  test("an agent navigation returns the dialog that it opened before the navigation finishes", async () => {
    const { harness, page } = await startLiveTab();
    await run(harness.service.setShared({ tabId: tabId(1), shared: true }));
    page.hold("Page.navigate");

    const call = run(
      harness.service.runAgentTool(taskOwner, "odt_browser_navigate", {
        tabId: tabId(1),
        url: "http://localhost:3000/next",
      }),
    );
    await waitUntil(() => page.sent.some((command) => command.method === "Page.navigate"));
    page.emit("Page.javascriptDialogOpening", {
      url: "http://localhost:3000/",
      frameId: "T1",
      message: "",
      type: "beforeunload",
      hasBrowserHandler: true,
    });
    const result = await call;

    const text = result.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
    expect(text.join("\n")).toContain("opened a JS beforeunload dialog");
    page.release("Page.navigate");
  });

  test("an agent action on a saved agent tab gives the tab its page first", async () => {
    const page = createBrowserPageSessionTestDouble("http://localhost:3000/");
    const harness = createBrowserServiceHarness({
      engine: { openSession: () => Effect.succeed(page.session) },
      savedTabs: [
        {
          tabId: tabId(1),
          owner: taskOwner,
          url: "http://localhost:3000/",
          title: "App",
          createdBy: "agent",
          shared: false,
        },
      ],
    });
    const listed = await run(harness.service.runAgentTool(taskOwner, "odt_browser_list", {}));
    expect(JSON.stringify(listed.content)).toContain("saved, starts when you use it");

    const call = run(
      harness.service.runAgentTool(taskOwner, "odt_browser_navigate", {
        tabId: tabId(1),
        url: "http://localhost:3000/next",
      }),
    );
    await waitUntil(() => harness.engine.created.length === 1);
    harness.engine.emit({ type: "tab_attached", tabId: tabId(1) });
    await call;

    expect(page.sent).toContainEqual({
      method: "Page.navigate",
      params: { url: "http://localhost:3000/next" },
    });
  });

  test("Reload goes to the engine and never sends Page.reload, which reloads an Electron window", async () => {
    const { harness, page } = await startLiveTab();

    await run(harness.service.navigate({ tabId: tabId(1), navigation: { kind: "reload" } }));

    expect(harness.engine.reloaded).toEqual([tabId(1)]);
    expect(page.sent.some((command) => command.method === "Page.reload")).toBe(false);
  });

  test("only the error page of the refused load keeps a certificate warning", async () => {
    const { harness, page, summary } = await startLiveTab();
    harness.engine.emit({
      type: "certificate_error",
      tabId: tabId(1),
      url: "https://localhost:3443/old",
      host: "localhost",
      error: "ERR_CERT_AUTHORITY_INVALID",
      mainFrame: true,
      respond: () => {},
    });
    const certificatePrompts = () =>
      summary()?.prompts.filter((prompt) => prompt.kind === "certificate") ?? [];
    const errorPage = (unreachableUrl: string) =>
      page.emit("Page.frameNavigated", {
        frame: { id: "T1", url: "chrome-error://chromewebdata/", unreachableUrl },
      });

    errorPage("https://localhost:3443/old");
    expect(certificatePrompts()).toHaveLength(1);

    // The same host on another scheme and port is another navigation.
    errorPage("http://localhost:39999/new");
    expect(certificatePrompts()).toEqual([]);
    expect(summary()).toMatchObject({
      url: "http://localhost:39999/new",
      error: { kind: "load_failed", url: "http://localhost:39999/new" },
    });
  });
});
