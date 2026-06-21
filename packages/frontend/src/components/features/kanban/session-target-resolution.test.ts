import { describe, expect, test } from "bun:test";
import type { AgentSessionRecord } from "@openducktor/contracts";
import type { KanbanTaskSession } from "@/components/features/kanban/kanban-task-activity";
import {
  resolveHistoricalSessionRoles,
  resolvePreferredActiveSession,
  resolveSessionTargetOptions,
} from "./session-target-resolution";

describe("session-target-resolution", () => {
  test("returns historical roles in reverse-chronological unique order", () => {
    const historicalSessions: AgentSessionRecord[] = [
      {
        externalSessionId: "external-build-newer",
        role: "build",
        startedAt: "2026-03-21T10:00:00.000Z",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build",
        selectedModel: null,
      },
      {
        externalSessionId: "external-spec",
        role: "spec",
        startedAt: "2026-03-20T10:00:00.000Z",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/spec",
        selectedModel: null,
      },
      {
        externalSessionId: "external-build-older",
        role: "build",
        startedAt: "2026-03-19T10:00:00.000Z",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build-older",
        selectedModel: null,
      },
    ];

    expect(resolveHistoricalSessionRoles(historicalSessions)).toEqual(["build", "spec"]);
  });

  test("prefers newest active session when activity states are equally ranked", () => {
    const sessions: KanbanTaskSession[] = [
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build-older",
        externalSessionId: "build-older",
        role: "build",
        startedAt: "2026-03-20T10:00:00.000Z",
        activityState: "running",
      },
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build-newer",
        externalSessionId: "build-newer",
        role: "build",
        startedAt: "2026-03-21T10:00:00.000Z",
        activityState: "running",
      },
    ];

    expect(resolvePreferredActiveSession(sessions, "build")?.externalSessionId).toBe("build-newer");
  });

  test("uses the full session identity as deterministic tie-breaker", () => {
    const sessions: KanbanTaskSession[] = [
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/shared-a",
        externalSessionId: "build-shared",
        role: "build",
        startedAt: "2026-03-20T10:00:00.000Z",
        activityState: "running",
      },
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/shared-b",
        externalSessionId: "build-shared",
        role: "build",
        startedAt: "2026-03-20T10:00:00.000Z",
        activityState: "running",
      },
    ];

    expect(resolvePreferredActiveSession(sessions, "build")).toMatchObject({
      externalSessionId: "build-shared",
      workingDirectory: "/repo/worktrees/shared-b",
    });
  });

  test("prefers waiting-input session over running/starting sessions", () => {
    const sessions: KanbanTaskSession[] = [
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build-running",
        externalSessionId: "build-running",
        role: "build",
        startedAt: "2026-03-21T10:00:00.000Z",
        activityState: "running",
      },
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build-starting",
        externalSessionId: "build-starting",
        role: "build",
        startedAt: "2026-03-22T10:00:00.000Z",
        activityState: "starting",
      },
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build-waiting",
        externalSessionId: "build-waiting",
        role: "build",
        startedAt: "2026-03-20T10:00:00.000Z",
        activityState: "waiting_input",
      },
    ];

    expect(resolvePreferredActiveSession(sessions, "build")?.externalSessionId).toBe(
      "build-waiting",
    );
  });

  test("resolves parity options used by card and details actions", () => {
    const historicalSessions: AgentSessionRecord[] = [
      {
        externalSessionId: "external-spec-history",
        role: "spec",
        startedAt: "2026-03-20T10:00:00.000Z",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/spec",
        selectedModel: null,
      },
    ];
    const sessions: KanbanTaskSession[] = [
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/spec-active",
        externalSessionId: "spec-active",
        role: "spec",
        startedAt: "2026-03-21T10:00:00.000Z",
        activityState: "running",
      },
    ];

    const options = resolveSessionTargetOptions(historicalSessions, sessions, "spec");

    expect(options?.session).toMatchObject({
      externalSessionId: "spec-active",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/spec-active",
    });
  });

  test("keeps session target options identity-distinct when external ids repeat", () => {
    const sessions: KanbanTaskSession[] = [
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/shared-a",
        externalSessionId: "spec-shared",
        role: "spec",
        startedAt: "2026-03-21T10:00:00.000Z",
        activityState: "running",
      },
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/shared-b",
        externalSessionId: "spec-shared",
        role: "spec",
        startedAt: "2026-03-21T10:00:00.000Z",
        activityState: "running",
      },
    ];

    expect(resolveSessionTargetOptions([], sessions, "spec")?.session).toMatchObject({
      externalSessionId: "spec-shared",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/shared-b",
    });
  });

  test("falls back to historical options when no active session exists", () => {
    const historicalSessions: AgentSessionRecord[] = [
      {
        externalSessionId: "external-qa-history",
        role: "qa",
        startedAt: "2026-03-18T10:00:00.000Z",
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/qa",
        selectedModel: null,
      },
    ];

    expect(resolveSessionTargetOptions(historicalSessions, [], "qa")?.session).toMatchObject({
      externalSessionId: "external-qa-history",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/qa",
    });
  });
});
