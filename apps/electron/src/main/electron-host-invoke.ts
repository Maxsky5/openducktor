import {
  hostInvokeFailureFromError,
  type HostCommandName,
  type HostCommandResult,
} from "@openducktor/host";
import type { Effect } from "effect";
import { runElectronEffect } from "../effect/electron-boundary";
import { errorMessage } from "../effect/electron-errors";
import type { ElectronHostInvokeResult } from "../shared/electron-bridge-contract";

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
