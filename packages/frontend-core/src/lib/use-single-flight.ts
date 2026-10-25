import {
  type DefaultError,
  type UseMutateAsyncFunction,
  type UseMutateFunction,
  type UseMutationOptions,
  type UseMutationResult,
  useMutation,
} from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";

// A fast double tap or double click calls a handler twice before React renders the pending state
// of the first call. A check of render state, such as `isPending`, then lets the second call send
// the command again. These guards keep the in-flight state in a ref, which every call reads.

/** Runs one async action at a time. */
export type SingleFlight = {
  /**
   * Runs `action` and returns its result. While an earlier action of this flight runs, it does
   * not call `action` and resolves to `undefined`.
   */
  start: <Result>(action: () => Promise<Result>) => Promise<Result | undefined>;
};

/** One async action at a time for a form or a command button, across renders. */
export function useSingleFlight(): SingleFlight {
  const running = useRef(false);
  return useMemo(
    () => ({
      start: async (action) => {
        if (running.current) return undefined;
        running.current = true;
        try {
          return await action();
        } finally {
          running.current = false;
        }
      },
    }),
    [],
  );
}

/**
 * A mutation that sends one command at a time. While a call runs, `mutate` ignores a new call, and
 * `mutateAsync` returns the running call without a second command.
 */
export function useSingleFlightMutation<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TOnMutateResult = unknown,
>(
  options: UseMutationOptions<TData, TError, TVariables, TOnMutateResult>,
): UseMutationResult<TData, TError, TVariables, TOnMutateResult> {
  const mutation = useMutation(options);
  const running = useRef<Promise<TData> | null>(null);
  const { mutateAsync: send } = mutation;
  const mutateAsync = useCallback<
    UseMutateAsyncFunction<TData, TError, TVariables, TOnMutateResult>
  >(
    (...args) => {
      if (running.current) return running.current;
      const call = send(...args).finally(() => {
        running.current = null;
      });
      running.current = call;
      return call;
    },
    [send],
  );
  const mutate = useCallback<UseMutateFunction<TData, TError, TVariables, TOnMutateResult>>(
    (...args) => {
      // The mutation state and its callbacks report a failure, as with `useMutation`.
      mutateAsync(...args).catch(() => {});
    },
    [mutateAsync],
  );
  return { ...mutation, mutate, mutateAsync };
}
