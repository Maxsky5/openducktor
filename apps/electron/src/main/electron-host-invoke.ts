import { TerminalServiceError, terminalServiceErrorToFailure } from "@openducktor/host";
import type { Effect } from "effect";
import { runElectronEffect } from "../effect/electron-boundary";
import { errorMessage } from "../effect/electron-errors";
import type { ElectronHostInvokeResult } from "../shared/electron-bridge-contract";

export const runElectronHostInvoke = async <A, E extends Error>(
  effect: Effect.Effect<A, E>,
  execute: (effect: Effect.Effect<A, E>) => Promise<A> = runElectronEffect,
): Promise<ElectronHostInvokeResult> => {
  try {
    return { ok: true, value: await execute(effect) };
  } catch (cause) {
    return {
      ok: false,
      error: {
        message: errorMessage(cause),
        ...(cause instanceof TerminalServiceError
          ? {
              failure: {
                kind: "terminal" as const,
                terminalFailure: terminalServiceErrorToFailure(cause),
              },
            }
          : {}),
      },
    };
  }
};
