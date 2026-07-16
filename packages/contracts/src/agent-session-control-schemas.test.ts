import { describe, expect, test } from "bun:test";
import {
  acceptedAgentUserMessageSchema,
  agentSessionControlForkInputSchema,
  agentSessionControlResumeInputSchema,
  agentSessionControlSendInputSchema,
  agentSessionControlStartInputSchema,
} from "./agent-session-control-schemas";

const workflowScope = { kind: "workflow" as const, taskId: "task-1", role: "build" as const };

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
