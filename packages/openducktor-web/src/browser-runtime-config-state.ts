export type BrowserRuntimeConfigState = {
  readonly ready: Promise<string>;
  readonly value: string | null;
  publish(value: string): void;
};

export const createBrowserRuntimeConfigState = (): BrowserRuntimeConfigState => {
  const ready = Promise.withResolvers<string>();
  let value: string | null = null;

  return {
    ready: ready.promise,
    get value() {
      return value;
    },
    publish(nextValue) {
      value = nextValue;
      ready.resolve(nextValue);
    },
  };
};

export const readBrowserRuntimeConfig = (
  state: BrowserRuntimeConfigState,
): string | Promise<string> => state.value ?? state.ready;
