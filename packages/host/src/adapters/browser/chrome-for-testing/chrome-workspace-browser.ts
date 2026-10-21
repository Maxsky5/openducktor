import { randomUUID } from "node:crypto";
import {
  BROWSER_BLANK_URL,
  type BrowserPermissionKind,
  isBrowserBlankUrl,
} from "@openducktor/contracts";
import { Deferred, Effect, Exit, FiberSet, Scope } from "effect";
import { z } from "zod";
import {
  BrowserEngineError,
  type BrowserEngineEvent,
  type CdpCommandError,
  type CdpEvent,
  type CdpPayload,
  type CdpSession,
} from "../../../ports/browser-engine-port";
import { errorMessage } from "../../../effect/host-errors";
import { targetSessionEventSchema } from "../../../ports/browser-cdp-schemas";
import { attachCdpTargetSession, cdpCommand } from "../cdp/cdp-target-session";
import {
  type ChromePageTarget,
  type ChromePageTargetContext,
  endChromePermissionRequests,
  handleChromePageTargetEvent,
  revokeChromeSitePermissions,
  setUpChromePageTarget,
} from "./chrome-page-target";
import type { ChromeProcess } from "./chrome-process";

const TARGET_READY_TIMEOUT_MS = 10_000;
const NEW_WINDOW_SIZE = { width: 1280, height: 800 };

const attachedToTargetSchema = z.object({
  sessionId: z.string(),
  targetInfo: z.object({
    targetId: z.string(),
    type: z.string(),
    url: z.string(),
    openerId: z.string().optional(),
    canAccessOpener: z.boolean().optional(),
  }),
  waitingForDebugger: z.boolean(),
});
const createTargetResultSchema = z.object({ targetId: z.string() });

type ChromeWorkspaceBrowserInput = {
  readonly workspaceId: string;
  readonly chrome: ChromeProcess;
  readonly emit: (event: BrowserEngineEvent) => void;
  /** Called once when Chrome ends without `stop`, after the `tab_ended` events. */
  readonly onUnexpectedExit: () => void;
};

/** The Chrome process of one workspace and the tabs in it. */
export type ChromeWorkspaceBrowser = {
  readonly workspaceId: string;
  createTab(tabId: string, url: string): Effect.Effect<void, BrowserEngineError>;
  closeTab(tabId: string): Effect.Effect<void, BrowserEngineError>;
  openSession(tabId: string): Effect.Effect<CdpSession, BrowserEngineError, Scope.Scope>;
  holdWake(tabId: string): Effect.Effect<void, never, Scope.Scope>;
  reloadPage(tabId: string, ignoreCache: boolean): Effect.Effect<void, BrowserEngineError>;
  captureScreenshot(
    tabId: string,
    params: CdpPayload,
  ): Effect.Effect<CdpPayload, BrowserEngineError>;
  /** Sets the permissions of a site back to `prompt` in this process. */
  revokeSitePermissions(
    origin: string,
    permission: BrowserPermissionKind | null,
  ): Effect.Effect<void, BrowserEngineError>;
  /** True for a live tab, and for an ended tab that the host did not close yet. */
  knowsTab(tabId: string): boolean;
  liveTabCount(): number;
  stop(): Effect.Effect<void>;
};

