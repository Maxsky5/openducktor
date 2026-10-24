import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { decideClaudePersistedContinuation } from "./claude-agent-sdk-continuation";
import { loadClaudeHistory } from "./claude-agent-sdk-history-loader";
import type { ClaudeProtocolObject } from "./claude-agent-sdk-ingress-schemas";

const sessionId = "00000000-0000-4000-8000-000000000001";
const startedAt = "2026-10-21T18:21:10.235Z";
const finishedAt = "2026-10-21T18:21:27.097Z";

test.each([
  { origin: "peer", isMeta: true, absorbed: true, users: 1 },
  { origin: "peer", isMeta: true, absorbed: false, users: 1 },
  { origin: "human", isMeta: false, absorbed: true, users: 2 },
  { origin: "observer", isMeta: false, absorbed: true, users: 1 },
])(
  "preserves the completed reply after queued $origin input, absorbed $absorbed",
  async ({ origin, isMeta, absorbed, users }) => {
    const root = await mkdtemp(join(tmpdir(), "claude-absorbed-history-"));
    try {
      const cwd = await realpath(root);
      const config = join(cwd, "config");
      const project = join(config, "projects", "native-project");
      await mkdir(project, { recursive: true });
      const base = { sessionId, cwd, isSidechain: false };
      const rows: ClaudeProtocolObject[] = [
        {
          ...base,
          type: "user",
          uuid: "root-user",
          parentUuid: null,
          timestamp: startedAt,
          message: {
            role: "user",
            content: "Wait for the foreground child, then reply ROOT_DONE.",
          },
        },
        {
          ...base,
          type: "assistant",
          uuid: "agent-call",
          parentUuid: "root-user",
          timestamp: "2026-10-21T18:21:12.777Z",
          message: {
            id: "tool-response",
            model: "claude-haiku-5-5",
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "agent",
                name: "Agent",
                input: {
                  description: "Child check",
                  subagent_type: "general-purpose",
                  prompt: "Reply CHILD_DONE.",
                  run_in_background: false,
                },
              },
            ],
            stop_reason: "tool_use",
          },
        },
        {
          ...base,
          type: "user",
          uuid: "agent-result",
          parentUuid: "agent-call",
          timestamp: "2026-10-21T18:21:25.735Z",
          toolUseResult: {
            status: "completed",
            agentId: "child",
            agentType: "general-purpose",
            handback: true,
            handbackReport: "CHILD_DONE",
            resolvedModel: "claude-haiku-5-5",
            totalDurationMs: 7970,
          },
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "agent",
                content: "The child report was delivered.",
              },
            ],
          },
        },
        {
          ...base,
          type: "attachment",
          uuid: "queued-attachment",
          parentUuid: "agent-result",
          timestamp: "2026-10-21T18:21:25.683Z",
          attachment: {
            type: "queued_command",
            prompt: "CHILD_DONE",
            source_uuid: "queued-source",
            delivery_id: "delivery",
            commandMode: "prompt",
            origin: { kind: origin, from: "child", handback: true },
            isMeta,
          },
        },
      ];
      if (absorbed) {
        rows.push({
          type: "queue-operation",
          operation: "remove",
          reason: "absorbed_mid_turn",
          commandUuid: "queued-source",
          deliveryId: "delivery",
          timestamp: "2026-10-21T18:21:25.757Z",
          sessionId,
        });
      }
      rows.push({
        ...base,
        type: "assistant",
        uuid: "root-final",
        parentUuid: "queued-attachment",
        timestamp: finishedAt,
        effort: "low",
        perTurnEffort: "low",
        message: {
          id: "final-response",
          model: "claude-haiku-5-5",
          role: "assistant",
          content: [{ type: "text", text: "ROOT_DONE" }],
          stop_reason: "end_turn",
        },
      });
      await writeFile(
        join(project, `${sessionId}.jsonl`),
        `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      );
      const history = await Effect.runPromise(
        loadClaudeHistory(
          {
            repoPath: cwd,
            workingDirectory: cwd,
            externalSessionId: sessionId,
            runtimeKind: "claude",
            runtimePolicy: { kind: "claude" },
          },
          () => finishedAt,
          undefined,
          { processEnv: { CLAUDE_CONFIG_DIR: config } },
        ),
      );
      const reply = history.at(-1);
      expect(reply).toMatchObject({
        messageId: "final-response",
        text: "ROOT_DONE",
        timestamp: finishedAt,
      });
      expect(
        reply?.parts.some(
          (part) => part.kind === "step" && part.phase === "finish" && part.reason === "stop",
        ),
      ).toBe(true);
      expect(history.filter((message) => message.role === "user")).toHaveLength(users);
      expect(history.flatMap((message) => message.parts)).toContainEqual(
        expect.objectContaining({
          kind: "subagent",
          status: "completed",
          metadata: expect.objectContaining({ totalDurationMs: 7970 }),
        }),
      );
      const continuation = decideClaudePersistedContinuation(history, sessionId);
      expect(reply).toMatchObject({
        model: { providerId: "claude", modelId: "claude-haiku-5-5", variant: "low" },
      });
      expect(continuation).toMatchObject({ kind: "reject", error: { reason: "completed_turn" } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
