import {
  hostInvokeFailureFromError,
  HostOperationError,
  type HostCommandName,
  type HostCommandResult,
  type EffectNodeHostCommandRouter,
} from "@openducktor/host";
import { Effect } from "effect";
import {
  settingsSnapshotSchema,
  themePreferenceSchema,
  type HostCommandArgs,
  type ThemePreference,
} from "@openducktor/contracts";
import { errorMessage } from "../effect/electron-errors";
import type { createElectronMainRuntimeBindings } from "./electron-main-runtime-bindings";

import { runElectronEffect } from "../effect/electron-boundary";
import type { ElectronHostInvokeResult } from "../shared/electron-bridge-contract";

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
        try: () => bindings.runHostCommand(command, operation),
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

export const runElectronHostInvoke = async <Command extends HostCommandName, E extends Error>(
  effect: Effect.Effect<HostCommandResult<Command>, E>,
  execute: (
    effect: Effect.Effect<HostCommandResult<Command>, E>,
  ) => Promise<HostCommandResult<Command>> = runElectronEffect,
): Promise<ElectronHostInvokeResult<Command>> => {
  try {
    return { ok: true, value: await execute(effect) };
  } catch (cause) {
    const failure = hostInvokeFailureFromError(cause);
    const error: Extract<ElectronHostInvokeResult<Command>, { ok: false }>["error"] = {
      message: errorMessage(cause),
    };
    if (failure) {
      error.failure = failure;
    }
    return {
      ok: false,
      error,
    };
  }
};
