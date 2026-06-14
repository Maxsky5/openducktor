import { describe, expect, test } from "bun:test";
import {
  createSessionListenerRegistry,
  hasSessionListener,
  hasSessionListenerForExternalSessionId,
  removeSessionListenersByExternalSessionId,
  setSessionListener,
} from "./session-listener-registry";

const createSessionRef = (workingDirectory: string) =>
  ({
    externalSessionId: "external-1",
    repoPath: "/tmp/repo",
    runtimeKind: "opencode",
    workingDirectory,
  }) as const;

describe("session listener registry", () => {
  test("keys listeners by full session identity", () => {
    const registry = createSessionListenerRegistry();
    const firstSession = createSessionRef("/tmp/repo/first");
    const secondSession = createSessionRef("/tmp/repo/second");

    setSessionListener(registry, firstSession, () => {});

    expect(hasSessionListener(registry, firstSession)).toBe(true);
    expect(hasSessionListener(registry, secondSession)).toBe(false);
    expect(hasSessionListenerForExternalSessionId(registry, "external-1")).toBe(true);
  });

  test("removes all matching listeners before callbacks can mutate the registry", () => {
    const registry = createSessionListenerRegistry();
    const calls: string[] = [];
    const firstSession = createSessionRef("/tmp/repo/first");
    const secondSession = createSessionRef("/tmp/repo/second");

    setSessionListener(registry, firstSession, () => {
      calls.push("first");
      removeSessionListenersByExternalSessionId(registry, "external-1");
    });
    setSessionListener(registry, secondSession, () => {
      calls.push("second");
    });

    removeSessionListenersByExternalSessionId(registry, "external-1");

    expect(calls).toEqual(["first", "second"]);
    expect(hasSessionListenerForExternalSessionId(registry, "external-1")).toBe(false);
  });
});
