import { describe, expect, test } from "bun:test";
import type { OpencodeRuntimeSnapshotSource } from "@openducktor/adapters-opencode-sdk";
import { Effect } from "effect";
import type { AgentSessionLiveAdapterChange } from "../../ports/agent-session-live-adapter-port";
import { createOpenCodeLiveSessionAdapterPreparer } from "./opencode-live-session-adapter";
import {
  createLifecycle,
  createRuntimeHarness,
  runtime,
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
    lostObservations?: string[];
  } = {},
) =>
  Effect.runPromise(
    createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle: createLifecycle(options.changes ?? []),
      prepareRuntime: harness.prepareRuntime,
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
