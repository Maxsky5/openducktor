import { hostInvokeFailureFromError, type HostCommandResult } from "@openducktor/host";
import type { Effect } from "effect";
import { runElectronEffect } from "../effect/electron-boundary";
import { errorMessage } from "../effect/electron-errors";
import type { ElectronHostInvokeResult } from "../shared/electron-bridge-contract";

export const runElectronHostInvoke = async <A extends HostCommandResult, E extends Error>(
  effect: Effect.Effect<A, E>,
  execute: (effect: Effect.Effect<A, E>) => Promise<A> = runElectronEffect,
): Promise<ElectronHostInvokeResult> => {
  try {
    return { ok: true, value: await execute(effect) };
  } catch (cause) {
    const failure = hostInvokeFailureFromError(cause);
    return {
      ok: false,
      error: {
        message: errorMessage(cause),
        ...(failure ? { failure } : undefined),
      },
    };
  }
};
