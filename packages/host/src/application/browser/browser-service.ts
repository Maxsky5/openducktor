import type { BrowserFailureCode, BrowserHostEvent } from "@openducktor/contracts";
import { Effect, Exit, FiberSet, Scope } from "effect";
import type { BrowserAutomationPort } from "../../ports/browser-automation-port";
import type { BrowserEngineError, BrowserEnginePort } from "../../ports/browser-engine-port";
import type { BrowserScreenshotStorePort } from "../../ports/browser-screenshot-store-port";
import type { BrowserSitePermissionPort } from "../../ports/browser-site-permission-port";
import type { BrowserTabStorePort } from "../../ports/browser-tab-store-port";
import { createBrowserAgentPages } from "./browser-agent-pages";
import { createBrowserAgentTools } from "./browser-agent-tools";
import { cdpClientMessageSchema, openCdpProxyClient } from "./browser-cdp-proxy";
import { createBrowserClientHub } from "./browser-client-hub";
import { createBrowserEngineEvents } from "./browser-engine-events";
import { guardBrowserEngineListeners } from "./browser-engine-listener-guard";
import {
  type BrowserOwnerAccessDependencies,
  createBrowserOwnerAccess,
} from "./browser-owner-access";
import { createBrowserPicker } from "./browser-picker";
import { createBrowserPromptBook } from "./browser-prompt-book";
import { createBrowserSavedTabs } from "./browser-saved-tabs";
import { BrowserServiceError } from "./browser-service-error";
import type { BrowserService } from "./browser-service-types";
import { createBrowserSitePermissions } from "./browser-site-permissions";
import { createBrowserTabRegistry } from "./browser-tab-registry";
import { createBrowserTabService } from "./browser-tab-service";

export type CreateBrowserServiceInput = {
  engine: BrowserEnginePort;
  automation: BrowserAutomationPort;
  sitePermissions: BrowserSitePermissionPort;
  savedTabs: BrowserTabStorePort;
  screenshots: BrowserScreenshotStorePort;
  owners: BrowserOwnerAccessDependencies;
  /** Stages a cropped annotation image as a local attachment and returns its path. */
  stageImage(base64Png: string, name: string): Effect.Effect<{ path: string }, BrowserServiceError>;
  publish(event: BrowserHostEvent): void;
  reportFailure(operation: string, cause: unknown): void;
  newId?: () => string;
};

