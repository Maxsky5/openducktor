import { type Cause, Effect, Exit } from "effect";
import { causeToElectronBoundaryError, errorMessage } from "./electron-errors";

export const runElectronEffect = async <A, E>(effect: Effect.Effect<A, E>): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  throw causeToElectronBoundaryError(exit.cause);
};

export const runElectronSync = <A, E>(effect: Effect.Effect<A, E>): A => {
  const exit = Effect.runSyncExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  throw causeToElectronBoundaryError(exit.cause);
};

export const logElectronBoundaryError = <E>(cause: Cause.Cause<E>): void => {
  console.error(errorMessage(causeToElectronBoundaryError(cause)));
};
