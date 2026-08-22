import { hostInvokeFailureFromError } from "@openducktor/host";
import type { HostInvokeFailure } from "@openducktor/contracts";
import type { Effect } from "effect";
import { runElectronEffect } from "../effect/electron-boundary";
import { errorMessage } from "../effect/electron-errors";

export type UnvalidatedElectronHostInvokeResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      error: {
        message: string;
        failure?: HostInvokeFailure;
      };
    };

export const runElectronHostInvoke = async <A, E extends Error>(
  effect: Effect.Effect<A, E>,
  execute: (effect: Effect.Effect<A, E>) => Promise<A> = runElectronEffect,
): Promise<UnvalidatedElectronHostInvokeResult> => {
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
