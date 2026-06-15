import { describe, expect, test } from "bun:test";
import { createSessionObservers } from "./session-observers";

const createSessionRef = (workingDirectory: string) =>
  ({
    externalSessionId: "external-1",
    repoPath: "/tmp/repo",
    runtimeKind: "opencode",
    workingDirectory,
  }) as const;

describe("session observers", () => {
  test("keys observers by full session identity", () => {
    const observers = createSessionObservers();
    const firstSession = createSessionRef("/tmp/repo/first");
    const secondSession = createSessionRef("/tmp/repo/second");

    observers.add(firstSession, () => {});

    expect(observers.has(firstSession)).toBe(true);
    expect(observers.has(secondSession)).toBe(false);
  });

  test("rejects duplicate observers for the same session identity", () => {
    const observers = createSessionObservers();
    const session = createSessionRef("/tmp/repo/first");

    observers.add(session, () => {});

    expect(() => observers.add(session, () => {})).toThrow(
      "Session observer already exists for 'external-1'.",
    );
  });

  test("removes all matching observers before callbacks can mutate the collection", () => {
    const observers = createSessionObservers();
    const calls: string[] = [];
    const firstSession = createSessionRef("/tmp/repo/first");
    const secondSession = createSessionRef("/tmp/repo/second");

    observers.add(firstSession, () => {
      calls.push("first");
      observers.removeMany([secondSession]);
    });
    observers.add(secondSession, () => {
      calls.push("second");
    });

    observers.removeMany([firstSession, secondSession]);

    expect(calls).toEqual(["first", "second"]);
    expect(observers.has(firstSession)).toBe(false);
    expect(observers.has(secondSession)).toBe(false);
  });

  test("clears all observers before callbacks can mutate the collection", () => {
    const observers = createSessionObservers();
    const calls: string[] = [];
    const firstSession = createSessionRef("/tmp/repo/first");
    const secondSession = createSessionRef("/tmp/repo/second");

    observers.add(firstSession, () => {
      calls.push("first");
      observers.remove(secondSession);
    });
    observers.add(secondSession, () => {
      calls.push("second");
    });

    observers.clear();

    expect(calls).toEqual(["first", "second"]);
    expect(observers.has(firstSession)).toBe(false);
    expect(observers.has(secondSession)).toBe(false);
  });
});
