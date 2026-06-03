import { describe, expect, test } from "bun:test";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { appendHydratedSubagentMessage } from "./hydrated-subagent-messages";

type SubagentMessage = AgentChatMessage & {
  role: "system";
  meta: Extract<NonNullable<AgentChatMessage["meta"]>, { kind: "subagent" }>;
};

const makeSubagentMessage = (
  input: Partial<SubagentMessage["meta"]> & {
    correlationKey: string;
    status: SubagentMessage["meta"]["status"];
  },
): SubagentMessage => {
  const meta: SubagentMessage["meta"] = {
    kind: "subagent",
    partId: input.partId ?? "subagent-part",
    correlationKey: input.correlationKey,
    status: input.status,
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.externalSessionId ? { externalSessionId: input.externalSessionId } : {}),
    ...(typeof input.startedAtMs === "number" ? { startedAtMs: input.startedAtMs } : {}),
    ...(typeof input.endedAtMs === "number" ? { endedAtMs: input.endedAtMs } : {}),
  };

  return {
    id: `subagent:${input.correlationKey}`,
    role: "system",
    content: input.description ?? "Subagent activity",
    timestamp: "2026-02-22T08:00:02.000Z",
    meta,
  };
};

describe("appendHydratedSubagentMessage", () => {
  test("merges an identified row into the earlier unidentified row", () => {
    const messages: AgentChatMessage[] = [
      makeSubagentMessage({
        correlationKey: "part:m1:p-subagent-running",
        status: "running",
        agent: "build",
        prompt: "Review changes",
        description: "Starting review",
        startedAtMs: 100,
      }),
    ];

    appendHydratedSubagentMessage(
      messages,
      makeSubagentMessage({
        correlationKey: "session:m1:session-child-1",
        status: "completed",
        agent: "build",
        prompt: "Review changes",
        description: "Review completed",
        externalSessionId: "session-child-1",
        endedAtMs: 300,
      }),
    );

    expect(messages).toHaveLength(1);
    const [subagent] = messages;
    expect(subagent?.meta?.kind).toBe("subagent");
    if (subagent?.meta?.kind !== "subagent") {
      throw new Error("Expected subagent metadata");
    }
    expect(subagent.id).toBe("subagent:session:m1:session-child-1");
    expect(subagent.meta.correlationKey).toBe("session:m1:session-child-1");
    expect(subagent.meta.externalSessionId).toBe("session-child-1");
    expect(subagent.meta.status).toBe("completed");
  });

  test("ignores a later unidentified duplicate once an identified row exists", () => {
    const messages: AgentChatMessage[] = [
      makeSubagentMessage({
        correlationKey: "session:m1:session-child-1",
        status: "completed",
        agent: "build",
        prompt: "Review changes",
        description: "Review completed",
        externalSessionId: "session-child-1",
      }),
    ];

    appendHydratedSubagentMessage(
      messages,
      makeSubagentMessage({
        correlationKey: "part:m1:p-subagent-running",
        status: "running",
        agent: "build",
        prompt: "Review changes",
        description: "Starting review",
      }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.meta?.kind).toBe("subagent");
    if (messages[0]?.meta?.kind !== "subagent") {
      throw new Error("Expected subagent metadata");
    }
    expect(messages[0].meta.correlationKey).toBe("session:m1:session-child-1");
    expect(messages[0].meta.externalSessionId).toBe("session-child-1");
    expect(messages[0].meta.status).toBe("completed");
  });
});
