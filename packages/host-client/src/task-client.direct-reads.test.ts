import { describe, expect, test } from "bun:test";
import type { TaskMetadataPayload } from "@openducktor/contracts";
import { HostTaskClient } from "./task-client";
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

describe("HostTaskClient metadata reads", () => {
  test("consecutive reads call the host and return its latest result", async () => {
    const calls: unknown[] = [];
    let version = "V1";
    const invoke: InvokeFn = async (command, args, resultSchema) => {
      expect(command).toBe("task_metadata_get");
      calls.push(args);
      return resultSchema.parse(metadata(version));
    };
    const client = new HostTaskClient(invoke);

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
    const client = new HostTaskClient(invoke);

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

  test("host failures reach metadata and document callers", async () => {
    const failure = new Error("Task store is unavailable");
    const client = new HostTaskClient(() => Promise.reject(failure));

    await expect(client.taskMetadataGet("/repo", "task-1")).rejects.toBe(failure);
    await expect(client.taskDocumentGet("/repo", "task-1", "plan")).rejects.toBe(failure);
  });
});
