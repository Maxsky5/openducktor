import { expect, test } from "bun:test";
import type { StartupAttempt, StartupAttemptStatus } from "./startup-attempt-store";
import {
  canOpenStartupSession,
  canOpenWorkspaceStartupRecovery,
  findWorkspaceSessionStartupAttempt,
} from "./startup-navigation";

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

test("canOpenWorkspaceStartupRecovery allows reopening saved-unbound, pending, and unconfirmed workspace attempts", () => {
  const unboundFailed = savedAttempt("failed");
  if (
    unboundFailed.ownership.state !== "saved" ||
    unboundFailed.ownership.target.kind !== "workspace"
  ) {
    throw new Error("Missing saved workspace fixture.");
  }
  unboundFailed.ownership.target.record.externalSessionId = null;
  expect(canOpenWorkspaceStartupRecovery(unboundFailed)).toBe(true);

  const unboundRunning = savedAttempt("running");
  if (
    unboundRunning.ownership.state === "saved" &&
    unboundRunning.ownership.target.kind === "workspace"
  ) {
    unboundRunning.ownership.target.record.externalSessionId = null;
  }
  expect(canOpenWorkspaceStartupRecovery(unboundRunning)).toBe(true);

  const unconfirmed = savedAttempt("failed");
  unconfirmed.status.confirmation = "unconfirmed";
  expect(canOpenWorkspaceStartupRecovery(unconfirmed)).toBe(true);

  expect(
    canOpenWorkspaceStartupRecovery({
      ...savedAttempt("failed"),
      ownership: { state: "not_saved" },
    }),
  ).toBe(false);
  expect(canOpenWorkspaceStartupRecovery(null)).toBe(false);
});

test("findWorkspaceSessionStartupAttempt returns the newest attempt matching workspace and session id", () => {
  const older = { ...savedAttempt("failed"), id: "attempt-old" };
  const newer = { ...savedAttempt("running"), id: "attempt-new" };
  const otherWorkspace: StartupAttempt = {
    ...savedAttempt("failed"),
    id: "attempt-other-ws",
    origin: { workspaceId: "other-ws", repoPath: "/other", scope: { kind: "workspace" } },
  };
  expect(
    findWorkspaceSessionStartupAttempt([older, otherWorkspace, newer], "workspace", "saved")?.id,
  ).toBe("attempt-new");
  expect(
    findWorkspaceSessionStartupAttempt([older, otherWorkspace], "workspace", "missing"),
  ).toBeNull();
});
