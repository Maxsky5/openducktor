import { describe, expect, test } from "bun:test";
import type { Event } from "@opencode-ai/sdk/v2";
import { makeMockClient, OpencodeSdkAdapter } from "./test-support";

describe("OpencodeSdkAdapter index", () => {
  test("shares one global event stream across sessions on the same endpoint", async () => {
    const mock = makeMockClient({ sessionIds: ["session-opencode-1", "session-2"] });
    let listCalls = 0;
    const abortSignals: AbortSignal[] = [];
    (
      mock.client.global as unknown as {
        event: (options?: {
          signal?: AbortSignal;
        }) => Promise<{ stream: AsyncIterable<{ directory: string; payload: Event }> }>;
      }
    ).event = async (options?: { signal?: AbortSignal }) => {
      listCalls += 1;
      abortSignals.push(options?.signal ?? AbortSignal.abort());

      async function* iterator(): AsyncGenerator<{ directory: string; payload: Event }> {
        if (options?.signal?.aborted) {
          return;
        }
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }

      return { stream: iterator() };
    };

    const createClientCalls: unknown[] = [];
    const adapter = new OpencodeSdkAdapter({
      createClient: (input) => {
        createClientCalls.push(input);
        return mock.client;
      },
      now: () => "2026-02-17T12:00:00Z",
    });

    await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "build",
      systemPrompt: "system",
    });
    await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/other",
      taskId: "task-2",
      runtimeKind: "opencode",
      role: "qa",
      systemPrompt: "system",
    });

    expect(listCalls).toBe(1);
    expect(abortSignals).toHaveLength(1);
    expect(createClientCalls).toEqual([
      {
        runtimeEndpoint: "http://127.0.0.1:12345",
        workingDirectory: "/repo",
      },
      {
        runtimeEndpoint: "http://127.0.0.1:12345",
      },
      {
        runtimeEndpoint: "http://127.0.0.1:12345",
        workingDirectory: "/other",
      },
    ]);

    await adapter.stopSession("session-2");
    expect(abortSignals[0]?.aborted).toBe(false);

    await adapter.stopSession("session-opencode-1");
    expect(abortSignals[0]?.aborted).toBe(true);
  });

  test("startSession emits session_started and returns summary", async () => {
    const mock = makeMockClient({});
    const adapter = new OpencodeSdkAdapter({
      createClient: () => mock.client,
      now: () => "2026-02-17T12:00:00Z",
    });

    const events: unknown[] = [];
    adapter.subscribeEvents("session-opencode-1", (event) => events.push(event));

    const summary = await adapter.startSession({
      repoPath: "/repo",
      workingDirectory: "/repo",
      taskId: "task-1",
      runtimeKind: "opencode",
      role: "planner",
      systemPrompt: "system",
    });

    expect(summary.externalSessionId).toBe("session-opencode-1");
    expect(summary.role).toBe("planner");
    expect(summary.title).toBe("PLANNER task-1");
    expect(mock.session.createCalls).toHaveLength(1);
    expect(mock.session.createCalls[0]).toMatchObject({
      directory: "/repo",
      title: "PLANNER task-1",
    });
    const createInput = mock.session.createCalls[0] as {
      permission?: Array<{ permission: string; pattern: string; action: string }>;
    };
    const permissionRules = createInput.permission ?? [];
    const deniedNativeTools = [
      "edit",
      "write",
      "apply_patch",
      "ast_grep_replace",
      "lsp_rename",
    ] as const;
    for (const toolName of deniedNativeTools) {
      expect(permissionRules).toContainEqual({
        permission: toolName,
        pattern: "*",
        action: "deny",
      });
    }
    expect(permissionRules).not.toContainEqual({
      permission: "bash",
      pattern: "*",
      action: "deny",
    });
    expect(permissionRules).toContainEqual({
      permission: "openducktor_*",
      pattern: "*",
      action: "deny",
    });
    expect(permissionRules).toContainEqual({
      permission: "functions.openducktor_*",
      pattern: "*",
      action: "deny",
    });
    expect(permissionRules).toContainEqual({
      permission: "odt_create_task",
      pattern: "*",
      action: "deny",
    });
    expect(permissionRules).toContainEqual({
      permission: "odt_search_tasks",
      pattern: "*",
      action: "deny",
    });
    expect(permissionRules).toContainEqual({
      permission: "odt_get_workspaces",
      pattern: "*",
      action: "deny",
    });
    expect(permissionRules).toContainEqual({
      permission: "odt_read_task",
      pattern: "*",
      action: "allow",
    });
    expect(permissionRules).toContainEqual({
      permission: "odt_read_task_documents",
      pattern: "*",
      action: "allow",
    });
    expect(permissionRules).toContainEqual({
      permission: "odt_set_plan",
      pattern: "*",
      action: "allow",
    });
    expect(permissionRules).toContainEqual({
      permission: "odt_set_spec",
      pattern: "*",
      action: "deny",
    });
    expect(permissionRules).toContainEqual({
      permission: "openducktor_odt_read_task",
      pattern: "*",
      action: "allow",
    });
    expect(permissionRules).toContainEqual({
      permission: "openducktor_odt_read_task_documents",
      pattern: "*",
      action: "allow",
    });
    expect(permissionRules).toContainEqual({
      permission: "openducktor_odt_set_plan",
      pattern: "*",
      action: "allow",
    });
    expect(permissionRules).not.toContainEqual({
      permission: "openducktor_odt_set_spec",
      pattern: "*",
      action: "allow",
    });
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe("session_started");
  });
});
