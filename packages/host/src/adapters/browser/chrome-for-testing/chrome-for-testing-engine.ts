import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  browserEngineNotReadyMessage,
  type BrowserEngineState,
  isBrowserTabLoadableUrl,
  workspaceIdSchema,
} from "@openducktor/contracts";
import { Cause, Effect, Exit, Fiber } from "effect";
import { causeMessage, errorMessage } from "../../../effect/host-errors";
import { createSerialGate } from "../../../effect/serial-gate";
import {
  BrowserEngineError,
  type BrowserEngineEvent,
  type BrowserEnginePort,
  type BrowserInstaller,
} from "../../../ports/browser-engine-port";
import { createSystemCommandRunner } from "../../system/system-command-runner";
import { createSystemArchiveExtractor } from "./chrome-archive-extract";
import {
  type ChromeForTestingInstallation,
  createChromeForTestingInstallation,
} from "./chrome-for-testing-installer";
import {
  CHROME_FOR_TESTING_SUPPORTED_PLATFORMS,
  CHROME_FOR_TESTING_VERSION,
  selectChromeForTestingArchive,
} from "./chrome-for-testing-pin";
import { type ChromeLauncher, launchChromeProcess } from "./chrome-process";
import {
  type ChromeWorkspaceBrowser,
  startChromeWorkspaceBrowser,
} from "./chrome-workspace-browser";

export type ChromeForTestingBrowserEngineOptions = {
  /** The OpenDucktor config root. The browser and the workspace profiles live in `browser/`. */
  readonly configRoot: string;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
};

/** The parts of the engine that touch the network, the archive tool, and Chrome. */
export type ChromeForTestingEngineDependencies = {
  readonly configRoot: string;
  readonly platform: NodeJS.Platform;
  /** The host platform name in the `unsupported_platform` state, for example `linux-arm64`. */
  readonly hostPlatformName: string;
  /** Null when the pinned version has no archive for this host. */
  readonly installation: ChromeForTestingInstallation | null;
  readonly launch: ChromeLauncher;
};

/**
 * An install can end before `runFork` returns its fiber, so this object, not the fiber, marks the
 * current install.
 */
type InstallRun = { fiber: Fiber.Fiber<void> | null };

const notInstalledState = (installation: ChromeForTestingInstallation): BrowserEngineState => ({
  kind: "not_installed",
  version: CHROME_FOR_TESTING_VERSION,
  downloadBytes: installation.archive.sizeBytes,
});

const READY_STATE: BrowserEngineState = {
  kind: "ready",
  engine: "chrome_for_testing",
};

/**
 * The web runner browser engine: a pinned Chrome for Testing that the host downloads when the user
 * asks, with one headless Chrome process for each workspace that has tabs.
 */
export const createChromeForTestingBrowserEngine = (
  options: ChromeForTestingBrowserEngineOptions,
): Effect.Effect<BrowserEnginePort, BrowserEngineError> => {
  const archive = selectChromeForTestingArchive(options.platform, options.arch);
  return makeChromeForTestingBrowserEngine({
    configRoot: options.configRoot,
    platform: options.platform,
    hostPlatformName: `${options.platform}-${options.arch}`,
    installation:
      archive === null
        ? null
        : createChromeForTestingInstallation({
            configRoot: options.configRoot,
            archive,
            fetch: (url, init) => fetch(url, init),
            extract: createSystemArchiveExtractor({
              systemCommands: createSystemCommandRunner({ platform: options.platform }),
              platform: options.platform,
              systemRoot: process.env.SystemRoot,
            }),
          }),
    launch: launchChromeProcess,
  });
};

