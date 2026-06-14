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

  test("prefers newest active session when statuses are equally ranked", () => {
    const sessions: KanbanTaskSession[] = [
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build-older",
        externalSessionId: "build-older",
        role: "build",
        status: "running",
        startedAt: "2026-03-20T10:00:00.000Z",
        presentationState: "active",
      },
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build-newer",
        externalSessionId: "build-newer",
        role: "build",
        status: "running",
        startedAt: "2026-03-21T10:00:00.000Z",
        presentationState: "active",
      },
    ];

    expect(resolvePreferredActiveSession(sessions, "build")?.externalSessionId).toBe("build-newer");
  });

  test("prefers waiting-input session over running/starting sessions", () => {
    const sessions: KanbanTaskSession[] = [
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build-running",
        externalSessionId: "build-running",
        role: "build",
        status: "running",
        startedAt: "2026-03-21T10:00:00.000Z",
        presentationState: "active",
      },
      {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktrees/build-waiting",
        externalSessionId: "build-waiting",
        role: "build",
        status: "idle",
        startedAt: "2026-03-20T10:00:00.000Z",
        presentationState: "waiting_input",
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
        status: "running",
        startedAt: "2026-03-21T10:00:00.000Z",
        presentationState: "active",
      },
    ];

    const options = resolveSessionTargetOptions(historicalSessions, sessions, "spec");

    expect(options?.session).toMatchObject({
      externalSessionId: "spec-active",
      runtimeKind: "opencode",
      workingDirectory: "/repo/worktrees/spec-active",
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
