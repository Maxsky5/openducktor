import { describe, expect, test } from "bun:test";
import { MANUAL_SESSION_COMPACTION_SLASH_COMMAND } from "@openducktor/contracts";
import {
  codexSessionRuntimeRef,
  codexUserMessageInput,
  createAdapterWithTransport,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";
import type { CodexJsonRpcRequest, CodexJsonRpcTransport } from "./types";

const compactPart = () => ({
  kind: "slash_command" as const,
  command: MANUAL_SESSION_COMPACTION_SLASH_COMMAND,
});

describe("CodexAppServerAdapter manual compaction", () => {
  test("sends exactly one native compact request and no turn request", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const transport: CodexJsonRpcTransport = {
      async request(request) {
        calls.push(request);
        if (request.method === "thread/resume") {
          throw new Error("Unexpected method 'thread/resume'.");
        }
        if (request.method === "thread/compact/start") {
          return {};
        }
        if (request.method === "turn/start") {
          return { turn: { id: "turn-follow-up" } };
        }
        if (request.method === "model/list") {
          return {
            data: [
              {
                id: "gpt-5",
                model: "gpt-5",
                displayName: "GPT-5",
                description: "GPT-5 model",
                hidden: false,
                supportedReasoningEfforts: [
                  { reasoningEffort: "medium", description: "Balanced reasoning" },
                ],
                defaultReasoningEffort: {
                  reasoningEffort: "medium",
                  description: "Balanced reasoning",
                },
                inputModalities: ["text"],
                supportsPersonality: true,
                isDefault: true,
              },
            ],
            nextCursor: null,
          };
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      },
    };
    const adapter = createAdapterWithTransport(transport);

    const accepted = await adapter.sendUserMessage(
      codexUserMessageInput({ externalSessionId: "thread-1", parts: [compactPart()] }),
    );

    expect(calls.filter((call) => call.method === "thread/compact/start")).toEqual([
      { method: "thread/compact/start", params: { threadId: "thread-1" } },
    ]);
    expect(calls.some((call) => call.method === "turn/start" || call.method === "turn/steer")).toBe(
      false,
    );
    expect(accepted.message).toBe("/compact");
    expect(accepted.parts).toEqual([{ kind: "text", text: "/compact" }]);

    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: "thread-1",
        parts: [{ kind: "text", text: "continue" }],
        model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
      }),
    );
    expect(calls.filter((call) => call.method === "turn/start")).toHaveLength(1);
  });

  test("rejects arguments before resolving a runtime or sending a request", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const adapter = createAdapterWithTransport({
      async request(request) {
        calls.push(request);
        return {};
      },
    });

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({
          externalSessionId: "thread-1",
          parts: [compactPart(), { kind: "text", text: " now" }],
        }),
      ),
    ).rejects.toThrow("must be sent without arguments or references");
    expect(calls).toEqual([]);
  });

  test("adds thread context to native request failures without a fallback turn", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const adapter = createAdapterWithTransport({
      async request(request) {
        calls.push(request);
        if (request.method === "thread/resume") {
          throw new Error("Unexpected method 'thread/resume'.");
        }
        if (request.method === "thread/compact/start") {
          throw new Error("thread is busy");
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      },
    });

    await expect(
      adapter.sendUserMessage(
        codexUserMessageInput({ externalSessionId: "thread-1", parts: [compactPart()] }),
      ),
    ).rejects.toThrow("Codex failed to compact thread 'thread-1': thread is busy");
    expect(calls.some((call) => call.method === "turn/start" || call.method === "turn/steer")).toBe(
      false,
    );
  });

  test("rejects cached session route mismatches before native compaction", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const adapter = createAdapterWithTransport({
      async request(request) {
        calls.push(request);
        if (request.method === "thread/compact/start") {
          return {};
        }
        throw new Error(`Unexpected method '${request.method}'.`);
      },
    });

    await adapter.sendUserMessage(
      codexUserMessageInput({ externalSessionId: "thread-1", parts: [compactPart()] }),
    );

    for (const override of [{ repoPath: "/other" }, { workingDirectory: "/other" }]) {
      await expect(
        adapter.sendUserMessage({
          ...codexUserMessageInput({ externalSessionId: "thread-1", parts: [compactPart()] }),
          ...override,
        }),
      ).rejects.toThrow("Cannot send Codex session 'thread-1'");
    }

    expect(calls.filter((call) => call.method === "thread/compact/start")).toHaveLength(1);
  });

  test("streams native lifecycle without registering a normal active turn", async () => {
    const calls: CodexJsonRpcRequest[] = [];
    const runtimeStream = createRuntimeStreamSubscription();
    const adapter = createAdapterWithTransport(
      {
        async request(request) {
          calls.push(request);
          if (request.method === "thread/resume") {
            throw new Error("Unexpected method 'thread/resume'.");
          }
          if (request.method === "thread/compact/start") {
            return {};
          }
          throw new Error(`Unexpected method '${request.method}'.`);
        },
      },
      { subscribeEvents: runtimeStream.subscribeEvents },
    );
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    await adapter.sendUserMessage(
      codexUserMessageInput({ externalSessionId: "thread-1", parts: [compactPart()] }),
    );
    await adapter.subscribeEvents(codexSessionRuntimeRef("thread-1"), (event) =>
      events.push(event),
    );
    runtimeStream.emitNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "compact-turn-1",
        startedAtMs: 1_778_112_001_000,
        item: { type: "contextCompaction", id: "compact-item-1" },
      },
    });
    runtimeStream.emitNotification({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "compact-turn-1",
        completedAtMs: 1_778_112_002_000,
        item: { type: "contextCompaction", id: "compact-item-1" },
      },
    });
    runtimeStream.emitNotification({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: {
          id: "compact-turn-1",
          status: "completed",
          completedAt: 1_778_112_003,
        },
      },
    });
    runtimeStream.emitNotification({
      method: "thread/status/changed",
      params: { threadId: "thread-1", status: { type: "idle" } },
    });
    await flushCodexAdapterWork();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "user_message", message: "/compact" }),
        expect.objectContaining({
          type: "session_compaction_started",
          messageId: "compact-item-1",
        }),
        expect.objectContaining({ type: "session_compacted", messageId: "compact-item-1" }),
        expect.objectContaining({ type: "session_idle" }),
      ]),
    );
    expect(events.filter((event) => event.type === "session_idle")).toHaveLength(1);
    expect(calls.some((call) => call.method === "turn/start" || call.method === "turn/steer")).toBe(
      false,
    );
  });
});