/** Starts tab handling on a running Chrome process. */
export const startChromeWorkspaceBrowser = (
  input: ChromeWorkspaceBrowserInput,
): Effect.Effect<ChromeWorkspaceBrowser, BrowserEngineError> =>
  Effect.gen(function* () {
    const { chrome, emit } = input;
    const connection = chrome.connection;
    const scope = yield* Scope.make();
    const runFork = yield* FiberSet.makeRuntime<never, void, never>().pipe(Scope.provide(scope));
    const runBackground = (effect: Effect.Effect<void>): void => {
      runFork(effect);
    };
    const targets = new Map<string, ChromePageTarget>();
    const sessions = new Map<string, ChromePageTarget>();
    const tabs = new Map<string, ChromePageTarget>();
    const ready = new Map<string, Deferred.Deferred<ChromePageTarget, CdpCommandError>>();
    const pageContext: ChromePageTargetContext = {
      connection,
      emit,
      notificationOrigins: new Set(),
      permissionOverrides: new Map(),
      runBackground,
    };
    /** Tabs whose page closed by itself, until the host closes them. */
    const endedTabs = new Set<string>();
    let stopping = false;

    const readyFor = (targetId: string) => {
      let deferred = ready.get(targetId);
      if (!deferred) {
        deferred = Deferred.makeUnsafe<ChromePageTarget, CdpCommandError>();
        ready.set(targetId, deferred);
      }
      return deferred;
    };

    const forget = (target: ChromePageTarget): void => {
      endChromePermissionRequests(target, null);
      targets.delete(target.targetId);
      sessions.delete(target.sessionId);
      ready.delete(target.targetId);
      if (target.tabId !== null && tabs.get(target.tabId) === target) {
        tabs.delete(target.tabId);
        if (!stopping) {
          endedTabs.add(target.tabId);
          emit({ type: "tab_ended", tabId: target.tabId });
        }
      }
    };

    const attach = (params: z.infer<typeof attachedToTargetSchema>) =>
      Effect.gen(function* () {
        const { targetInfo } = params;
        const target: ChromePageTarget = {
          targetId: targetInfo.targetId,
          sessionId: params.sessionId,
          tabId: null,
          historyRestart: "none",
          mainDocumentUrl: null,
          frames: new Set(),
          contexts: new Map(),
          permissionRequests: new Map(),
        };
        targets.set(target.targetId, target);
        sessions.set(target.sessionId, target);
        const deferred = readyFor(target.targetId);
        const setUp = yield* Effect.exit(setUpChromePageTarget(connection, target.sessionId));
        if (Exit.isFailure(setUp)) {
          forget(target);
          yield* Deferred.failCause(deferred, setUp.cause);
          return;
        }
        if (targetInfo.openerId !== undefined) {
          const openerTabId = targets.get(targetInfo.openerId)?.tabId ?? null;
          if (openerTabId === null) {
            // A popup belongs to the owner of its opener tab. The opener closed, so nobody owns it.
            forget(target);
            yield* cdpCommand(connection, "", "Target.closeTarget", {
              targetId: target.targetId,
            }).pipe(Effect.ignore);
            return;
          }
          const tabId = randomUUID();
          target.tabId = tabId;
          tabs.set(tabId, target);
          emit({
            type: "popup_opened",
            openerTabId,
            tabId,
            url: targetInfo.url.length > 0 ? targetInfo.url : BROWSER_BLANK_URL,
            surface: "panel",
            keepsOpener: targetInfo.canAccessOpener === true,
          });
          emit({ type: "tab_attached", tabId });
        }
        const resumed = yield* Effect.exit(
          cdpCommand(connection, target.sessionId, "Runtime.runIfWaitingForDebugger"),
        );
        if (Exit.isFailure(resumed)) {
          forget(target);
          yield* Deferred.failCause(deferred, resumed.cause);
          return;
        }
        yield* Deferred.succeed(deferred, target);
      });

    const onRootEvent = (event: CdpEvent): void => {
      switch (event.method) {
        case "Target.attachedToTarget": {
          const params = attachedToTargetSchema.parse(event.params);
          // Sessions that `openSession` attaches report here too. Only auto-attached pages wait.
          if (params.waitingForDebugger && params.targetInfo.type === "page") {
            runBackground(attach(params));
          }
          return;
        }
        case "Target.detachedFromTarget": {
          const target = sessions.get(targetSessionEventSchema.parse(event.params).sessionId);
          if (target) forget(target);
          return;
        }
      }
    };

    const unsubscribe = connection.subscribe((event) => {
      if (event.sessionId === "") {
        onRootEvent(event);
        return;
      }
      const target = sessions.get(event.sessionId);
      if (target) handleChromePageTargetEvent(pageContext, target, event);
    });

    /**
     * Ends tab handling. A stop detaches each tab, so its saved state comes back after a restart. A
     * Chrome exit ends each tab, because its page is gone and nothing can attach it again.
     */
    const releaseTabs = (type: "tab_detached" | "tab_ended"): void => {
      stopping = true;
      unsubscribe();
      for (const tabId of tabs.keys()) emit({ type, tabId });
      tabs.clear();
    };

    const removeExitListener = chrome.onExit(() => {
      if (stopping) return;
      releaseTabs("tab_ended");
      // Closing the scope only interrupts the background work of this browser. Nothing waits for it.
      Effect.runFork(Scope.close(scope, Exit.void));
      input.onUnexpectedExit();
    });

    const stop = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (stopping) return;
        removeExitListener();
        releaseTabs("tab_detached");
        yield* Scope.close(scope, Exit.void);
        yield* chrome.stop();
      });

    const rootSetUp = Effect.gen(function* () {
      yield* cdpCommand(connection, "", "Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
        filter: [{ type: "page" }],
      });
      // Agent tabs of the web runner have no user who could take a downloaded file.
      yield* cdpCommand(connection, "", "Browser.setDownloadBehavior", { behavior: "deny" });
    });
    yield* rootSetUp.pipe(
      Effect.tapError(() => stop()),
      Effect.mapError(
        (cause) =>
          new BrowserEngineError({
            code: "operation_failed",
            operation: "browser.start",
            message: `Chrome for Testing started but did not accept its setup: ${cause.message}`,
            cause,
          }),
      ),
    );

    const requireTab = (tabId: string, operation: string) =>
      Effect.suspend(() => {
        const target = tabs.get(tabId);
        return target
          ? Effect.succeed(target)
          : Effect.fail(
              new BrowserEngineError({
                code: "tab_not_found",
                operation,
                message: `Browser tab ${tabId} has no page.`,
                tabId,
              }),
            );
      });

    const createTab = (tabId: string, url: string) =>
      Effect.gen(function* () {
        const created = yield* cdpCommand(connection, "", "Target.createTarget", {
          url: BROWSER_BLANK_URL,
          newWindow: true,
          // A desktop size for a page that no client views yet, such as a new agent tab. A viewer
          // sets the page size of its surface while it streams the page.
          width: NEW_WINDOW_SIZE.width,
          height: NEW_WINDOW_SIZE.height,
        }).pipe(Effect.mapError(commandError("open a page", tabId)));
        const { targetId } = createTargetResultSchema.parse(created);
        const prepared = yield* Deferred.await(readyFor(targetId)).pipe(
          Effect.mapError(commandError("prepare the page", tabId)),
          Effect.timeoutOrElse({
            duration: TARGET_READY_TIMEOUT_MS,
            orElse: () =>
              Effect.fail(
                new BrowserEngineError({
                  code: "operation_failed",
                  operation: "browser.createTab",
                  message: `Chrome did not prepare the page of browser tab ${tabId} within ${TARGET_READY_TIMEOUT_MS / 1000} seconds.`,
                  tabId,
                }),
              ),
          }),
          Effect.tapError(() =>
            // A page that never became a tab has no owner.
            cdpCommand(connection, "", "Target.closeTarget", { targetId }).pipe(Effect.ignore),
          ),
        );
        // The page can end between its setup and this step.
        const target = targets.get(targetId);
        if (target !== prepared) {
          return yield* new BrowserEngineError({
            code: "operation_failed",
            operation: "browser.createTab",
            message: `The page of browser tab ${tabId} closed while it opened.`,
            tabId,
          });
        }
        target.tabId = tabId;
        tabs.set(tabId, target);
        emit({ type: "tab_attached", tabId });
        if (!isBrowserBlankUrl(url)) {
          target.historyRestart = "after_commit";
          // The host reads the load result from its own session. A slow server or a certificate
          // prompt must not hold `createTab`.
          runBackground(
            cdpCommand(connection, target.sessionId, "Page.navigate", { url }).pipe(Effect.ignore),
          );
        }
      });

    const closeTab = (tabId: string) =>
      Effect.gen(function* () {
        const target = tabs.get(tabId);
        const ended = endedTabs.delete(tabId);
        if (!target && !ended) {
          return yield* new BrowserEngineError({
            code: "tab_not_found",
            operation: "browser.closeTab",
            message: `Browser tab ${tabId} does not exist.`,
            tabId,
          });
        }
        if (target) {
          // The page leaves `tabs` before it ends, so its end is not a `tab_ended`.
          tabs.delete(tabId);
          yield* cdpCommand(connection, "", "Target.closeTarget", {
            targetId: target.targetId,
          }).pipe(
            // The page can end on its own while the close runs.
            Effect.catch((cause) =>
              targets.has(target.targetId)
                ? Effect.fail(commandError("close the page", tabId)(cause))
                : Effect.void,
            ),
          );
        }
      });

    const openSession = (tabId: string) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const target = yield* requireTab(tabId, "browser.openSession");
          return yield* Effect.tryPromise({
            try: () =>
              attachCdpTargetSession(connection, {
                targetId: target.targetId,
                parentSessionId: "",
              }),
            catch: (cause) =>
              new BrowserEngineError({
                code: "operation_failed",
                operation: "browser.openSession",
                message: `Could not attach to browser tab ${tabId}: ${errorMessage(cause)}`,
                tabId,
                cause,
              }),
          });
        }),
        (session) => Effect.promise(() => session.close()),
      );

    /**
     * A popup that Chrome opens as a tab shares the window of its opener, and only the front tab
     * of a window draws. Each other tab has its own window, so bringing the tab to the front of
     * its window changes no other tab.
     */
    const holdWake = (tabId: string) =>
      Effect.suspend(() => {
        const target = tabs.get(tabId);
        if (!target) return Effect.void;
        return cdpCommand(connection, target.sessionId, "Page.bringToFront").pipe(
          // A tab without a page has nothing to keep awake. The action on it fails by itself.
          Effect.ignore,
        );
      });

    const reloadPage = (tabId: string, ignoreCache: boolean) =>
      requireTab(tabId, "browser.reloadPage").pipe(
        Effect.flatMap((target) =>
          cdpCommand(connection, target.sessionId, "Page.reload", { ignoreCache }).pipe(
            Effect.mapError(commandError("reload the page", tabId)),
          ),
        ),
        Effect.asVoid,
      );

    // Chrome for Testing draws no page on screen, so a CDP clip moves nothing that a user sees.
    const captureScreenshot = (tabId: string, params: CdpPayload) =>
      requireTab(tabId, "browser.captureScreenshot").pipe(
        Effect.flatMap((target) =>
          cdpCommand(connection, target.sessionId, "Page.captureScreenshot", params).pipe(
            Effect.mapError(commandError("capture the page", tabId)),
          ),
        ),
      );

    const browser: ChromeWorkspaceBrowser = {
      workspaceId: input.workspaceId,
      createTab,
      closeTab,
      openSession,
      holdWake,
      reloadPage,
      captureScreenshot,
      revokeSitePermissions: (origin, permission) =>
        revokeChromeSitePermissions(pageContext, origin, permission).pipe(
          Effect.mapError(
            (cause) =>
              new BrowserEngineError({
                code: "operation_failed",
                operation: "browser.revokeSitePermissions",
                message: `Chrome could not reset the permissions of ${origin}: ${cause.message}`,
                cause,
              }),
          ),
        ),
      knowsTab: (tabId) => tabs.has(tabId) || endedTabs.has(tabId),
      liveTabCount: () => tabs.size,
      stop,
    };
    return browser;
  });

const commandError = (action: string, tabId: string) => (cause: CdpCommandError) =>
  new BrowserEngineError({
    code: "operation_failed",
    operation: "browser.tab",
    message: `Chrome could not ${action}: ${cause.message}`,
    tabId,
    cause,
  });
