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
    const firstSession = createSessionRef("/tmp/repo/first");
    const secondSession = createSessionRef("/tmp/repo/second");
    const observers = createSessionObservers([{ session: firstSession, unsubscribe: () => {} }]);

    expect(observers.has(firstSession)).toBe(true);
    expect(observers.has(secondSession)).toBe(false);
  });

  test("rejects duplicate observers for the same session identity", () => {
    const session = createSessionRef("/tmp/repo/first");

    expect(() =>
      createSessionObservers([
        { session, unsubscribe: () => {} },
        { session, unsubscribe: () => {} },
      ]),
    ).toThrow("Session observer already exists for 'external-1'.");
  });

  test("ensures one observer while a subscription is pending", async () => {
    const observers = createSessionObservers();
    const calls: string[] = [];
    const session = createSessionRef("/tmp/repo/first");
    let subscriptionCount = 0;

    const createObserver = async () => {
      subscriptionCount += 1;
      return subscriptionCount === 1 ? () => calls.push("first") : () => calls.push("second");
    };

    await expect(
      Promise.all([
        observers.ensureObserver(session, createObserver),
        observers.ensureObserver(session, createObserver),
      ]),
    ).resolves.toEqual([true, false]);

    expect(subscriptionCount).toBe(1);
    expect(calls).toEqual([]);
    expect(observers.has(session)).toBe(true);
    await expect(observers.ensureObserver(session, createObserver)).resolves.toBe(false);

    observers.remove(session);

    expect(calls).toEqual(["first"]);
  });

  test("cancels a pending observer when the session is removed", async () => {
    const observers = createSessionObservers();
    const calls: string[] = [];
    const session = createSessionRef("/tmp/repo/first");
    let resolveObserver!: (unsubscribe: () => void) => void;
    const observerPromise = new Promise<() => void>((resolve) => {
      resolveObserver = resolve;
    });

    const registration = observers.ensureObserver(session, () => observerPromise);
    expect(observers.has(session)).toBe(true);
    observers.remove(session);
    expect(observers.has(session)).toBe(false);
    resolveObserver(() => calls.push("pending"));
    await expect(registration).resolves.toBe(false);

    expect(calls).toEqual(["pending"]);
    expect(observers.has(session)).toBe(false);
  });

  test("removes all matching observers before callbacks can mutate the collection", async () => {
    const observers = createSessionObservers();
    const calls: string[] = [];
    const firstSession = createSessionRef("/tmp/repo/first");
    const secondSession = createSessionRef("/tmp/repo/second");

    await observers.ensureObserver(firstSession, async () => () => {
      calls.push("first");
      observers.removeMany([secondSession]);
    });
    await observers.ensureObserver(secondSession, async () => () => {
      calls.push("second");
    });

    observers.removeMany([firstSession, secondSession]);

    expect(calls).toEqual(["first", "second"]);
    expect(observers.has(firstSession)).toBe(false);
    expect(observers.has(secondSession)).toBe(false);
  });

  test("clears all observers before callbacks can mutate the collection", async () => {
    const observers = createSessionObservers();
    const calls: string[] = [];
    const firstSession = createSessionRef("/tmp/repo/first");
    const secondSession = createSessionRef("/tmp/repo/second");

    await observers.ensureObserver(firstSession, async () => () => {
      calls.push("first");
      observers.remove(secondSession);
    });
    await observers.ensureObserver(secondSession, async () => () => {
      calls.push("second");
    });

    observers.clear();

    expect(calls).toEqual(["first", "second"]);
    expect(observers.has(firstSession)).toBe(false);
    expect(observers.has(secondSession)).toBe(false);
  });
});
