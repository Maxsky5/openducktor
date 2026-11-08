import {
  BROWSER_BLANK_URL,
  BROWSER_TAB_LIMIT,
  type BrowserTabCreator,
  type BrowserTabOwner,
  type BrowserTabPage,
  type BrowserTabSummary,
  type BrowserTabSurface,
} from "@openducktor/contracts";
import { Duration, Effect, Exit, Scope } from "effect";
import { createSerialGate } from "../../effect/serial-gate";
import type { BrowserEngineEvent, BrowserEnginePort } from "../../ports/browser-engine-port";
import type { BrowserSavedTab } from "../../ports/browser-tab-store-port";
import {
  type BrowserAnchorBoxes,
  type BrowserHostTabSession,
  startBrowserHostTabSession,
} from "./browser-host-tab-session";
import type { BrowserOwnerAccess } from "./browser-owner-access";
import type { BrowserPromptBook } from "./browser-prompt-book";
import { BrowserServiceError } from "./browser-service-error";
import { requireBrowserEngineReady, resolveBrowserAddress } from "./browser-tab-rules";
import { createBrowserFrameTabs } from "./browser-frame-tabs";
import { createBrowserTabNavigation } from "./browser-tab-navigation";
import type { BrowserTabRegistry } from "./browser-tab-registry";

export type BrowserTabServiceInput = {
  engine: BrowserEnginePort;
  ownerAccess: BrowserOwnerAccess;
  registry: BrowserTabRegistry;
  prompts: BrowserPromptBook;
  runJob(job: Effect.Effect<void>): void;
  /** The page script reported where the annotated elements of a tab are. */
  onAnchorBoxes(tabId: string, boxes: BrowserAnchorBoxes): void;
};

/** What happened to a popup that the engine opened. */
export type BrowserPopupResult = "added" | "no_opener" | "limit";

type LiveTab = { scope: Scope.Closeable; host: BrowserHostTabSession };

const ATTACH_TIMEOUT = Duration.seconds(10);

