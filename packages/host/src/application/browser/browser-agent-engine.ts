import type { BrowserEngineState } from "@openducktor/contracts";
import { Deferred, Effect, Exit } from "effect";
import type { BrowserEnginePort, BrowserInstaller } from "../../ports/browser-engine-port";
import { BrowserServiceError } from "./browser-service-error";
import { requireBrowserEngineReady } from "./browser-tab-rules";

/**
 * How long one agent tool call waits for the browser install. It stays well inside the time limit
 * of the call, so a longer install returns the download progress to the agent.
 */
const INSTALL_WAIT_MS = 20_000;

/** True while the install runs, and before it starts, so an agent call can start it. */
const needsInstall = (state: BrowserEngineState): boolean =>
  state.kind === "not_installed" ||
  state.kind === "downloading" ||
  state.kind === "verifying" ||
  state.kind === "failed";

/**
 * Starts the install, or a new try after a failure, and waits for its outcome: the first engine
 * state after the start that is not a download step. The listener starts before the install, so
 * no outcome is lost. A running install only gets waited for.
 */
const installAndWait = (
  engine: Pick<BrowserEnginePort, "subscribe">,
  installer: BrowserInstaller,
  operation: string,
): Effect.Effect<void, BrowserServiceError> =>
  Effect.suspend(() => {
    const done = Deferred.makeUnsafe<void>();
    const unsubscribe = engine.subscribe((event) => {
      if (event.type !== "state_changed") return;
      if (event.state.kind === "downloading" || event.state.kind === "verifying") return;
      Deferred.doneUnsafe(done, Exit.void);
    });
    return installer.start().pipe(
      Effect.mapError(
        (cause) =>
          new BrowserServiceError({
            code: "browser_install_failed",
            operation,
            message: cause.message,
            cause,
          }),
      ),
      Effect.andThen(Deferred.await(done).pipe(Effect.timeoutOption(INSTALL_WAIT_MS))),
      Effect.asVoid,
      Effect.ensuring(Effect.sync(unsubscribe)),
    );
  });

/**
 * Fails unless the engine can open agent tabs. The web runner installs its browser on the first
 * agent use: the call starts the download, or a new try after a failure, and waits for it. When the
 * install takes longer, the failure tells the agent to call the tool again.
 */
export const readyBrowserEngineForAgent = (
  engine: Pick<BrowserEnginePort, "state" | "installer" | "subscribe">,
  operation: string,
): Effect.Effect<void, BrowserServiceError> =>
  Effect.gen(function* () {
    if (engine.installer !== null && needsInstall(engine.state())) {
      yield* installAndWait(engine, engine.installer, operation);
    }
    yield* requireBrowserEngineReady(engine.state(), operation);
  });
