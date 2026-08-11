import { describe, expect, test } from "bun:test";
import {
  acceptedAgentUserMessageSchema,
  agentSessionControlForkInputSchema,
  agentSessionControlResumeInputSchema,
  agentSessionControlSendInputSchema,
  agentSessionControlStartInputSchema,
  agentSessionControlSummarySchema,
} from "./agent-session-control-schemas";

const workflowScope = { kind: "workflow" as const, taskId: "task-1", role: "build" as const };
const repositoryScope = { kind: "repository" as const };

describe("agent session control contracts", () => {
  test("parses a strict normalized start command", () => {
    expect(
      agentSessionControlStartInputSchema.parse({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/task",
        sessionScope: workflowScope,
        systemPrompt: "Build the feature",
      }),
    ).toMatchObject({ runtimeKind: "codex", workingDirectory: "/repo/task" });
  });

  test("rejects runtime-native routing fields", () => {
    expect(() =>
      agentSessionControlStartInputSchema.parse({
        repoPath: "/repo",
        runtimeKind: "codex",
        runtimeId: "runtime-native",
        workingDirectory: "/repo/task",
        sessionScope: workflowScope,
        systemPrompt: "Build the feature",
      }),
    ).toThrow();
  });

  test("rejects runtime-specific policy bindings from every normalized control", () => {
    const ref = {
      repoPath: "/repo",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/task",
      externalSessionId: "session-1",
      sessionScope: workflowScope,
    };
    const controls = [
      {
        schema: agentSessionControlStartInputSchema,
        input: {
          repoPath: ref.repoPath,
          runtimeKind: ref.runtimeKind,
          workingDirectory: ref.workingDirectory,
          runtimePolicy: { kind: "codex" },
          sessionScope: workflowScope,
          systemPrompt: "Build the feature",
        },
      },
      {
        schema: agentSessionControlResumeInputSchema,
        input: { ...ref, runtimePolicy: { kind: "codex" } },
      },
      {
        schema: agentSessionControlForkInputSchema,
        input: {
          repoPath: ref.repoPath,
          runtimeKind: ref.runtimeKind,
          workingDirectory: ref.workingDirectory,
          runtimePolicy: { kind: "codex" },
          sessionScope: workflowScope,
          systemPrompt: "Build the feature",
          parentExternalSessionId: "parent-1",
        },
      },
      {
        schema: agentSessionControlSendInputSchema,
        input: {
          ...ref,
          runtimePolicy: { kind: "codex" },
          parts: [{ kind: "text", text: "hello" }],
        },
      },
    ];

    for (const { schema, input } of controls) {
      expect(schema.safeParse(input).success).toBe(false);
    }
  });

  test("requires workflow scope when resuming or sending to an existing session", () => {
    const ref = {
      repoPath: "/repo",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/task",
      externalSessionId: "session-1",
    };

    expect(() => agentSessionControlResumeInputSchema.parse(ref)).toThrow();
    expect(() =>
      agentSessionControlSendInputSchema.parse({
        ...ref,
        parts: [{ kind: "text", text: "hello" }],
      }),
    ).toThrow();
  });

  test("accepts normalized resume and send controls with workflow scope", () => {
    const ref = {
      repoPath: "/repo",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/task",
      externalSessionId: "session-1",
      sessionScope: workflowScope,
    };

    expect(agentSessionControlResumeInputSchema.parse(ref)).toEqual(ref);
    expect(
      agentSessionControlSendInputSchema.parse({
        ...ref,
        parts: [{ kind: "text", text: "hello" }],
      }),
    ).toMatchObject(ref);
  });

  test("rejects send controls that combine a slash command with an attachment", () => {
    const ref = {
      repoPath: "/repo",
      runtimeKind: "claude" as const,
      workingDirectory: "/repo/task",
      externalSessionId: "session-1",
      sessionScope: workflowScope,
    };
    const slashCommand = {
      kind: "slash_command" as const,
      command: {
        id: "system:compact",
        trigger: "compact",
        title: "Compact session",
        source: "system" as const,
        hints: [],
      },
    };
    const attachment = {
      kind: "attachment" as const,
      attachment: {
        id: "attachment-1",
        path: "brief.pdf",
        name: "brief.pdf",
        kind: "pdf" as const,
        mime: "application/pdf",
      },
    };

    expect(
      agentSessionControlSendInputSchema.safeParse({ ...ref, parts: [slashCommand] }).success,
    ).toBe(true);
    expect(
      agentSessionControlSendInputSchema.safeParse({ ...ref, parts: [attachment] }).success,
    ).toBe(true);
    expect(
      agentSessionControlSendInputSchema.safeParse({
        ...ref,
        parts: [slashCommand, attachment],
      }).success,
    ).toBe(false);
  });

  test("accepts repository scope for every normalized scoped control", () => {
    const ref = {
      repoPath: "/repo",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo",
      externalSessionId: "session-1",
      sessionScope: repositoryScope,
    };

    expect(
      agentSessionControlStartInputSchema.parse({
        repoPath: ref.repoPath,
        runtimeKind: ref.runtimeKind,
        workingDirectory: ref.workingDirectory,
        sessionScope: repositoryScope,
        systemPrompt: "Repository chat",
      }),
    ).toMatchObject({ sessionScope: repositoryScope });
    expect(agentSessionControlResumeInputSchema.parse(ref)).toEqual(ref);
    expect(
      agentSessionControlForkInputSchema.parse({
        repoPath: ref.repoPath,
        runtimeKind: ref.runtimeKind,
        workingDirectory: ref.workingDirectory,
        sessionScope: repositoryScope,
        systemPrompt: "Repository chat",
        parentExternalSessionId: "parent-1",
      }),
    ).toMatchObject({ sessionScope: repositoryScope });
    expect(
      agentSessionControlSendInputSchema.parse({
        ...ref,
        parts: [{ kind: "text", text: "hello" }],
      }),
    ).toMatchObject({ sessionScope: repositoryScope });
  });

  test("rejects unbound scope from startable controls", () => {
    expect(
      agentSessionControlStartInputSchema.safeParse({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        sessionScope: { kind: "unbound" },
        systemPrompt: "Repository chat",
      }).success,
    ).toBe(false);
  });

  test("carries explicit association instead of a nullable role in control summaries", () => {
    const summary = {
      externalSessionId: "session-1",
      runtimeKind: "codex",
      workingDirectory: "/repo",
      sessionAssociation: workflowScope,
      startedAt: "2026-07-16T10:00:00.000Z",
      status: "idle",
    } as const;

    expect(agentSessionControlSummarySchema.parse(summary)).toEqual(summary);
    expect(
      agentSessionControlSummarySchema.safeParse({
        ...summary,
        role: "build",
      }).success,
    ).toBe(false);
  });

  test("rejects missing workflow scope at the command boundary", () => {
    expect(() =>
      agentSessionControlStartInputSchema.parse({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo/task",
        systemPrompt: "Build the feature",
      }),
    ).toThrow();
  });

  test("rejects native user-message payloads", () => {
    expect(() =>
      agentSessionControlSendInputSchema.parse({
        repoPath: "/repo",
        runtimeKind: "opencode",
        workingDirectory: "/repo/task",
        externalSessionId: "session-1",
        sessionScope: workflowScope,
        parts: [{ kind: "text", text: "hello", nativePayload: { id: 1 } }],
      }),
    ).toThrow();
  });

  test("accepts only normalized user-message events as send results", () => {
    expect(() =>
      acceptedAgentUserMessageSchema.parse({
        type: "session_idle",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
