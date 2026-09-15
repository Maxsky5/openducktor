import { afterEach, describe, expect, test } from "bun:test";
import type { Theme } from "@openducktor/contracts";
import {
  readSystemAppearance,
  resolveThemePreference,
  subscribeToSystemAppearance,
} from "./theme-preference";

type MediaQueryListener = (event: { matches: boolean }) => void;

type FakeMediaQueryList = {
  matches: boolean;
  listeners: Set<MediaQueryListener>;
  addEventListener: (type: string, listener: MediaQueryListener) => void;
  removeEventListener: (type: string, listener: MediaQueryListener) => void;
  emit: (matches: boolean) => void;
};

const originalMatchMedia = globalThis.matchMedia;

const installFakeMatchMedia = (matches: boolean): FakeMediaQueryList => {
  const query: FakeMediaQueryList = {
    matches,
    listeners: new Set<MediaQueryListener>(),
    addEventListener: (_type, listener) => {
      query.listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      query.listeners.delete(listener);
    },
    emit: (nextMatches) => {
      query.matches = nextMatches;
      for (const listener of query.listeners) {
        listener({ matches: nextMatches });
      }
    },
  };

  // SAFETY: the test owns this global and replaces the browser media query API with a stub.
  // biome-ignore lint/suspicious/noExplicitAny: the test replaces a browser global with a stub.
  (globalThis as any).matchMedia = () => query;
  return query;
};

const removeMatchMedia = (): void => {
  // SAFETY: the test owns this global and removes the browser media query API on purpose.
  // biome-ignore lint/suspicious/noExplicitAny: the test removes a browser global.
  (globalThis as any).matchMedia = undefined;
};

afterEach(() => {
  // SAFETY: the test owns this global and restores the value it captured at module load.
  // biome-ignore lint/suspicious/noExplicitAny: the test restores a browser global.
  (globalThis as any).matchMedia = originalMatchMedia;
});

describe("readSystemAppearance", () => {
  test("reports the dark appearance when the operating system prefers dark", () => {
    installFakeMatchMedia(true);

    expect(readSystemAppearance()).toBe("dark");
  });

  test("reports the light appearance when the operating system prefers light", () => {
    installFakeMatchMedia(false);

    expect(readSystemAppearance()).toBe("light");
  });

  test("reports the light appearance when the appearance cannot be determined", () => {
    removeMatchMedia();

    expect(readSystemAppearance()).toBe("light");
  });
});

describe("subscribeToSystemAppearance", () => {
  test("reports later operating system appearance changes until it is removed", () => {
    const query = installFakeMatchMedia(false);
    const observed: Theme[] = [];

    const unsubscribe = subscribeToSystemAppearance((appearance) => observed.push(appearance));
    query.emit(true);
    query.emit(false);
    unsubscribe();
    query.emit(true);

    expect(observed).toEqual(["dark", "light"]);
    expect(query.listeners.size).toBe(0);
  });

  test("returns a removal function when the appearance cannot be observed", () => {
    removeMatchMedia();

    expect(() => subscribeToSystemAppearance(() => {})()).not.toThrow();
  });
});

describe("resolveThemePreference", () => {
  test("follows the system appearance for the system preference", () => {
    expect(resolveThemePreference("system", "dark")).toBe("dark");
    expect(resolveThemePreference("system", "light")).toBe("light");
  });

  test("keeps an explicit preference regardless of the system appearance", () => {
    expect(resolveThemePreference("light", "dark")).toBe("light");
    expect(resolveThemePreference("dark", "light")).toBe("dark");
  });
});
