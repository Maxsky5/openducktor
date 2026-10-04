import { describe, expect, test } from "bun:test";
import type { OpencodeRuntimeSnapshotSource } from "@openducktor/adapters-opencode-sdk";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import { createOpenCodeLiveSessionAdapterPreparer } from "./opencode-live-session-adapter";
import type { OpenCodeMcpStatusProbe } from "./opencode-live-session-mcp";
import {
  createLifecycle,
  createRuntimeHarness,
  runtime,
  unexpectedMcpStatusProbe,
} from "./opencode-live-session-adapter.test-support";

const repoA = "/repo-a";
const repoB = "/repo-b";
const workflowScope = { kind: "workflow", taskId: "task-1", role: "build" } as const;

const sessionRef = (repoPath: string, externalSessionId: string) => ({
  repoPath,
  runtimeKind: "opencode" as const,
  workingDirectory: `${repoPath}/worktree`,
  externalSessionId,
});

const source = (repoPath: string, externalSessionId: string): OpencodeRuntimeSnapshotSource => ({
  repoPath,
  externalSessionId,
  workingDirectory: `${repoPath}/worktree`,
  sessionAssociation: workflowScope,
  title: `Session ${externalSessionId}`,
  startedAt: "2026-07-16T10:00:00.000Z",
  runtimeActivity: "idle",
  pendingApprovals: [],
  pendingQuestions: [],
});

const prepareAdapter = (
  harness: ReturnType<typeof createRuntimeHarness>,
  options: {
    changes?: AgentSessionLiveAdapterChange[];
    probeMcpStatus?: OpenCodeMcpStatusProbe;
    lostObservations?: string[];
  } = {},
) =>
  Effect.runPromise(
    createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle: createLifecycle(options.changes ?? []),
      prepareRuntime: harness.prepareRuntime,
      probeMcpStatus: options.probeMcpStatus ?? unexpectedMcpStatusProbe,
    })(runtime, {
      onObservationLost: (message) => options.lostObservations?.push(message),
      onCleanupFailed: () => undefined,
    }),
  );

describe("OpenCode live sessions on one shared runtime", () => {
  test("refreshing one repository keeps the sessions of another repository", async () => {
    const sourcesByRepo = new Map([
      [repoA, [source(repoA, "session-a")]],
      [repoB, [source(repoB, "session-b")]],
    ]);
    const harness = createRuntimeHarness({
      readSessionSources: async (repoPath) => ({
        sources: sourcesByRepo.get(repoPath) ?? [],
        failures: [],
      }),
    });
    const changes: AgentSessionLiveAdapterChange[] = [];
    const prepared = await prepareAdapter(harness, { changes });
    const refresh = prepared.adapter.refreshSnapshots;
    if (!refresh) throw new Error("Expected OpenCode to refresh snapshots.");

    await Effect.runPromise(refresh(repoA));
    await Effect.runPromise(refresh(repoB));
    sourcesByRepo.set(repoA, []);
    changes.length = 0;
    await Effect.runPromise(refresh(repoA));

    expect(harness.sessionSourceReadRepos).toEqual([repoA, repoB, repoA]);
    expect(changes).toEqual([
      { type: "session_removed", ref: sessionRef(repoA, "session-a"), provenance: "baseline" },
    ]);
    const snapshots = await Effect.runPromise(prepared.adapter.listSnapshots());
    expect(snapshots.map(({ ref }) => ref)).toEqual([sessionRef(repoB, "session-b")]);
  });

  test("builds control results with the request repository", async () => {
    const harness = createRuntimeHarness();
    const prepared = await prepareAdapter(harness);

    await Effect.runPromise(
      prepared.adapter.resumeSession({
        resumeMode: "reattach",
        ...sessionRef(repoA, "session-a"),
        sessionScope: workflowScope,
      }),
    );
    await Effect.runPromise(
      prepared.adapter.resumeSession({
        resumeMode: "reattach",
        ...sessionRef(repoB, "session-b"),
        sessionScope: workflowScope,
      }),
    );

    const snapshots = await Effect.runPromise(prepared.adapter.listSnapshots());
    expect(snapshots.map(({ ref }) => ref)).toEqual([
      sessionRef(repoA, "session-a"),
      sessionRef(repoB, "session-b"),
    ]);
  });

  test("publishes a runtime observation fault once for each repository with live sessions", async () => {
    const harness = createRuntimeHarness();
    const changes: AgentSessionLiveAdapterChange[] = [];
    const prepared = await prepareAdapter(harness, { changes });
    for (const ref of [
      sessionRef(repoA, "session-a1"),
      sessionRef(repoA, "session-a2"),
      sessionRef(repoB, "session-b"),
    ]) {
      await Effect.runPromise(
        prepared.adapter.resumeSession({
          resumeMode: "reattach",
          ...ref,
          sessionScope: workflowScope,
        }),
      );
    }
    await Effect.runPromise(prepared.startForwarding());
    changes.length = 0;

    await harness.emit({ type: "fault", message: "connection lost" });

    expect(changes).toEqual([
      {
        type: "fault",
        repoPath: repoA,
        operation: "opencode-live-session.observe-runtime",
        message: "connection lost",
      },
      {
        type: "fault",
        repoPath: repoB,
        operation: "opencode-live-session.observe-runtime",
        message: "connection lost",
      },
    ]);
  });

  test("publishes no runtime observation fault when no session is live", async () => {
    const harness = createRuntimeHarness();
    const changes: AgentSessionLiveAdapterChange[] = [];
    const lostObservations: string[] = [];
    const prepared = await prepareAdapter(harness, { changes, lostObservations });
    await Effect.runPromise(prepared.startForwarding());

    await harness.emit({ type: "fault", message: "connection lost" });

    expect(changes).toEqual([]);
    expect(lostObservations).toEqual(["connection lost"]);
  });
});