/** Builds the engine from its dependencies. `createChromeForTestingBrowserEngine` supplies them. */
export const makeChromeForTestingBrowserEngine = (
  deps: ChromeForTestingEngineDependencies,
): Effect.Effect<BrowserEnginePort, BrowserEngineError> =>
  Effect.gen(function* () {
    const { installation } = deps;
    const listeners = new Set<(event: BrowserEngineEvent) => void>();
    const emit = (event: BrowserEngineEvent): void => {
      for (const listener of Array.from(listeners)) listener(event);
    };
    const toEngineError = (operation: string) => (cause: { readonly message: string }) =>
      new BrowserEngineError({
        code: "operation_failed",
        operation,
        message: cause.message,
        cause,
      });

    let state: BrowserEngineState =
      installation === null
        ? {
            kind: "unsupported_platform",
            platform: deps.hostPlatformName,
            supported: [...CHROME_FOR_TESTING_SUPPORTED_PLATFORMS],
          }
        : (yield* installation.isInstalled.pipe(Effect.mapError(toEngineError("browser.start"))))
          ? READY_STATE
          : notInstalledState(installation);
    const setState = (next: BrowserEngineState): void => {
      state = next;
      emit({ type: "state_changed", state: next });
    };

    const workspaces = new Map<string, ChromeWorkspaceBrowser>();
    const gate = createSerialGate();
    let installRun: InstallRun | null = null;
    let disposed = false;

    const profileDirectory = (workspaceId: string): string =>
      path.join(deps.configRoot, "browser", "workspaces", workspaceId, "profile");

    const requireWorkspaceId = (workspaceId: string, operation: string) =>
      workspaceIdSchema.safeParse(workspaceId).success
        ? Effect.succeed(workspaceId)
        : Effect.fail(
            new BrowserEngineError({
              code: "operation_failed",
              operation,
              message: `Workspace ID ${workspaceId} is not valid.`,
            }),
          );

    const findBrowserOfTab = (tabId: string): ChromeWorkspaceBrowser | undefined =>
      Array.from(workspaces.values()).find((browser) => browser.knowsTab(tabId));

    const browserOfTab = (tabId: string, operation: string) =>
      Effect.suspend(() => {
        const browser = findBrowserOfTab(tabId);
        if (browser) return Effect.succeed(browser);
        return Effect.fail(
          new BrowserEngineError({
            code: "tab_not_found",
            operation,
            message: `Browser tab ${tabId} does not exist.`,
            tabId,
          }),
        );
      });

    const fileStep = <A>(operation: string, message: string, run: () => Promise<A>) =>
      Effect.tryPromise({
        try: run,
        catch: (cause) =>
          new BrowserEngineError({
            code: "operation_failed",
            operation,
            message: `${message}: ${errorMessage(cause)}`,
            cause,
          }),
      }).pipe(Effect.asVoid);

    /**
     * Returns the browser of a workspace, and starts its Chrome process when none runs. Runs inside
     * the lane of the workspace.
     */
    const workspaceBrowser = (workspaceId: string, installed: ChromeForTestingInstallation) =>
      Effect.gen(function* () {
        const existing = workspaces.get(workspaceId);
        if (existing) return existing;
        const profile = profileDirectory(workspaceId);
        yield* fileStep("browser.start", `Could not create ${profile}`, () =>
          mkdir(profile, { recursive: true }),
        );
        const chrome = yield* deps
          .launch({
            executable: installed.executable,
            profileDirectory: profile,
            platform: deps.platform,
          })
          .pipe(
            Effect.tapError((failure) =>
              Effect.sync(() =>
                setState({
                  kind: "failed",
                  reason: failure.message,
                  missingLibraries: [...failure.missingLibraries],
                  canRetryDownload: false,
                }),
              ),
            ),
            Effect.mapError(
              (failure) =>
                new BrowserEngineError({
                  code: "not_ready",
                  operation: "browser.start",
                  message: failure.message,
                  cause: failure,
                }),
            ),
          );
        const browser: ChromeWorkspaceBrowser = yield* startChromeWorkspaceBrowser({
          workspaceId,
          chrome,
          emit,
          onUnexpectedExit: () => {
            if (workspaces.get(workspaceId) === browser) workspaces.delete(workspaceId);
          },
        });
        workspaces.set(workspaceId, browser);
        return browser;
      });

    const startInstall = (installed: ChromeForTestingInstallation): void => {
      const run: InstallRun = { fiber: null };
      installRun = run;
      run.fiber = Effect.runFork(
        installed.install(setState).pipe(
          // `onExit` also runs when `cancel` interrupts the install.
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (installRun === run) installRun = null;
              if (Exit.isSuccess(exit)) {
                setState(READY_STATE);
              } else if (Cause.hasInterruptsOnly(exit.cause)) {
                setState(notInstalledState(installed));
              } else {
                setState({
                  kind: "failed",
                  reason: causeMessage(exit.cause),
                  missingLibraries: [],
                  canRetryDownload: true,
                });
              }
            }),
          ),
          // The new state reports the failure.
          Effect.ignore,
        ),
      );
    };

    const installer: BrowserInstaller = {
      start: () =>
        Effect.gen(function* () {
          if (installation === null) {
            return yield* new BrowserEngineError({
              code: "unsupported",
              operation: "browser.install",
              message: "Chrome for Testing has no build for this platform.",
            });
          }
          if (installRun !== null || state.kind === "ready" || disposed) return;
          if (state.kind === "failed" && !state.canRetryDownload) {
            // Chrome did not start. Retry checks the install, and the next tab starts Chrome again.
            const installed = yield* installation.isInstalled.pipe(
              Effect.mapError(toEngineError("browser.install")),
            );
            if (installed) {
              setState(READY_STATE);
              return;
            }
          }
          startInstall(installation);
        }),
      cancel: () =>
        Effect.suspend(() => {
          const fiber = installRun?.fiber;
          return fiber ? Fiber.interrupt(fiber).pipe(Effect.asVoid) : Effect.void;
        }),
    };

    const createTab: BrowserEnginePort["createTab"] = (spec) =>
      Effect.gen(function* () {
        // Without an installation the state is `unsupported_platform`, which is not ready.
        const notReady = disposed
          ? "The browser engine stopped."
          : browserEngineNotReadyMessage(state);
        if (notReady !== null || installation === null) {
          return yield* new BrowserEngineError({
            code: state.kind === "unsupported_platform" ? "unsupported" : "not_ready",
            operation: "browser.createTab",
            message: notReady ?? "Chrome for Testing has no build for this platform.",
            tabId: spec.tabId,
          });
        }
        if (!isBrowserTabLoadableUrl(spec.url)) {
          return yield* new BrowserEngineError({
            code: "operation_failed",
            operation: "browser.createTab",
            message: `Browser tabs load only http and https pages, not ${spec.url}.`,
            tabId: spec.tabId,
          });
        }
        const workspaceId = yield* requireWorkspaceId(spec.workspaceId, "browser.createTab");
        yield* gate.run(
          workspaceId,
          Effect.gen(function* () {
            if (findBrowserOfTab(spec.tabId)) {
              return yield* new BrowserEngineError({
                code: "operation_failed",
                operation: "browser.createTab",
                message: `Browser tab ${spec.tabId} already exists.`,
                tabId: spec.tabId,
              });
            }
            const browser = yield* workspaceBrowser(workspaceId, installation);
            yield* browser.createTab(spec.tabId, spec.url);
          }),
        );
      });

    const closeTab: BrowserEnginePort["closeTab"] = (tabId) =>
      Effect.gen(function* () {
        const browser = yield* browserOfTab(tabId, "browser.closeTab");
        yield* gate.run(
          browser.workspaceId,
          Effect.gen(function* () {
            yield* browser.closeTab(tabId);
            // One process runs for each workspace that has tabs.
            if (browser.liveTabCount() === 0 && workspaces.get(browser.workspaceId) === browser) {
              workspaces.delete(browser.workspaceId);
              yield* browser.stop();
            }
          }),
        );
      });

    const deleteWorkspaceProfile: BrowserEnginePort["deleteWorkspaceProfile"] = (workspaceId) =>
      Effect.gen(function* () {
        const id = yield* requireWorkspaceId(workspaceId, "browser.deleteWorkspaceProfile");
        yield* gate.run(
          id,
          Effect.gen(function* () {
            const browser = workspaces.get(id);
            if (browser) {
              workspaces.delete(id);
              yield* browser.stop();
            }
            const profile = profileDirectory(id);
            yield* fileStep("browser.deleteWorkspaceProfile", `Could not delete ${profile}`, () =>
              rm(profile, { recursive: true, force: true }),
            );
          }),
        );
      });

    const engine: BrowserEnginePort = {
      kind: "chrome_for_testing",
      installer,
      windows: null,
      devTools: null,
      showsPagesToUser: false,
      state: () => state,
      createTab,
      closeTab,
      openSession: (tabId) =>
        browserOfTab(tabId, "browser.openSession").pipe(
          Effect.flatMap((browser) => browser.openSession(tabId)),
        ),
      holdWake: (tabId) =>
        Effect.suspend(() => findBrowserOfTab(tabId)?.holdWake(tabId) ?? Effect.void),
      reloadPage: (tabId, ignoreCache) =>
        browserOfTab(tabId, "browser.reloadPage").pipe(
          Effect.flatMap((browser) => browser.reloadPage(tabId, ignoreCache)),
        ),
      captureScreenshot: (tabId, params) =>
        browserOfTab(tabId, "browser.captureScreenshot").pipe(
          Effect.flatMap((browser) => browser.captureScreenshot(tabId, params)),
        ),
      // Chrome for Testing shows `beforeunload` as a JS dialog, so no navigation waits here.
      allowNextUnload: () => Effect.void,
      // A workspace without a running Chrome has no live grants: they end with the process.
      revokeSitePermissions: (workspaceId, origin, permission) =>
        Effect.suspend(
          () =>
            workspaces.get(workspaceId)?.revokeSitePermissions(origin, permission) ?? Effect.void,
        ),
      deleteWorkspaceProfile,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose: () =>
        Effect.gen(function* () {
          disposed = true;
          const fiber = installRun?.fiber;
          if (fiber) yield* Fiber.interrupt(fiber);
          const browsers = Array.from(workspaces.values());
          workspaces.clear();
          yield* Effect.forEach(browsers, (browser) => browser.stop(), {
            concurrency: "unbounded",
          });
        }),
    };
    return engine;
  });
