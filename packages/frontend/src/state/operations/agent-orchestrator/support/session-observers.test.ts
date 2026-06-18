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
  test("keys observers by full session identity", async () => {
    const firstSession = createSessionRef("/tmp/repo/first");
    const secondSession = createSessionRef("/tmp/repo/second");
    const observers = createSessionObservers();

    await observers.ensureObserver(firstSession, async () => () => {});

    expect(observers.has(firstSession)).toBe(true);
    expect(observers.has(secondSession)).toBe(false);
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

    await Promise.all([
      observers.ensureObserver(session, createObserver),
      observers.ensureObserver(session, createObserver),
    ]);

    expect(subscriptionCount).toBe(1);
    expect(calls).toEqual([]);
    expect(observers.has(session)).toBe(true);
    await observers.ensureObserver(session, createObserver);
    expect(subscriptionCount).toBe(1);

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
    await registration;

    expect(calls).toEqual(["pending"]);
    expect(observers.has(session)).toBe(false);
  });

  test("does not let a removed pending observer replace a newer observer", async () => {
    const observers = createSessionObservers();
    const calls: string[] = [];
    const session = createSessionRef("/tmp/repo/first");
    let resolveFirstObserver!: (unsubscribe: () => void) => void;
    const firstObserverPromise = new Promise<() => void>((resolve) => {
      resolveFirstObserver = resolve;
    });

    const firstRegistration = observers.ensureObserver(session, () => firstObserverPromise);
    observers.remove(session);
    const secondRegistration = observers.ensureObserver(session, async () => () => {
      calls.push("second");
    });
    resolveFirstObserver(() => calls.push("first"));

    await firstRegistration;
    await secondRegistration;
    expect(observers.has(session)).toBe(true);

    observers.remove(session);

    expect(calls).toEqual(["first", "second"]);
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
