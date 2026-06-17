import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
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
    expect(observers.observedSessionKeys()).toEqual(
      new Set([agentSessionIdentityKey(firstSession)]),
    );
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
    expect(observers.observedSessionKeys()).toEqual(new Set([agentSessionIdentityKey(session)]));
    observers.remove(session);
    expect(observers.has(session)).toBe(false);
    expect(observers.observedSessionKeys()).toEqual(new Set());
    resolveObserver(() => calls.push("pending"));
    await expect(registration).resolves.toBe(false);

    expect(calls).toEqual(["pending"]);
    expect(observers.has(session)).toBe(false);
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
