import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { historyToChatMessages } from "./persistence";

type History = Parameters<typeof historyToChatMessages>[0];
type SubagentMessage = AgentChatMessage & {
  role: "system";
  meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "subagent" }>;
};

const hydrate = (history: History): AgentChatMessage[] =>
  historyToChatMessages(history, {
    role: "build",
    selectedModel: null,
  });

const readSubagentMessages = (messages: AgentChatMessage[]): SubagentMessage[] =>
  messages.filter(
    (entry): entry is SubagentMessage => entry.role === "system" && entry.meta?.kind === "subagent",
  );

const expectSingleSubagent = (messages: AgentChatMessage[]): SubagentMessage => {
  const subagents = readSubagentMessages(messages);
  expect(subagents).toHaveLength(1);
  const [subagent] = subagents;
  if (!subagent) {
    throw new Error("Expected subagent message");
  }
  return subagent;
};

describe("agent-orchestrator/support/persistence subagents", () => {
  test("merges hydrated subagent history parts that share a correlation key", () => {
    const subagent = expectSingleSubagent(
      hydrate([
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-running",
              correlationKey: "spawn:m-assistant:build:Do work",
              status: "running",
              agent: "build",
              prompt: "Do work",
              description: "Starting work",
              startedAtMs: 100,
            },
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-completed",
              correlationKey: "spawn:m-assistant:build:Do work",
              status: "completed",
              agent: "build",
              prompt: "Do work",
              description: "Finished work",
              externalSessionId: "session-child-1",
              startedAtMs: 120,
              endedAtMs: 300,
            },
          ],
        },
      ]),
    );

    expect(subagent.id).toBe("subagent:spawn:m-assistant:build:Do work");
    expect(subagent.meta.correlationKey).toBe("spawn:m-assistant:build:Do work");
    expect(subagent.meta.status).toBe("completed");
    expect(subagent.meta.externalSessionId).toBe("session-child-1");
    expect(subagent.meta.startedAtMs).toBe(100);
    expect(subagent.meta.endedAtMs).toBe(300);
    expect(subagent.content).toContain("Finished work");
  });

  test("preserves cancelled hydrated subagent history parts", () => {
    const subagent = expectSingleSubagent(
      hydrate([
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-running",
              correlationKey: "spawn:m-assistant:build:Do work",
              status: "running",
              agent: "build",
              prompt: "Do work",
              description: "Starting work",
              startedAtMs: 100,
            },
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-cancelled",
              correlationKey: "spawn:m-assistant:build:Do work",
              status: "cancelled",
              agent: "build",
              prompt: "Do work",
              description: "Cancelled by user",
              externalSessionId: "session-child-1",
              startedAtMs: 120,
              endedAtMs: 300,
            },
          ],
        },
      ]),
    );

    expect(subagent.id).toBe("subagent:spawn:m-assistant:build:Do work");
    expect(subagent.meta.status).toBe("cancelled");
    expect(subagent.meta.externalSessionId).toBe("session-child-1");
    expect(subagent.meta.startedAtMs).toBe(100);
    expect(subagent.meta.endedAtMs).toBe(300);
    expect(subagent.content).toContain("Cancelled by user");
  });

  test("preserves hydrated subagent error details", () => {
    const subagent = expectSingleSubagent(
      hydrate([
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-error",
              correlationKey: "spawn:m-assistant:explorer:Read the file at ~/maxsky5.omp.json",
              status: "error",
              agent: "explorer",
              prompt: "Read the file at ~/maxsky5.omp.json",
              description: "Read the file at ~/maxsky5.omp.json",
              error: "Timed out after 5m while waiting for permission.",
              startedAtMs: 100,
              endedAtMs: 300_100,
            },
          ],
        },
      ]),
    );

    expect(subagent.meta.status).toBe("error");
    expect(subagent.meta.error).toBe("Timed out after 5m while waiting for permission.");
    expect(subagent.meta.endedAtMs).toBe(300_100);
    expect(subagent.content).toContain("Read the file at ~/maxsky5.omp.json");
  });

  test("preserves unresolved hydrated subagent history rows when no child session link exists", () => {
    const messages = hydrate([
      {
        messageId: "m-assistant",
        role: "assistant",
        timestamp: "2026-02-22T08:00:02.000Z",
        text: "The subtask timed out. Let me try directly reading the file.",
        parts: [
          {
            kind: "subagent",
            messageId: "m-assistant",
            partId: "p-subagent-running",
            correlationKey: "part:m-assistant:p-subagent-running",
            status: "running",
            agent: "explorer",
            prompt: "Read the file at ~/maxsky5.omp.json",
            description: "Read the file at ~/maxsky5.omp.json",
            startedAtMs: 100,
          },
          {
            kind: "step",
            messageId: "m-assistant",
            partId: "p-step-finish",
            phase: "finish",
            reason: "stop",
          },
        ],
      },
    ]);
    const subagent = expectSingleSubagent(messages);
    const subagentIndex = messages.indexOf(subagent);
    const assistantIndex = messages.findIndex(
      (entry) =>
        entry.role === "assistant" &&
        entry.content === "The subtask timed out. Let me try directly reading the file.",
    );

    expect(subagentIndex).toBeLessThan(assistantIndex);
    expect(subagent.meta.status).toBe("running");
    expect(subagent.meta.externalSessionId).toBeUndefined();
    expect(subagent.meta.correlationKey).toBe("part:m-assistant:p-subagent-running");
    expect(subagent.content).toContain("Read the file at ~/maxsky5.omp.json");
  });

  test("preserves repeated same-prompt subagent rows from separate history turns", () => {
    const subagents = readSubagentMessages(
      hydrate([
        {
          messageId: "m-assistant-first",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant-first",
              partId: "p-subagent-completed",
              correlationKey: "session:m-assistant-first:session-child-1",
              status: "completed",
              agent: "explorer",
              prompt: "Read the file at ~/maxsky5.omp.json",
              description: "Read completed",
              externalSessionId: "session-child-1",
              startedAtMs: 100,
              endedAtMs: 300,
            },
          ],
        },
        {
          messageId: "m-assistant-second",
          role: "assistant",
          timestamp: "2026-02-22T08:00:12.000Z",
          text: "The subtask timed out. Let me try directly reading the file.",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant-second",
              partId: "p-subagent-running",
              correlationKey: "part:m-assistant-second:p-subagent-running",
              status: "running",
              agent: "explorer",
              prompt: "Read the file at ~/maxsky5.omp.json",
              description: "Read the file at ~/maxsky5.omp.json",
              startedAtMs: 400,
            },
          ],
        },
      ]),
    );

    expect(subagents).toHaveLength(2);
    expect(subagents.map((entry) => entry.meta.correlationKey)).toEqual([
      "session:m-assistant-first:session-child-1",
      "part:m-assistant-second:p-subagent-running",
    ]);
  });

  test("surfaces only the identified hydrated subagent history part when part and session correlation keys differ", () => {
    const subagent = expectSingleSubagent(
      hydrate([
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-running",
              correlationKey: "part:m-assistant:p-subagent-running",
              status: "running",
              agent: "build",
              prompt: "Review changes",
              description: "Review changes [commit|branch|pr]",
              startedAtMs: 100,
            },
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-completed",
              correlationKey: "session:m-assistant:session-child-1",
              status: "completed",
              agent: "build",
              prompt: "Review changes",
              description: "Review completed",
              externalSessionId: "session-child-1",
              startedAtMs: 120,
              endedAtMs: 300,
            },
          ],
        },
      ]),
    );

    expect(subagent.id).toBe("subagent:session:m-assistant:session-child-1");
    expect(subagent.meta.correlationKey).toBe("session:m-assistant:session-child-1");
    expect(subagent.meta.status).toBe("completed");
    expect(subagent.meta.externalSessionId).toBe("session-child-1");
  });

  test("ignores later unidentified hydrated subagent history rows when an identified row already exists", () => {
    const subagent = expectSingleSubagent(
      hydrate([
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-completed",
              correlationKey: "session:m-assistant:session-child-1",
              status: "completed",
              agent: "build",
              prompt: "Review changes",
              description: "Review completed",
              externalSessionId: "session-child-1",
              startedAtMs: 120,
              endedAtMs: 300,
            },
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-running",
              correlationKey: "part:m-assistant:p-subagent-running",
              status: "running",
              agent: "build",
              prompt: "Review changes",
              description: "Review changes [commit|branch|pr]",
              startedAtMs: 100,
            },
          ],
        },
      ]),
    );

    expect(subagent.id).toBe("subagent:session:m-assistant:session-child-1");
    expect(subagent.meta.correlationKey).toBe("session:m-assistant:session-child-1");
    expect(subagent.meta.status).toBe("completed");
    expect(subagent.meta.externalSessionId).toBe("session-child-1");
  });

  test("ignores ambiguous same-prompt hydrated subagent history rows without session ids", () => {
    const subagent = expectSingleSubagent(
      hydrate([
        {
          messageId: "m-assistant",
          role: "assistant",
          timestamp: "2026-02-22T08:00:02.000Z",
          text: "",
          parts: [
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-running",
              correlationKey: "part:m-assistant:p-subagent-running",
              status: "running",
              agent: "build",
              prompt: "Review changes",
              description: "Review changes [commit|branch|pr]",
              startedAtMs: 100,
            },
            {
              kind: "subagent",
              messageId: "m-assistant",
              partId: "p-subagent-completed",
              correlationKey: "session:m-assistant:session-child-1",
              status: "completed",
              agent: "build",
              prompt: "Review changes",
              description: "Review completed",
              externalSessionId: "session-child-1",
              startedAtMs: 120,
              endedAtMs: 300,
            },
          ],
        },
      ]),
    );

    expect(subagent.id).toBe("subagent:session:m-assistant:session-child-1");
    expect(subagent.meta.correlationKey).toBe("session:m-assistant:session-child-1");
    expect(subagent.meta.status).toBe("completed");
    expect(subagent.meta.externalSessionId).toBe("session-child-1");
  });
});