export const createBrowserTabService = ({
  engine,
  ownerAccess,
  registry,
  prompts,
  runJob,
  onAnchorBoxes,
}: BrowserTabServiceInput) => {
  const gate = createSerialGate();
  const liveTabs = new Map<string, LiveTab>();

  /** The web runner shows user tabs in frames of its app. Other pages run on the host. */
  const pageOf = (createdBy: BrowserTabCreator): BrowserTabPage =>
    createdBy === "agent" || engine.showsPagesToUser ? "host" : "frame";

  const newSummary = (input: {
    tabId: string;
    owner: BrowserTabOwner;
    createdBy: BrowserTabCreator;
    shared: boolean;
    openerTabId: string | null;
    surface: BrowserTabSurface;
    url: string;
  }): BrowserTabSummary => {
    const page = pageOf(input.createdBy);
    return {
      ...input,
      revision: 1,
      // Agents cannot reach a frame page, so only a user tab with a host page can be shared.
      shared: input.createdBy === "user" && page === "host" && input.shared,
      page,
      started: page === "host",
      live: false,
      title: null,
      favicon: null,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
      prompts: [],
      downloads: [],
      agentActive: false,
    };
  };

  const closeLive = (tabId: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      const live = liveTabs.get(tabId);
      if (!live) {
        return Effect.void;
      }
      liveTabs.delete(tabId);
      prompts.clearTab(tabId);
      registry.update(tabId, (summary) => ({ ...summary, live: false, loading: false }));
      return Scope.close(live.scope, Exit.void);
    });

  const attach = (tabId: string): Effect.Effect<void> =>
    gate.run(
      tabId,
      Effect.gen(function* () {
        yield* closeLive(tabId);
        const record = registry.get(tabId);
        if (!record) {
          return;
        }
        const scope = yield* Scope.make();
        const started = yield* Effect.exit(
          engine.openSession(tabId).pipe(
            Scope.provide(scope),
            Effect.flatMap((session) =>
              startBrowserHostTabSession({
                tabId,
                session,
                update: (change) => registry.update(tabId, change),
                prompts,
                isAgentActing: () => registry.get(tabId)?.summary.agentActive ?? false,
                runJob,
                onAnchorBoxes: (boxes) => onAnchorBoxes(tabId, boxes),
                onNavigated: (failedUrl) => {
                  prompts.removeKind(tabId, "permission");
                  // Another navigation replaces the refused load of a certificate warning. Only
                  // the error page of that refused URL keeps the warning.
                  const warning = prompts.find(tabId, "certificate");
                  if (warning && failedUrl !== warning.url) {
                    prompts.remove(tabId, warning.promptId);
                  }
                },
              }),
            ),
            // A page that loops can stop answering CDP. The tab lock must not wait for it.
            Effect.timeout(ATTACH_TIMEOUT),
          ),
        );
        if (Exit.isFailure(started)) {
          yield* Scope.close(scope, Exit.void);
          registry.update(tabId, (summary) => ({
            ...summary,
            live: false,
            error: {
              kind: "load_failed",
              url: summary.url,
              message:
                "OpenDucktor could not connect to this page. Close the tab and open it again.",
            },
          }));
          return;
        }
        const host = started.value;
        yield* Scope.addFinalizer(scope, Effect.sync(host.close));
        if (!registry.get(tabId)) {
          yield* Scope.close(scope, Exit.void);
          return;
        }
        liveTabs.set(tabId, { scope, host });
        registry.update(tabId, (summary) => ({ ...summary, live: true }));
      }),
    );

  const requireLive = (tabId: string, operation: string) =>
    Effect.suspend(() => {
      const live = liveTabs.get(tabId);
      return live
        ? Effect.succeed(live.host)
        : Effect.fail(
            new BrowserServiceError({
              code: "browser_action_failed",
              operation,
              message:
                "The page of this tab is not running yet. Wait until it loads, then try again.",
              tabId,
            }),
          );
    });

  const ownerIsFull = (owner: BrowserTabOwner): boolean =>
    registry.ownerTabs(owner).length >= BROWSER_TAB_LIMIT;

  const createEngineTab = (tabId: string, owner: BrowserTabOwner, url: string, operation: string) =>
    engine.createTab({ tabId, workspaceId: owner.workspaceId, url }).pipe(
      Effect.mapError(
        (cause) =>
          new BrowserServiceError({
            code: "browser_engine_error",
            operation,
            message: `The browser could not open the tab: ${cause.message}`,
            tabId,
            cause,
          }),
      ),
    );

  /**
   * Opens a tab in the gate of its ID, so the existing-tab decision, the owner check, and the
   * creation of one ID never interleave. The client chooses the ID of a user tab, so the panel can
   * place the tab before the host replies.
   */
  const openTab = (input: {
    tabId: string;
    owner: BrowserTabOwner;
    address: string | null;
    createdBy: BrowserTabCreator;
  }): Effect.Effect<BrowserTabSummary, BrowserServiceError> =>
    gate.run(
      input.tabId,
      Effect.gen(function* () {
        const operation = "browser.tab.open";
        if (registry.get(input.tabId)) {
          return yield* new BrowserServiceError({
            code: "browser_invalid_input",
            operation,
            message: "A browser tab with this ID already exists.",
            tabId: input.tabId,
          });
        }
        const url =
          input.address === null
            ? BROWSER_BLANK_URL
            : yield* resolveBrowserAddress(input.address, operation);
        const page = pageOf(input.createdBy);
        if (page === "host") {
          yield* requireBrowserEngineReady(engine.state(), operation);
        }
        const { owner } = input;
        yield* ownerAccess.requireOwner(owner, operation);
        if (ownerIsFull(owner)) {
          return yield* new BrowserServiceError({
            code: "browser_tab_limit",
            operation,
            message:
              input.createdBy === "agent"
                ? `This task already has ${BROWSER_TAB_LIMIT} browser tabs, which is the limit. Close one of your agent tabs with odt_browser_close, then try again.`
                : `This task already has ${BROWSER_TAB_LIMIT} browser tabs, which is the limit. Close a browser tab to open another.`,
          });
        }
        const summary = newSummary({
          tabId: input.tabId,
          owner,
          createdBy: input.createdBy,
          shared: false,
          openerTabId: null,
          surface: "panel",
          url,
        });
        // A frame page gets its page in the client, so the engine has nothing to open.
        if (page === "frame") {
          return registry.add(summary).summary;
        }
        // An agent opens a tab inside an agent action, which ends the activity mark when it ends.
        const record = registry.add(
          input.createdBy === "agent" ? { ...summary, agentActive: true } : summary,
        );
        yield* createEngineTab(input.tabId, owner, url, operation).pipe(
          Effect.onError(() => Effect.sync(() => registry.remove(input.tabId))),
        );
        return record.summary;
      }),
    );

  /** Adds the saved tabs of the last run. They get a page with `startTab`. */
  const addSaved = (saved: readonly BrowserSavedTab[]): void => {
    for (const tab of saved) {
      registry.add({
        ...newSummary({
          tabId: tab.tabId,
          owner: tab.owner,
          createdBy: tab.createdBy,
          shared: tab.shared,
          openerTabId: null,
          surface: "panel",
          url: tab.url === "" ? BROWSER_BLANK_URL : tab.url,
        }),
        title: tab.title,
        started: false,
      });
    }
  };

  /**
   * Gives a saved tab its page at its saved URL. A tab that started stays as it is. A failure
   * shows in the tab, so the user can read it and try again.
   */
  const startTab = (
    tabId: string,
    operation: string,
  ): Effect.Effect<BrowserTabSummary, BrowserServiceError> =>
    gate.run(
      tabId,
      Effect.gen(function* () {
        const record = yield* registry.require(tabId, operation);
        const { owner, url, started, page } = record.summary;
        if (page === "frame") {
          return yield* new BrowserServiceError({
            code: "browser_invalid_input",
            operation,
            message: "This tab shows its page in a frame of the app, so it has no page to start.",
            tabId,
          });
        }
        if (started) return record.summary;
        yield* Effect.gen(function* () {
          yield* requireBrowserEngineReady(engine.state(), operation);
          yield* ownerAccess.requireOwner(owner, operation);
          yield* createEngineTab(tabId, owner, url, operation);
        }).pipe(
          Effect.tapError((failure) =>
            Effect.sync(() =>
              registry.update(tabId, (summary) => ({
                ...summary,
                error: { kind: "load_failed", url: summary.url, message: failure.message },
              })),
            ),
          ),
        );
        registry.update(tabId, (summary) => ({ ...summary, started: true, error: null }));
        return registry.get(tabId)?.summary ?? record.summary;
      }),
    );

  const frameTabs = createBrowserFrameTabs({ gate, registry });

  const removeTab = (tabId: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* closeLive(tabId);
      registry.remove(tabId);
    });

  /** A popup window lives only as long as its opener tab. */
  const closePopupWindowsOf = (tabId: string): Effect.Effect<void, BrowserServiceError> =>
    Effect.forEach(
      registry
        .list()
        .filter((summary) => summary.openerTabId === tabId && summary.surface === "popup_window"),
      (popup) => closeTab(popup.tabId),
      { discard: true },
    );

  const closeTab = (tabId: string): Effect.Effect<void, BrowserServiceError> =>
    Effect.gen(function* () {
      yield* gate.run(
        tabId,
        Effect.gen(function* () {
          yield* registry.require(tabId, "browser.tab.close");
          yield* engine.closeTab(tabId).pipe(
            // A page that closed by itself is already gone from the engine.
            Effect.catchIf(
              (cause) => cause.code === "tab_not_found",
              () => Effect.void,
            ),
            Effect.mapError(
              (cause) =>
                new BrowserServiceError({
                  code: "browser_engine_error",
                  operation: "browser.tab.close",
                  message: `The browser could not close the tab: ${cause.message}`,
                  tabId,
                  cause,
                }),
            ),
          );
          yield* removeTab(tabId);
        }),
      );
      yield* closePopupWindowsOf(tabId);
    });

  /**
   * Closes a tab whose page closed by itself, for example with `window.close()`. The engine close
   * still runs, so the engine frees what it keeps for the tab, such as download files.
   */
  const endTab = (tabId: string): Effect.Effect<void, BrowserServiceError> =>
    closeTab(tabId).pipe(
      // The user or the host can close the tab at the same time.
      Effect.catchIf(
        (cause) => cause.code === "browser_tab_not_found",
        () => Effect.void,
      ),
    );

  const navigation = createBrowserTabNavigation({ engine, registry, liveTabs, requireLive });

  const setShared = (tabId: string, shared: boolean) =>
    Effect.gen(function* () {
      const record = yield* registry.require(tabId, "browser.tab.set_shared");
      if (record.summary.createdBy !== "user") {
        return yield* new BrowserServiceError({
          code: "browser_invalid_input",
          operation: "browser.tab.set_shared",
          message: "Only user tabs can be shared. Agents can always use their own tabs.",
          tabId,
        });
      }
      if (record.summary.page === "frame") {
        return yield* new BrowserServiceError({
          code: "browser_invalid_input",
          operation: "browser.tab.set_shared",
          message: "This tab shows its page in a frame of the app, which agents cannot reach.",
          tabId,
        });
      }
      registry.update(tabId, (summary) => ({ ...summary, shared }));
      return registry.get(tabId)?.summary ?? record.summary;
    });

  /**
   * Adds the tab of a popup that the engine opened, with the owner, creator, and sharing state of
   * its opener. A popup of a closed opener, or past the tab limit of the owner, gets no tab.
   */
  const addPopup = (
    event: Extract<BrowserEngineEvent, { type: "popup_opened" }>,
  ): Effect.Effect<BrowserPopupResult> =>
    gate.run(
      event.tabId,
      Effect.sync((): BrowserPopupResult => {
        const opener = registry.get(event.openerTabId);
        if (!opener) return "no_opener";
        const { owner, createdBy, shared } = opener.summary;
        if (ownerIsFull(owner)) return "limit";
        registry.add(
          newSummary({
            tabId: event.tabId,
            owner,
            createdBy,
            shared,
            openerTabId: event.keepsOpener ? opener.tabId : null,
            surface: event.surface,
            url: event.url,
          }),
        );
        return "added";
      }),
    );

  return {
    live: (tabId: string) => liveTabs.get(tabId)?.host ?? null,
    requireLive,
    attach,
    detach: (tabId: string) => gate.run(tabId, closeLive(tabId)),
    endTab,
    openTab,
    addSaved,
    startTab,
    reportFrameState: frameTabs.reportFrameState,
    closeTab,
    navigate: navigation.navigate,
    setShared,
    addPopup,
    heldNavigation: navigation.heldNavigation,
    leaveHeldPage: navigation.leaveHeldPage,
    dispose: () => Effect.forEach(Array.from(liveTabs.keys()), closeLive, { discard: true }),
  };
};

export type BrowserTabService = ReturnType<typeof createBrowserTabService>;
