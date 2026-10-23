import { describe, expect, test } from "bun:test";
import type { TaskMetadataArtifact, TaskMetadataPayload } from "@openducktor/contracts";
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
    const pending: Array<{ command: string; resolve: (value: TaskMetadataArtifact) => void }> = [];
    const invoke: InvokeFn = async (command, args, resultSchema) => {
      expect(args).toEqual({ repoPath: "/repo", taskId: "task-1" });
      const payload = await new Promise<TaskMetadataArtifact>((resolve) => {
        pending.push({ command, resolve });
      });
      return resultSchema.parse(payload);
    };
    const client = createHostClient(invoke);

    const spec = client.specGet("/repo", "task-1");
    const plan = client.planGet("/repo", "task-1");
    const qa = client.qaGetReport("/repo", "task-1");
    expect(pending.map((read) => read.command)).toEqual(["spec_get", "plan_get", "qa_get_report"]);

    pending[2]?.resolve({ markdown: "QA V3" });
    pending[1]?.resolve({ markdown: "Plan V2" });
    pending[0]?.resolve({ markdown: "Spec V1" });
    expect((await spec).markdown).toBe("Spec V1");
    expect((await plan).markdown).toBe("Plan V2");
    expect((await qa).markdown).toBe("QA V3");
    const next = client.taskWorkflowArtifactGet("/repo", "task-1", "spec");
    expect(pending).toHaveLength(4);
    expect(pending[3]?.command).toBe("spec_get");
    pending[3]?.resolve({ markdown: "Spec V4" });
    expect((await next).markdown).toBe("Spec V4");
  });

  test("a pending document read does not replace a session history read", async () => {
    let releaseArtifact: ((value: TaskMetadataArtifact) => void) | undefined;
    const pendingArtifact = new Promise<TaskMetadataArtifact>((resolve) => {
      releaseArtifact = resolve;
    });
    const calls: Array<{ command: string; args: unknown }> = [];
    const client = createHostClient(async (command, args, resultSchema) => {
      calls.push({ command, args });
      if (command === "spec_get") {
        return resultSchema.parse(await pendingArtifact);
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

    const document = client.taskWorkflowArtifactGet("/repo", "task-1", "spec");
    const sessions = client.agentSessionsList("/repo", "task-1");
    const observedCalls = [...calls];
    releaseArtifact?.({ markdown: "Spec V1" });
    expect(observedCalls).toEqual([
      { command: "spec_get", args: { repoPath: "/repo", taskId: "task-1" } },
      { command: "agent_sessions_list", args: { repoPath: "/repo", taskId: "task-1" } },
    ]);

    expect((await document).markdown).toBe("Spec V1");
    expect((await sessions)[0]?.externalSessionId).toBe("session-2");
  });

  test.each([
    ["spec", "spec_get"],
    ["plan", "plan_get"],
    ["qa", "qa_get_report"],
  ] as const)(
    "workflow %s reads preserve content, decode errors, and absence",
    async (section, route) => {
      let payload: TaskMetadataArtifact = {
        markdown: "Saved content",
        updatedAt: "2026-07-22T00:00:00Z",
      };
      const calls: Array<{ command: string; args: unknown }> = [];
      const client = createHostClient((command, args, resultSchema) => {
        calls.push({ command, args });
        return Promise.resolve(resultSchema.parse(payload));
      });

      await expect(client.taskWorkflowArtifactGet("/repo", "task-1", section)).resolves.toEqual({
        markdown: "Saved content",
        updatedAt: "2026-07-22T00:00:00Z",
        error: null,
      });
      payload = {
        markdown: "",
        updatedAt: "2026-07-22T00:00:00Z",
        error: "Failed to decode saved content",
      };
      await expect(client.taskWorkflowArtifactGet("/repo", "task-1", section)).resolves.toEqual(
        payload,
      );
      payload = { markdown: "" };
      await expect(client.taskWorkflowArtifactGet("/repo", "task-1", section)).resolves.toEqual({
        markdown: "",
        updatedAt: null,
        error: null,
      });
      expect(calls).toEqual(
        Array(3).fill({ command: route, args: { repoPath: "/repo", taskId: "task-1" } }),
      );
    },
  );

  test("host failures reach metadata and document callers", async () => {
    const failure = new Error("Task store is unavailable");
    const client = createHostClient(() => Promise.reject(failure));

    await expect(client.taskMetadataGet("/repo", "task-1")).rejects.toBe(failure);
    await expect(client.taskWorkflowArtifactGet("/repo", "task-1", "plan")).rejects.toBe(failure);
  });
});