describe("OpenCode MCP connection observation", () => {
  test("reads only the bound directories of the requested workspace", async () => {
    const probed: string[] = [];
    const harness = createRuntimeHarness({
      mcpBindings: [
        { workingDirectory: "/repo-a", repoPath: repoA },
        { workingDirectory: "/repo-a/worktree", repoPath: repoA },
        { workingDirectory: "/repo-b/stale", repoPath: repoA },
        { workingDirectory: "/repo-b", repoPath: repoB },
      ],
    });
    const prepared = await prepareAdapter(harness, {
      probeMcpStatus: ({ runtimeRoute, workingDirectory, serverName }) => {
        probed.push(workingDirectory);
        expect(runtimeRoute).toEqual(runtime.runtimeRoute);
        expect(serverName).toBe("openducktor");
        if (workingDirectory === "/repo-a") {
          return Effect.succeed({
            connected: true,
            serverStatus: "connected",
            toolIds: ["odt_read_task"],
            detail: null,
          });
        }
        if (workingDirectory === "/repo-a/worktree") {
          return Effect.succeed({
            connected: false,
            serverStatus: "failed",
            toolIds: [],
            detail: "Connection closed",
          });
        }
        return Effect.fail(
          new HostOperationError({ operation: "probe", message: "OpenCode did not answer." }),
        );
      },
    });
    const readMcpConnections = prepared.adapter.readMcpConnections;
    if (!readMcpConnections) throw new Error("Expected OpenCode to observe MCP connections.");

    const observations = await Effect.runPromise(readMcpConnections(repoA));

    expect(probed.toSorted()).toEqual(["/repo-a", "/repo-a/worktree", "/repo-b/stale"]);
    expect(observations).toEqual([
      {
        workingDirectory: "/repo-a",
        state: "connected",
        serverStatus: "connected",
        toolIds: ["odt_read_task"],
        detail: null,
      },
      {
        workingDirectory: "/repo-a/worktree",
        state: "failed",
        serverStatus: "failed",
        toolIds: [],
        detail: "Connection closed",
      },
      {
        workingDirectory: "/repo-b/stale",
        state: "failed",
        serverStatus: null,
        toolIds: [],
        detail: "OpenCode did not answer.",
      },
    ]);
  });

  test("returns no observation and calls no runtime for a workspace without a binding", async () => {
    const harness = createRuntimeHarness({
      mcpBindings: [{ workingDirectory: "/repo-b", repoPath: repoB }],
    });
    const prepared = await prepareAdapter(harness);
    const readMcpConnections = prepared.adapter.readMcpConnections;
    if (!readMcpConnections) throw new Error("Expected OpenCode to observe MCP connections.");

    await expect(Effect.runPromise(readMcpConnections(repoA))).resolves.toEqual([]);
  });
});
