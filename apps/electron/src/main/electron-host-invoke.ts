import {
  hostInvokeFailureFromError,
  HostOperationError,
  type HostCommandResult,
  type EffectNodeHostCommandRouter,
} from "@openducktor/host";
import { Effect } from "effect";
import {
  settingsSnapshotSchema,
  themePreferenceSchema,
  type HostCommandArgs,
  type HostErrorResponse,
  type ThemePreference,
} from "@openducktor/contracts";
import { errorMessage } from "../effect/electron-errors";
import type { createElectronMainRuntimeBindings } from "./electron-main-runtime-bindings";

import { runElectronEffect } from "../effect/electron-boundary";
import type { HostChannelReply } from "@openducktor/remote-host/host-channel";

type InvokeFailure =
  ReturnType<EffectNodeHostCommandRouter["invoke"]> extends Effect.Effect<
    infer _Success,
    infer Failure
  >
    ? Failure
    : never;

/** Local IPC and remote clients must apply the same native effects after successful host commands. */
export const createElectronHostInvoke =
  (
    router: Pick<EffectNodeHostCommandRouter, "invoke">,
    bindings: Pick<ReturnType<typeof createElectronMainRuntimeBindings>, "runHostCommand">,
    nativeTheme: { themeSource: ThemePreference },
  ): EffectNodeHostCommandRouter["invoke"] =>
  (command: string, args?: HostCommandArgs) =>
    Effect.suspend(() => {
      let hostFailure: InvokeFailure | undefined;
      const operation = router.invoke(command, args).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            if (command === "workspace_get_settings_snapshot")
              nativeTheme.themeSource = settingsSnapshotSchema.parse(value).theme;
            else if (command === "set_theme")
              nativeTheme.themeSource = themePreferenceSchema.unwrap().parse(args?.theme);
          }),
        ),
        Effect.tapError((error) =>
          Effect.sync(() => {
            hostFailure = error;
          }),
        ),
      );
      return Effect.tryPromise({
        // An interrupted read aborts the signal, so the command stops and runs its cleanup.
        try: (signal) => bindings.runHostCommand(command, operation, signal),
        catch: (cause) => {
          if (hostFailure !== undefined && cause === hostFailure) return hostFailure;
          return new HostOperationError({
            operation: "electron.host.invoke",
            message: errorMessage(cause),
            cause,
            details: { hostInvokeFailure: hostInvokeFailureFromError(hostFailure) },
          });
        },
      });
    });

/** Runs a command of a desktop window and returns its result or its host error payload. */
export const runElectronHostChannelInvoke = async <E extends Error>(
  effect: Effect.Effect<HostCommandResult, E>,
  signal?: AbortSignal,
): Promise<HostChannelReply> => {
  try {
    return { result: await runElectronEffect(effect, signal) };
  } catch (cause) {
    const response: HostErrorResponse = { message: errorMessage(cause) };
    const failure = hostInvokeFailureFromError(cause);
    if (failure) response.failure = failure;
    return { error: { kind: "host", response } };
  }
};
