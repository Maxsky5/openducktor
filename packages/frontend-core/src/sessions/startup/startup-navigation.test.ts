import { expect, test } from "bun:test";
import type { StartupAttempt, StartupAttemptStatus } from "./startup-attempt-store";
import { canOpenStartupSession } from "./startup-navigation";

const savedAttempt = (phase: StartupAttemptStatus["phase"]): StartupAttempt => ({
  id: "attempt",
  origin: { workspaceId: "workspace", repoPath: "/repo", scope: { kind: "workspace" } },
  label: "Start workspace session",
  presentation: "dialog",
  status: { phase, confirmation: "current" },
  instructionRequired: false,
  operations: [],
  ownership: {
    state: "saved",
    target: {
      kind: "workspace",
      record: {
        id: "saved",
        runtimeKind: "codex",
        externalSessionId: "native",
        executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
        selectedModel: null,
        roleSnapshot: null,
        generatedTitle: null,
        manualTitle: null,
        targetBranch: null,
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null,
      },
    },
  },
  navigationTarget: { kind: "workspace_session", workspaceId: "workspace", sessionId: "saved" },
});

test.each([
  ["submitting", false],
  ["waiting", false],
  ["running", false],
  ["settling", false],
  ["ready", true],
  ["failed", true],
  ["canceled", true],
] as const)("saved %s startup exposes Open only after settlement", (phase, expected) => {
  expect(canOpenStartupSession(savedAttempt(phase))).toBe(expected);
});

test.each(["ready", "failed", "canceled"] as const)(
  "an unconfirmed %s outcome cannot leave its startup dialog through Open",
  (phase) => {
    const attempt = savedAttempt(phase);
    attempt.status.confirmation = "unconfirmed";
    expect(canOpenStartupSession(attempt)).toBe(false);
  },
);

test("Open needs saved native ownership and its navigation target", () => {
  const attempt = savedAttempt("failed");
  if (attempt.ownership.state !== "saved" || attempt.ownership.target.kind !== "workspace")
    throw new Error("Missing saved workspace fixture.");
  attempt.ownership.target.record.externalSessionId = null;
  expect(canOpenStartupSession(attempt)).toBe(false);
  expect(
    canOpenStartupSession({ ...savedAttempt("failed"), ownership: { state: "unknown" } }),
  ).toBe(false);
  const { navigationTarget: _target, ...withoutTarget } = savedAttempt("failed");
  expect(canOpenStartupSession(withoutTarget)).toBe(false);
  expect(canOpenStartupSession(null)).toBe(false);
});