/** Builds the host browser feature on one engine. */
export const createBrowserService = (input: CreateBrowserServiceInput): BrowserService => {
  const engine = guardBrowserEngineListeners(input.engine, input.reportFailure);
  const newId = input.newId ?? (() => globalThis.crypto.randomUUID());

  // Owns the background work of the feature. Dispose closes the scope, which interrupts it.
  const jobsScope = Scope.makeUnsafe();
  const jobs = Effect.runSync(Scope.provide(FiberSet.make<void>(), jobsScope));
  const runJob = (job: Effect.Effect<void>): void => {
    Effect.runFork(
      FiberSet.run(
        jobs,
        job.pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => input.reportFailure("browser.background_job", cause)),
          ),
        ),
      ),
    );
  };

  const registry = createBrowserTabRegistry(input.publish);
  const savedTabs = createBrowserSavedTabs({
    store: input.savedTabs,
    registry,
    runJob,
    onSaveFailed: (message) => registry.publish({ type: "tabs_not_saved", message }),
  });
  const prompts = createBrowserPromptBook(registry, newId);
  const sitePermissions = createBrowserSitePermissions(input.sitePermissions, engine);
  const tabs = createBrowserTabService({
    engine,
    ownerAccess: createBrowserOwnerAccess(input.owners),
    registry,
    prompts,
    runJob,
    // The hub needs the tab service. A page reports anchor boxes only after this setup ends.
    onAnchorBoxes: (tabId, boxes) => hub.sendAnchorBoxes(tabId, boxes),
  });
  const engineEvents = createBrowserEngineEvents({
    engine,
    registry,
    prompts,
    tabs,
    sitePermissions,
    runJob,
    reportFailure: input.reportFailure,
  });
  const picker = createBrowserPicker({
    engine,
    registry,
    requireLive: tabs.requireLive,
    stageImage: input.stageImage,
  });
  const hub = createBrowserClientHub({ tabs, picker });
  const pages = createBrowserAgentPages({
    engine,
    automation: input.automation,
    registry,
    runJob,
    onPressing: (tabId, pressing) => hub.broadcast({ type: "agent_press", tabId, pressing }),
  });
  // The picker and the agent pages of a tab end with its page. The agent pages also end when the
  // user stops sharing the tab.
  registry.onTabChange((previous, next) => {
    if (previous === null) return;
    if (previous.live && !next?.live) {
      picker.forget(previous.tabId);
      runJob(pages.release(previous.tabId));
    } else if (previous.shared && next !== null && !next.shared) {
      runJob(pages.release(previous.tabId));
    }
  });
  const agentTools = createBrowserAgentTools({
    engine,
    registry,
    prompts,
    tabs,
    pages,
    screenshots: input.screenshots,
    newTabId: newId,
    mark: (tabId, action, point) =>
      hub.broadcast({ type: "agent_marker", tabId, action, x: point.x, y: point.y }),
  });

  const unsubscribeEngine = engine.subscribe(engineEvents.handle);

  // The saved tabs load once, before the first use of the tab list. A read failure stays, so no
  // write replaces the file that the user must fix.
  const savedTabsLoaded = Effect.runSync(
    Effect.cached(savedTabs.read.pipe(Effect.map(tabs.addSaved))),
  );
  const afterLoad = <A>(effect: Effect.Effect<A, BrowserServiceError>) =>
    savedTabsLoaded.pipe(Effect.andThen(effect));

  /**
   * Closes the first listed tab until no tab is listed. Closing an opener also closes its popup
   * windows, and a tab whose page ends during the loop leaves the list by itself.
   */
  const closeEach = (listed: () => readonly { tabId: string }[]) =>
    Effect.gen(function* () {
      for (let next = listed()[0]; next !== undefined; next = listed()[0]) {
        yield* tabs.closeTab(next.tabId);
      }
    });

  const withTab = <A>(
    tabId: string,
    operation: string,
    effect: Effect.Effect<A, BrowserServiceError>,
  ) => registry.require(tabId, operation).pipe(Effect.andThen(effect));

  const engineTabCall = <A>(
    tabId: string,
    operation: string,
    call: Effect.Effect<A, BrowserEngineError>,
  ) => withTab(tabId, operation, call.pipe(Effect.mapError(engineFailure(operation, tabId))));

  return {
    engineKind: engine.kind,
    state: () => engine.state(),
    listTabs: () => afterLoad(Effect.sync(() => registry.list())),
    openTab: (request) =>
      afterLoad(
        tabs.openTab({
          tabId: request.tabId,
          owner: request.owner,
          address: request.address,
          createdBy: "user",
        }),
      ),
    startTab: (tabId) => afterLoad(tabs.startTab(tabId, "browser.tab.start")),
    reportFrameState: (request) => tabs.reportFrameState(request),
    closeTab: (tabId) => tabs.closeTab(tabId),
    navigate: (request) => tabs.navigate(request.tabId, request.navigation),
    setShared: (request) => tabs.setShared(request.tabId, request.shared),
    answerPrompt: (request) => prompts.answer(request.tabId, request.promptId, request.answer),
    readSitePermissions: (request) => sitePermissions.read(request.workspaceId, request.origin),
    resetSitePermissions: (request) =>
      sitePermissions.reset(request.workspaceId, request.origin, request.permission),
    setPicker: (request) =>
      withTab(
        request.tabId,
        "browser.picker.set",
        picker.setEnabled(request.tabId, request.enabled),
      ),
    captureAnnotation: (request) =>
      withTab(
        request.tabId,
        "browser.annotation.capture",
        picker.capture(request.tabId, request.nodeRefs),
      ),
    revealDownload: (tabId, downloadId) =>
      withFeature(
        engine.windows,
        "browser.download.reveal",
        "Show in folder is available only in the desktop app.",
        (windows) =>
          engineTabCall(
            tabId,
            "browser.download.reveal",
            windows.revealDownload(tabId, downloadId),
          ),
      ),
    showPopupWindow: (tabId) =>
      withFeature(
        engine.windows,
        "browser.popup_window.show",
        "Popup windows exist only in the desktop app.",
        (windows) =>
          engineTabCall(tabId, "browser.popup_window.show", windows.showPopupWindow(tabId)),
      ),
    openDevTools: (tabId) =>
      withFeature(
        engine.devTools,
        "browser.devtools.open",
        "DevTools are available only in the desktop app.",
        (devTools) =>
          engineTabCall(
            tabId,
            "browser.devtools.open",
            devTools.frontendUrl(tabId).pipe(Effect.map((frontendUrl) => ({ frontendUrl }))),
          ),
      ),
    connectClient: (session) => hub.connect(session),
    connectDevTools: (tabId, peer) =>
      withFeature(
        engine.devTools,
        "browser.devtools.connect",
        "DevTools are available only in the desktop app.",
        () =>
          Effect.gen(function* () {
            yield* registry.require(tabId, "browser.devtools.connect");
            const scope = yield* Scope.make();
            yield* engine.holdWake(tabId).pipe(Scope.provide(scope));
            const proxy = yield* openCdpProxyClient({
              kind: "devtools",
              tabId,
              engine,
              send: (message) => peer.send(JSON.stringify(message)),
              onEnded: () => {
                runJob(Scope.close(scope, Exit.void));
                peer.close();
              },
            }).pipe(Effect.tapError(() => Scope.close(scope, Exit.void)));
            return {
              handle: (message: string) =>
                Effect.try({
                  try: () => proxy.receive(cdpClientMessageSchema.parse(JSON.parse(message))),
                  catch: (cause) =>
                    new BrowserServiceError({
                      code: "protocol_error",
                      operation: "browser.devtools.message",
                      message: "DevTools sent a message that is not a CDP command.",
                      tabId,
                      cause,
                    }),
                }),
              close: () => proxy.close().pipe(Effect.andThen(Scope.close(scope, Exit.void))),
            };
          }),
      ),
    runAgentTool: (owner, name, toolInput) =>
      afterLoad(Effect.suspend(() => agentTools.run(owner, name, toolInput))),
    closeOwnerTabs: (owner) => afterLoad(closeEach(() => registry.ownerTabs(owner))),
    removeWorkspace: (workspaceId) =>
      Effect.gen(function* () {
        yield* savedTabsLoaded;
        yield* closeEach(() => registry.workspaceTabs(workspaceId));
        yield* engine
          .deleteWorkspaceProfile(workspaceId)
          .pipe(Effect.mapError(engineFailure("browser.workspace.remove")));
        yield* sitePermissions.removeWorkspace(workspaceId);
        yield* input.screenshots.removeWorkspace(workspaceId).pipe(
          Effect.mapError(
            (cause) =>
              new BrowserServiceError({
                code: "browser_action_failed",
                operation: "browser.workspace.remove",
                message: `Could not delete the agent screenshots of the workspace: ${cause.message}`,
                cause,
              }),
          ),
        );
        engineEvents.clearWorkspace(workspaceId);
      }),
    dispose: () =>
      Effect.gen(function* () {
        unsubscribeEngine();
        yield* pages.dispose();
        yield* tabs.dispose();
        yield* savedTabs.flush;
        yield* Scope.close(jobsScope, Exit.void);
        yield* engine.dispose();
      }),
  };
};

/** Runs `use` with an optional engine feature. An engine without the feature fails as unsupported. */
const withFeature = <Feature, A>(
  feature: Feature | null,
  operation: string,
  message: string,
  use: (feature: Feature) => Effect.Effect<A, BrowserServiceError>,
): Effect.Effect<A, BrowserServiceError> =>
  feature === null
    ? Effect.fail(new BrowserServiceError({ code: "browser_unsupported", operation, message }))
    : use(feature);

/** A missing tab or download stays a not-found failure, so a client can tell it from a fault. */
const engineFailureCode = (cause: BrowserEngineError): BrowserFailureCode => {
  switch (cause.code) {
    case "tab_not_found":
      return "browser_tab_not_found";
    case "download_not_found":
      return "browser_download_not_found";
    default:
      return "browser_engine_error";
  }
};

const engineFailure = (operation: string, tabId?: string) => (cause: BrowserEngineError) =>
  new BrowserServiceError({
    code: engineFailureCode(cause),
    operation,
    message: cause.message,
    tabId,
    cause,
  });
