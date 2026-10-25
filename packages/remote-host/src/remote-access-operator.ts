import type {
  RemoteAccessConfiguration,
  RemoteAccessEnableInput,
  RemoteAccessSettings,
  RemoteAccessState,
  RemoteFailure,
} from "@openducktor/contracts";
import { Effect, Stream } from "effect";
import {
  enableRemoteAccessFromEnvironment,
  type RemoteAccessController,
  RemoteAccessError,
  remoteAccessConfiguration,
} from "./remote-access-controller";
import type { RemoteHostServices } from "./remote-work-interface";

/** The settings of the host that keep remote control across restarts. */
export type RemoteAccessSettingsStore = Pick<
  RemoteHostServices["hostSettings"],
  "readRemoteAccessSettings" | "saveRemoteAccessSettings"
>;

/**
 * Remote control as the local operator uses it. It turns the listener on and off and saves it in
 * the settings file, so a restart and the next enable reuse the same address.
 */
export type RemoteAccessOperator = Pick<
  RemoteAccessController,
  "readNetworks" | "enable" | "disable" | "states"
> & {
  readState(): Effect.Effect<RemoteAccessState, RemoteAccessError>;
  /**
   * Starts remote control as the last run left it. Environment variables replace the saved
   * listener for this run and save nothing.
   */
  restore(environment: Readonly<Record<string, string | undefined>>): Effect.Effect<void>;
};

const SAVE_FAILURE_ACTION =
  "Check that OpenDucktor can write its settings file, then enable remote control again.";

const saveFailure = (cause: { message: string }): RemoteFailure => ({
  code: "unavailable",
  message: `Remote control could not save its settings: ${cause.message}`,
  nextAction: SAVE_FAILURE_ACTION,
});

/**
 * The saved listener of an enable: the bound port and only the fields that the operator chose.
 * The controller derives the default public address again on each enable.
 */
const savedListener = (
  input: RemoteAccessEnableInput,
  configuration: RemoteAccessConfiguration,
): NonNullable<RemoteAccessSettings["configuration"]> => {
  const listener: NonNullable<RemoteAccessSettings["configuration"]> = {
    listenHost: input.listenHost,
    listenPort: configuration.listenPort,
  };
  if (input.publicEndpoint !== undefined) listener.publicEndpoint = input.publicEndpoint;
  if (input.webOrigins !== undefined) listener.webOrigins = input.webOrigins;
  return listener;
};

export const createRemoteAccessOperator = (
  controller: RemoteAccessController,
  store: RemoteAccessSettingsStore,
  options: { reportFailure(cause: unknown): void },
): RemoteAccessOperator => {
  let saved: RemoteAccessSettings | null = null;
  /** A failed save leaves the listener on, so the state shows it until the next save. */
  let failedSave: RemoteFailure | null = null;
  const loadSaved = Effect.suspend(() =>
    saved
      ? Effect.succeed(saved)
      : store.readRemoteAccessSettings().pipe(
          Effect.tap((settings) =>
            Effect.sync(() => {
              saved = settings;
            }),
          ),
        ),
  ).pipe(
    Effect.mapError(
      (cause) =>
        new RemoteAccessError({
          failure: {
            code: "unavailable",
            message: `Remote control could not read its settings: ${cause.message}`,
            nextAction: "Check the OpenDucktor settings file, then open Settings again.",
          },
        }),
    ),
  );
  const save = (next: RemoteAccessSettings) =>
    store.saveRemoteAccessSettings(next).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          saved = next;
          failedSave = null;
        }),
      ),
      Effect.catch((cause) =>
        Effect.sync(() => {
          failedSave = saveFailure(cause);
        }),
      ),
    );
  /**
   * Off or failed, remote control shows the saved listener, which the next enable starts again.
   */
  const withSaved = (state: RemoteAccessState): RemoteAccessState => {
    const configuration =
      (state.status === "disabled" || state.status === "failed") &&
      state.configuration === null &&
      saved?.configuration
        ? remoteAccessConfiguration(saved.configuration, saved.configuration.listenPort)
        : state.configuration;
    const shown: RemoteAccessState = { ...state, configuration };
    if (!state.failure && failedSave) shown.failure = failedSave;
    return shown;
  };
  const readState = () =>
    Effect.gen(function* () {
      yield* loadSaved;
      return withSaved(yield* controller.readState());
    });
  return {
    readNetworks: () => controller.readNetworks(),
    states: controller.states.pipe(Stream.map(withSaved)),
    readState,
    enable: (input) =>
      Effect.gen(function* () {
        yield* loadSaved;
        const state = yield* controller.enable(input);
        if (state.configuration)
          yield* save({ enabled: true, configuration: savedListener(input, state.configuration) });
        return withSaved(state);
      }),
    disable: () =>
      Effect.gen(function* () {
        const settings = yield* loadSaved;
        const state = yield* controller.disable();
        if (settings.enabled) yield* save({ ...settings, enabled: false });
        return withSaved(state);
      }),
    restore: (environment) =>
      Effect.gen(function* () {
        const settings = yield* loadSaved;
        const fromEnvironment = [
          "OPENDUCKTOR_REMOTE_HOST",
          "OPENDUCKTOR_REMOTE_PORT",
          "OPENDUCKTOR_REMOTE_ENDPOINT",
        ].some((name) => environment[name] !== undefined);
        if (fromEnvironment)
          return yield* enableRemoteAccessFromEnvironment(controller, environment);
        if (!settings.enabled || !settings.configuration) return;
        // A failed start shows in the state, such as a port that another app took.
        yield* controller.enable(settings.configuration).pipe(Effect.ignore);
      }).pipe(Effect.catch((cause) => Effect.sync(() => options.reportFailure(cause)))),
  };
};
