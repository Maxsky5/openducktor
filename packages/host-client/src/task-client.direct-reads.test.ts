import { describe, expect, test } from "bun:test";
import type { TaskMetadataPayload } from "@openducktor/contracts";
import { createHostClient } from "./index";
import type { InvokeFn } from "./invoke-utils";

const metadata = (version: string): TaskMetadataPayload => ({
  spec: { markdown: `Spec ${version}`, updatedAt: "2026-07-22T00:00:00Z" },
  plan: { markdown: `Plan ${version}`, updatedAt: "2026-07-22T00:00:00Z" },
  qaReport: {
    markdown: `QA ${version}`,
    verdict: "approved",
    updatedAt: "2026-07-22T00:00:00Z",
    revision: 1,
  },
  agentSessions: [],
});

describe("host client task reads", () => {
  test("consecutive reads call the host and return its latest result", async () => {
    const calls: unknown[] = [];
    let version = "V1";
    const invoke: InvokeFn = async (command, args, resultSchema) => {
      expect(command).toBe("task_metadata_get");
      calls.push(args);
      return resultSchema.parse(metadata(version));
    };
    const client = createHostClient(invoke);

    expect((await client.taskMetadataGet("/repo", "task-1")).spec.markdown).toBe("Spec V1");
    version = "V2";
    expect((await client.taskMetadataGet("/repo", "task-1")).spec.markdown).toBe("Spec V2");
    expect(calls).toEqual([
      { repoPath: "/repo", taskId: "task-1" },
      { repoPath: "/repo", taskId: "task-1" },
    ]);
  });

  test("parallel document reads send separate requests and keep each response", async () => {
    const pending: Array<(value: TaskMetadataPayload) => void> = [];
    const invoke: InvokeFn = async (command, args, resultSchema) => {
      expect(command).toBe("task_metadata_get");
      expect(args).toEqual({ repoPath: "/repo", taskId: "task-1" });
      const payload = await new Promise<TaskMetadataPayload>((resolve) => pending.push(resolve));
      return resultSchema.parse(payload);
    };
    const client = createHostClient(invoke);

    const spec = client.specGet("/repo", "task-1");
    const plan = client.planGet("/repo", "task-1");
    const qa = client.qaGetReport("/repo", "task-1");
    expect(pending).toHaveLength(3);

    pending[2]?.(metadata("V3"));
    pending[1]?.(metadata("V2"));
    pending[0]?.(metadata("V1"));
    expect((await spec).markdown).toBe("Spec V1");
    expect((await plan).markdown).toBe("Plan V2");
    expect((await qa).markdown).toBe("QA V3");
    const next = client.taskDocumentGet("/repo", "task-1", "spec");
    expect(pending).toHaveLength(4);
    pending[3]?.(metadata("V4"));
    expect((await next).markdown).toBe("Spec V4");
  });

  test("a pending document read does not replace a session history read", async () => {
    let releaseMetadata: ((value: TaskMetadataPayload) => void) | undefined;
    const pendingMetadata = new Promise<TaskMetadataPayload>((resolve) => {
      releaseMetadata = resolve;
    });
    const calls: Array<{ command: string; args: unknown }> = [];
    const client = createHostClient(async (command, args, resultSchema) => {
      calls.push({ command, args });
      if (command === "task_metadata_get") {
        return resultSchema.parse(await pendingMetadata);
      }
      if (command === "agent_sessions_list") {
        return resultSchema.parse([
          {
            externalSessionId: "session-2",
            role: "build",
            startedAt: "2026-07-22T00:00:00Z",
            runtimeKind: "opencode",
            workingDirectory: "/repo",
            selectedModel: null,
          },
        ]);
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const document = client.taskDocumentGet("/repo", "task-1", "spec");
    const sessions = client.agentSessionsList("/repo", "task-1");
    const observedCalls = [...calls];
    releaseMetadata?.(metadata("V1"));
    expect(observedCalls).toEqual([
      { command: "task_metadata_get", args: { repoPath: "/repo", taskId: "task-1" } },
      { command: "agent_sessions_list", args: { repoPath: "/repo", taskId: "task-1" } },
    ]);

    expect((await document).markdown).toBe("Spec V1");
    expect((await sessions)[0]?.externalSessionId).toBe("session-2");
  });

  test("taskDocumentGet selects each document from current host metadata", async () => {
    const payload: TaskMetadataPayload = {
      spec: { markdown: "Spec V1", updatedAt: "2026-07-22T00:00:00Z", error: null },
      plan: { markdown: "Plan V1", updatedAt: "2026-07-22T00:05:00Z", error: "Plan error" },
      qaReport: {
        markdown: "QA V1",
        verdict: "approved",
        updatedAt: "2026-07-22T00:10:00Z",
        revision: 1,
        error: "QA error",
      },
      agentSessions: [],
    };
    const calls: unknown[] = [];
    const client = createHostClient((command, args, resultSchema) => {
      expect(command).toBe("task_metadata_get");
      calls.push(args);
      return Promise.resolve(resultSchema.parse(payload));
    });

    for (const [section, expected] of [
      ["spec", { markdown: "Spec V1", updatedAt: "2026-07-22T00:00:00Z", error: null }],
      ["plan", { markdown: "Plan V1", updatedAt: "2026-07-22T00:05:00Z", error: "Plan error" }],
      ["qa", { markdown: "QA V1", updatedAt: "2026-07-22T00:10:00Z", error: "QA error" }],
    ] as const) {
      await expect(client.taskDocumentGet("/repo", "task-1", section)).resolves.toEqual(expected);
    }
    expect(calls).toEqual(Array(3).fill({ repoPath: "/repo", taskId: "task-1" }));
  });

  test("document reads preserve decode errors from host metadata", async () => {
    const client = createHostClient((command, _args, resultSchema) => {
      expect(command).toBe("task_metadata_get");
      return Promise.resolve(
        resultSchema.parse({
          ...metadata("V1"),
          spec: {
            markdown: "",
            updatedAt: "2026-07-22T00:00:00Z",
            error: "Failed to decode saved spec",
          },
        }),
      );
    });

    await expect(client.taskDocumentGet("/repo", "task-1", "spec")).resolves.toEqual({
      markdown: "",
      updatedAt: "2026-07-22T00:00:00Z",
      error: "Failed to decode saved spec",
    });
  });

  test("host failures reach metadata and document callers", async () => {
    const failure = new Error("Task store is unavailable");
    const client = createHostClient(() => Promise.reject(failure));

    await expect(client.taskMetadataGet("/repo", "task-1")).rejects.toBe(failure);
    await expect(client.taskDocumentGet("/repo", "task-1", "plan")).rejects.toBe(failure);
  });
});
