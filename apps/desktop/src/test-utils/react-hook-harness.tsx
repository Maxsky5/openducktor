import { renderHook } from "@testing-library/react";
import type { ComponentType, PropsWithChildren } from "react";
import { act } from "react";

type HookRunner<State> = (state: State) => void | Promise<void>;

type CreateHookHarnessOptions = {
  wrapper?: ComponentType<PropsWithChildren>;
};

const flushHookEffects = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await new Promise<void>((resolve) => {
      if (typeof MessageChannel === "undefined") {
        setTimeout(resolve, 0);
        return;
      }

      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
  });
};

export const createHookHarness = <Props, State>(
  useHook: (props: Props) => State,
  initialProps: Props,
  options?: CreateHookHarnessOptions,
) => {
  let currentProps = initialProps;
  let rendered: ReturnType<typeof renderHook<State, Props>> | null = null;

  const mount = async (): Promise<void> => {
    await act(async () => {
      rendered = renderHook(useHook, {
        initialProps: currentProps,
        ...(options?.wrapper ? { wrapper: options.wrapper } : {}),
      });
    });
    await flushHookEffects();
  };

  const update = async (nextProps: Props): Promise<void> => {
    currentProps = nextProps;
    if (!rendered) {
      throw new Error("Hook state unavailable");
    }
    await act(async () => {
      rendered?.rerender(currentProps);
    });
    await flushHookEffects();
  };

  const run = async (fn: HookRunner<State>): Promise<void> => {
    if (!rendered) {
      throw new Error("Hook state unavailable");
    }
    const hook = rendered;
    await act(async () => {
      await fn(hook.result.current);
    });
    await flushHookEffects();
  };

  const getLatest = (): State => {
    if (!rendered) {
      throw new Error("Hook state unavailable");
    }
    return rendered.result.current;
  };

  const waitForState = async (
    predicate: (state: State) => boolean,
    timeoutMs = 200,
  ): Promise<void> => {
    if (!rendered) {
      throw new Error("Hook state unavailable");
    }
    const hook = rendered;
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (predicate(hook.result.current)) {
        return;
      }
      await flushHookEffects();
    }

    throw new Error("Hook state not ready");
  };

  const unmount = async (): Promise<void> => {
    await act(async () => {
      rendered?.unmount();
    });
    await flushHookEffects();
    rendered = null;
  };

  return {
    mount,
    update,
    run,
    getLatest,
    waitFor: waitForState,
    unmount,
  };
};
