import { describe, expect, test } from "bun:test";
import {
  createClaudeSessionSummary,
  snapshotForClaudeSession,
  toClaudeDisplayParts,
} from "./claude-agent-sdk-session-shape";
import { emptyClaudeQuery } from "./claude-agent-sdk-session-io.test-support";
import { createClaudePermissionTestSession } from "./claude-agent-sdk-permissions.test-support";
import type { ClaudeSession } from "./claude-agent-sdk-types";
import { claudeSubagentEventSession } from "./claude-agent-sdk-event-session";

const createSession = (overrides: Partial<ClaudeSession> = {}): ClaudeSession => ({
  ...createClaudePermissionTestSession("build"),
  activity: "running",
  input: {
    repoPath: "/repo",
    runtimeKind: "claude",
    workingDirectory: "/repo/worktree",
    runtimePolicy: { kind: "claude" },
    sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    systemPrompt: "Build",
  },
  query: emptyClaudeQuery(),
  summary: {
    externalSessionId: "session-1",
    runtimeKind: "claude",
    workingDirectory: "/repo/worktree",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
    startedAt: "2026-06-25T20:00:00.000Z",
    status: "idle",
  },
  ...overrides,
});

describe("createClaudeSessionSummary", () => {
  test("preserves repository scope without a fake task or role", () => {
    expect(
      createClaudeSessionSummary(
        {
          repoPath: "/repo",
          runtimeKind: "claude",
          workingDirectory: "/repo",
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "repository" },
          systemPrompt: "Help with this repository",
        },
        { externalSessionId: "session-repository", title: "Repository session" },
        "2026-06-25T20:00:00.000Z",
      ),
    ).toEqual({
      externalSessionId: "session-repository",
      runtimeKind: "claude",
      workingDirectory: "/repo",
      title: "Repository session",
      sessionAssociation: { kind: "repository" },
      startedAt: "2026-06-25T20:00:00.000Z",
      status: "starting",
    });
  });
});

describe("snapshotForClaudeSession", () => {
  test("classifies verified child input without exposing the child's reply handle on the parent", () => {
    const session = createSession({
      foregroundTurnActive: false,
      sdkState: "idle",
      activity: "idle",
    });
    session.subagentTaskIdsByToolUseId.set("agent-tool", "child");
    const child = claudeSubagentEventSession(session, "agent-tool");
    if (!child) throw new Error("Expected the verified child session.");
    child.pendingApprovals = new Map([
      [
        "child-approval",
        {
          event: {
            type: "approval_required",
            externalSessionId: child.externalSessionId,
            timestamp: "2026-10-23T19:00:00.000Z",
            requestId: "child-approval",
            requestType: "runtime_tool",
            title: "Approve build",
            tool: { name: "Bash", input: {} },
            mutation: "unknown",
          },
          resolve: () => {},
        },
      ],
    ]);
    const waiting = snapshotForClaudeSession(session);
    expect(waiting).toMatchObject({
      availability: "runtime",
      classification: "waiting_for_permission",
      foregroundTurnActive: false,
      pendingApprovals: [],
    });
    child.pendingApprovals.clear();
    expect(snapshotForClaudeSession(session)).toMatchObject({
      classification: "idle",
      foregroundTurnActive: false,
    });
  });

  test("uses authoritative SDK idle state when no local turn remains pending", () => {
    const snapshot = snapshotForClaudeSession(
      createSession({
        activity: "running",
        sdkState: "idle",
      }),
    );

    expect(snapshot).toEqual(
      expect.objectContaining({
        availability: "runtime",
        classification: "idle",
      }),
    );
  });

  test("keeps sessions running while an SDK idle event belongs to a pending local turn", () => {
    const snapshot = snapshotForClaudeSession(
      createSession({
        activity: "running",
        pendingUserTurnCount: 1,
        sdkState: "idle",
      }),
    );

    expect(snapshot).toEqual(
      expect.objectContaining({
        availability: "runtime",
        classification: "running",
      }),
    );
  });
});

describe("toClaudeDisplayParts", () => {
  test("preserves non-skill slash commands as visible text", () => {
    expect(
      toClaudeDisplayParts([
        {
          kind: "slash_command",
          command: {
            id: "review",
            trigger: "review",
            title: "review",
            source: "command",
            hints: [],
          },
        },
        { kind: "text", text: " focus on auth" },
      ]),
    ).toEqual([
      { kind: "text", text: "/review" },
      { kind: "text", text: " focus on auth" },
    ]);
  });

  test("projects Claude skill commands as source-mapped skill chips", () => {
    expect(
      toClaudeDisplayParts([
        {
          kind: "slash_command",
          command: {
            id: "grill-me",
            trigger: "grill-me",
            title: "grill-me",
            description: "Grill a plan",
            source: "skill",
            hints: [],
          },
        },
      ]),
    ).toEqual([
      {
        kind: "skill_mention",
        skill: {
          id: "grill-me",
          name: "grill-me",
          path: "grill-me",
          title: "grill-me",
          description: "Grill a plan",
        },
        sourceText: {
          value: "/grill-me",
          start: 0,
          end: 9,
        },
      },
    ]);
  });

  test("offsets source-mapped references across attachment-separated text blocks", () => {
    expect(
      toClaudeDisplayParts([
        { kind: "text", text: "Before" },
        {
          kind: "attachment",
          attachment: {
            id: "attachment-1",
            kind: "pdf",
            mime: "application/pdf",
            name: "context.pdf",
            path: "/repo/context.pdf",
          },
        },
        {
          kind: "file_reference",
          file: {
            id: "src/after.ts",
            kind: "code",
            name: "after.ts",
            path: "src/after.ts",
          },
        },
      ]),
    ).toEqual([
      { kind: "text", text: "Before" },
      {
        kind: "attachment",
        attachment: {
          id: "attachment-1",
          kind: "pdf",
          mime: "application/pdf",
          name: "context.pdf",
          path: "/repo/context.pdf",
        },
      },
      { kind: "text", text: "\n" },
      {
        kind: "file_reference",
        file: {
          id: "src/after.ts",
          kind: "code",
          name: "after.ts",
          path: "src/after.ts",
        },
        sourceText: {
          value: "@src/after.ts",
          start: 7,
          end: 20,
        },
      },
    ]);
  });

  test("preserves the canonical separator between attachment-delimited text blocks", () => {
    expect(
      toClaudeDisplayParts([
        { kind: "text", text: "Before" },
        {
          kind: "attachment",
          attachment: {
            id: "attachment-1",
            kind: "pdf",
            mime: "application/pdf",
            name: "context.pdf",
            path: "/repo/context.pdf",
          },
        },
        { kind: "text", text: "After" },
      ]),
    ).toEqual([
      { kind: "text", text: "Before" },
      {
        kind: "attachment",
        attachment: {
          id: "attachment-1",
          kind: "pdf",
          mime: "application/pdf",
          name: "context.pdf",
          path: "/repo/context.pdf",
        },
      },
      { kind: "text", text: "\n" },
      { kind: "text", text: "After" },
    ]);
  });
});
