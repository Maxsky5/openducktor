import { describe, expect, test } from "bun:test";
import type { KanbanTaskSession } from "@/components/features/kanban/kanban-task-activity";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import {
  resolveHistoricalSessionRoles,
  resolvePreferredActiveSession,
  resolveSessionTargetOptions,
} from "./session-target-resolution";

describe("session-target-resolution", () => {
  test("returns historical roles in reverse-chronological unique order", () => {
    const task = createTaskCardFixture({
      id: "TASK-1",
      agentSessions: [
        {
          sessionId: "build-newer",
          externalSessionId: "external-build-newer",
          role: "build",
          scenario: "build_implementation_start",
          startedAt: "2026-03-21T10:00:00.000Z",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktrees/build",
          selectedModel: null,
        },
        {
          sessionId: "spec",
          externalSessionId: "external-spec",
          role: "spec",
          scenario: "spec_initial",
          startedAt: "2026-03-20T10:00:00.000Z",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktrees/spec",
          selectedModel: null,
        },
        {
          sessionId: "build-older",
          externalSessionId: "external-build-older",
          role: "build",
          scenario: "build_after_qa_rejected",
          startedAt: "2026-03-19T10:00:00.000Z",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktrees/build-older",
          selectedModel: null,
        },
      ],
    });

    expect(resolveHistoricalSessionRoles(task)).toEqual(["build", "spec"]);
  });

  test("prefers newest active session when statuses are equally ranked", () => {
    const sessions: KanbanTaskSession[] = [
      {
        runtimeKind: "opencode",
        sessionId: "build-older",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
        startedAt: "2026-03-20T10:00:00.000Z",
        presentationState: "active",
      },
      {
        runtimeKind: "opencode",
        sessionId: "build-newer",
        role: "build",
        scenario: "build_after_human_request_changes",
        status: "running",
        startedAt: "2026-03-21T10:00:00.000Z",
        presentationState: "active",
      },
    ];

    expect(resolvePreferredActiveSession(sessions, "build")?.sessionId).toBe("build-newer");
  });

  test("prefers waiting-input session over running/starting sessions", () => {
    const sessions: KanbanTaskSession[] = [
      {
        runtimeKind: "opencode",
        sessionId: "build-running",
        role: "build",
        scenario: "build_implementation_start",
        status: "running",
        startedAt: "2026-03-21T10:00:00.000Z",
        presentationState: "active",
      },
      {
        runtimeKind: "opencode",
        sessionId: "build-waiting",
        role: "build",
        scenario: "build_implementation_start",
        status: "idle",
        startedAt: "2026-03-20T10:00:00.000Z",
        presentationState: "waiting_input",
      },
    ];

    expect(resolvePreferredActiveSession(sessions, "build")?.sessionId).toBe("build-waiting");
  });

  test("resolves parity options used by card and details actions", () => {
    const task = createTaskCardFixture({
      id: "TASK-2",
      agentSessions: [
        {
          sessionId: "spec-history",
          externalSessionId: "external-spec-history",
          role: "spec",
          scenario: "spec_initial",
          startedAt: "2026-03-20T10:00:00.000Z",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktrees/spec",
          selectedModel: null,
        },
      ],
    });
    const sessions: KanbanTaskSession[] = [
      {
        runtimeKind: "opencode",
        sessionId: "spec-active",
        role: "spec",
        scenario: "spec_initial",
        status: "running",
        startedAt: "2026-03-21T10:00:00.000Z",
        presentationState: "active",
      },
    ];

    const options = resolveSessionTargetOptions(task, sessions, "spec");

    expect(options).toEqual({
      sessionId: "spec-active",
      scenario: "spec_initial",
    });
  });

  test("falls back to historical options when no active session exists", () => {
    const task = createTaskCardFixture({
      id: "TASK-3",
      agentSessions: [
        {
          sessionId: "qa-history",
          externalSessionId: "external-qa-history",
          role: "qa",
          scenario: "qa_review",
          startedAt: "2026-03-18T10:00:00.000Z",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktrees/qa",
          selectedModel: null,
        },
      ],
    });

    expect(resolveSessionTargetOptions(task, [], "qa")).toEqual({
      sessionId: "qa-history",
      scenario: "qa_review",
    });
  });
});
