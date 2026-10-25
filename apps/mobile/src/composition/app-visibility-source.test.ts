import { describe, expect, test } from "bun:test";
import { type AppStateSource, visibilityOf } from "./app-visibility-source";

type Status = "active" | "inactive" | "background";

const fakeAppState = (initial: Status) => {
  let current = initial;
  const listeners = new Set<(status: Status) => void>();
  const source: AppStateSource<Status> = {
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const change = (next: Status) => {
    current = next;
    for (const listener of listeners) listener(next);
  };
  return { source, change, listenerCount: () => listeners.size };
};

describe("visibilityOf", () => {
  test("reports only a change of the hidden state", () => {
    const appState = fakeAppState("active");
    const visibility = visibilityOf(appState.source, (status) => status === "background");
    const seen: boolean[] = [];
    visibility.subscribe(() => seen.push(visibility.isHidden()));

    appState.change("inactive");
    appState.change("active");
    expect(seen).toEqual([]);

    appState.change("inactive");
    appState.change("background");
    appState.change("active");
    expect(seen).toEqual([true, false]);
  });

  test("hides on the first state that the rule counts as hidden", () => {
    const appState = fakeAppState("active");
    const visibility = visibilityOf(
      appState.source,
      (status) => status === "inactive" || status === "background",
    );
    const seen: boolean[] = [];
    visibility.subscribe(() => seen.push(visibility.isHidden()));

    appState.change("inactive");
    appState.change("background");
    appState.change("active");
    expect(seen).toEqual([true, false]);
  });

  test("starts from the state at subscription and stops on unsubscribe", () => {
    const appState = fakeAppState("background");
    const visibility = visibilityOf(appState.source, (status) => status === "background");
    let changes = 0;
    const stop = visibility.subscribe(() => {
      changes += 1;
    });

    appState.change("background");
    expect(changes).toBe(0);
    appState.change("active");
    expect(changes).toBe(1);

    stop();
    expect(appState.listenerCount()).toBe(0);
  });
});
