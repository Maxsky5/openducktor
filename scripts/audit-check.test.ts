import { describe, expect, test } from "bun:test";

import { runDependencyAuditChecks } from "./audit-check";
import { runBunAuditJson } from "./audit-utils";

const silentReporter = {
  error: (_message: string): void => {},
  warn: (_message: string): void => {},
};

describe("dependency audit checks", () => {
  test("uses one audit response for every dependency audit policy", () => {
    let requestCount = 0;

    const exitCode = runDependencyAuditChecks(() => {
      requestCount += 1;
      if (requestCount > 1) {
        throw new Error("audit requested more than once");
      }
      return { parsed: {}, exitCode: 0 };
    }, silentReporter);

    expect(exitCode).toBe(0);
    expect(requestCount).toBe(1);
  });

  test("blocks high-severity advisories", () => {
    const errors: string[] = [];

    const exitCode = runDependencyAuditChecks(
      () => ({
        parsed: {
          vulnerable: [
            {
              severity: "high",
              title: "Unsafe package",
              url: "https://github.com/advisories/GHSA-test-high",
              vulnerable_versions: "<2.0.0",
            },
          ],
        },
        exitCode: 1,
      }),
      {
        error: (message) => errors.push(message),
        warn: (_message) => {},
      },
    );

    expect(exitCode).toBe(1);
    expect(errors).toContain("[deps:audit:high] HIGH vulnerable: Unsafe package");
  });

  test("blocks the targeted Hono advisories", () => {
    const errors: string[] = [];

    const exitCode = runDependencyAuditChecks(
      () => ({
        parsed: {
          hono: [
            {
              severity: "moderate",
              url: "https://github.com/advisories/GHSA-xh87-mx6m-69f3",
            },
          ],
        },
        exitCode: 1,
      }),
      {
        error: (message) => errors.push(message),
        warn: (_message) => {},
      },
    );

    expect(exitCode).toBe(1);
    expect(errors).toContain(
      "[deps:audit:hono] Advisory detected for hono: GHSA-xh87-mx6m-69f3. Lockfile must resolve hono >=4.12.7.",
    );
  });
});

test("bun audit timeout reports a transport failure", () => {
  let receivedTimeoutMs = 0;
  const runAudit = (timeoutMs: number) => {
    receivedTimeoutMs = timeoutMs;
    return {
      exitedDueToTimeout: true,
      exitCode: null,
      stderr: "",
      stdout: "",
    };
  };

  expect(() => runBunAuditJson("[deps:audit]", runAudit)).toThrow(
    "[deps:audit] `bun audit --json` timed out after 30 seconds.",
  );
  expect(receivedTimeoutMs).toBe(30_000);
});

test("bun audit startup failure is actionable", () => {
  expect(() =>
    runBunAuditJson("[deps:audit]", () => {
      throw new Error("Executable not found");
    }),
  ).toThrow("[deps:audit] Failed to start `bun audit --json`.");
});

test("bun audit failure is not reported as a JSON parse failure", () => {
  expect(() =>
    runBunAuditJson("[deps:audit]", () => ({
      exitCode: 1,
      stderr: "Timeout: audit request failed",
      stdout: "",
    })),
  ).toThrow("[deps:audit] `bun audit --json` failed before returning JSON.");
});
