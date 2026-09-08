import { expect, spyOn, test } from "bun:test";
import {
  codexSessionRuntimeRef,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
} from "./codex-app-server-adapter.test-harness";
import {
  codexCollabAgentToolCallFixture,
  codexTokenUsageFixture,
  codexTurnFixture,
} from "./test-fixtures/codex-protocol";
import type { CodexLiveSessionMutation } from "./types";

test("stream deltas match full snapshot replay without rebuilding idle sessions", async () => {
  const stream = createRuntimeStreamSubscription();
  const mutations: CodexLiveSessionMutation[] = [];
  const failures: unknown[] = [];
  const { adapter } = createHarness({
    subscribeEvents: stream.subscribeEvents,
    onLiveSessionMutation: (mutation) => {
      mutations.push(mutation);
    },
    onRuntimeEventQueueFailure: (failure) => {
      failures.push(failure);
    },
  });
  const unsubscribes: Array<() => void> = [];
  for (let index = 0; index < 50; index++) {
    await adapter.resumeSession(codexSessionRuntimeRef(`thread-${index}`));
    unsubscribes.push(
      await adapter.subscribeEvents(codexSessionRuntimeRef(`thread-${index}`), () => {}),
    );
  }
  const initial = adapter.listLiveSessionSnapshots("runtime-live");
  expect(initial).toHaveLength(50);
  const projected = new Map(initial.map((snapshot) => [snapshot.ref.externalSessionId, snapshot]));
  // @ts-expect-error Measure the existing private builder without adding a production test API.
  const rootBuild = spyOn(adapter, "toLiveSessionSnapshot");
  // @ts-expect-error Routed children use a separate private builder.
  const childBuild = spyOn(adapter, "toRoutedChildLiveSessionSnapshot");
  try {
    for (let index = 0; index < 100; index++) {
      stream.emitNotification({
        method: "item/agentMessage/delta",
        params: { threadId: "thread-0", turnId: "turn-0", itemId: "message-0", delta: `${index},` },
      });
    }
    await flushCodexAdapterWork();
    expect(failures).toEqual([]);
    expect(mutations).toHaveLength(100);
    expect(rootBuild).not.toHaveBeenCalled();
    expect(childBuild).not.toHaveBeenCalled();
    expect(
      mutations.every(
        (mutation) => mutation.snapshotMode === "delta" && mutation.snapshots.length === 0,
      ),
    ).toBe(true);
    expect(
      mutations
        .flatMap((mutation) => mutation.transcriptEvents)
        .map((event) => (event.type === "assistant_delta" ? event.delta : event.type)),
    ).toEqual(Array.from({ length: 100 }, (_, index) => `${index},`));

    let baselineBuilds = 0;
    let baselineEqualityBytes = 0;
    for (let index = 0; index < 100; index++) {
      const full = adapter.listLiveSessionSnapshots("runtime-live");
      baselineBuilds += full.length;
      for (const snapshot of full) {
        baselineEqualityBytes += Buffer.byteLength(
          JSON.stringify(projected.get(snapshot.ref.externalSessionId)),
        );
        baselineEqualityBytes += Buffer.byteLength(JSON.stringify(snapshot));
      }
    }
    expect(baselineBuilds).toBe(5_000);
    expect(rootBuild).toHaveBeenCalledTimes(5_000);
    expect(baselineEqualityBytes).toBeGreaterThan(0);
    console.info(
      `Codex text replay: snapshot builds ${baselineBuilds} -> 0; snapshot equality bytes ${baselineEqualityBytes} -> 0`,
    );
    rootBuild.mockClear();

    const assertReplay = async (expectedChangedIds: string[]) => {
      await flushCodexAdapterWork();
      expect(failures).toEqual([]);
      const mutation = mutations.at(-1)!;
      if (expectedChangedIds.length) expect(mutation.fault).toBeUndefined();
      expect(mutation.snapshotMode).toBe("delta");
      expect(mutation.snapshots.map((snapshot) => snapshot.ref.externalSessionId).sort()).toEqual(
        expectedChangedIds.sort(),
      );
      for (const snapshot of mutation.snapshots) {
        projected.set(snapshot.ref.externalSessionId, snapshot);
      }
      const full = adapter.listLiveSessionSnapshots("runtime-live");
      expect(
        [...projected.values()].sort((a, b) =>
          a.ref.externalSessionId.localeCompare(b.ref.externalSessionId),
        ),
      ).toEqual(
        full.sort((a, b) => a.ref.externalSessionId.localeCompare(b.ref.externalSessionId)),
      );
    };
    stream.emitNotification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-0",
        turnId: "turn-0",
        tokenUsage: codexTokenUsageFixture(123),
      },
    });
    await assertReplay(["thread-0"]);
    stream.emitNotification({
      method: "thread/status/changed",
      params: { threadId: "thread-0", status: { type: "active", activeFlags: [] } },
    });
    await assertReplay(["thread-0"]);
    stream.emitNotification({
      method: "item/completed",
      params: {
        threadId: "thread-0",
        turnId: "turn-0",
        completedAtMs: Date.now(),
        item: codexCollabAgentToolCallFixture({
          id: "spawn",
          senderThreadId: "thread-0",
          tool: "spawnAgent",
          status: "completed",
          receiverThreadIds: ["child"],
          agentsStates: { child: { status: "running", message: null } },
        }),
      },
    });
    await assertReplay(["child"]);
    stream.emitNotification({
      method: "turn/completed",
      params: {
        threadId: "child",
        turn: codexTurnFixture({ id: "child-turn", items: [], status: "completed" }),
      },
    });
    await assertReplay(["child"]);
    stream.emitNotification({
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "child",
        turnId: "child-turn",
        tokenUsage: codexTokenUsageFixture(456),
      },
    });
    await assertReplay(["child"]);
    stream.emitNotification({
      method: "item/completed",
      params: {
        threadId: "child",
        turnId: "child-turn",
        completedAtMs: Date.now(),
        item: codexCollabAgentToolCallFixture({
          id: "spawn-grandchild",
          senderThreadId: "child",
          tool: "spawnAgent",
          status: "completed",
          receiverThreadIds: ["grandchild"],
          agentsStates: { grandchild: { status: "running", message: null } },
        }),
      },
    });
    await assertReplay(["grandchild"]);
    stream.emitNotification({
      method: "turn/completed",
      params: {
        threadId: "grandchild",
        turn: codexTurnFixture({ id: "grandchild-turn", items: [], status: "completed" }),
      },
    });
    await assertReplay(["grandchild"]);
    stream.emitNotification({
      method: "item/completed",
      params: {
        threadId: "thread-0",
        turnId: "turn-0",
        completedAtMs: Date.now(),
        item: codexCollabAgentToolCallFixture({
          id: "link-retained",
          senderThreadId: "thread-0",
          tool: "spawnAgent",
          status: "completed",
          receiverThreadIds: ["thread-1"],
          agentsStates: { "thread-1": { status: "running", message: null } },
        }),
      },
    });
    await assertReplay(["thread-1"]);
    stream.emitServerRequest({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "child",
        turnId: "child-turn",
        itemId: "command-1",
        startedAtMs: 1,
        environmentId: "local",
        command: "echo hello",
        cwd: "/repo",
      },
    });
    await assertReplay(["child"]);
    expect(projected.get("child")?.pendingApprovals).toHaveLength(1);
    stream.emitNotification({
      method: "serverRequest/resolved",
      params: { threadId: "child", requestId: "approval-1" },
    });
    await assertReplay(["child"]);
    expect(projected.get("child")?.pendingApprovals).toEqual([]);
    stream.emitServerRequest({
      id: "question-1",
      method: "item/tool/requestUserInput",
      params: {
        autoResolutionMs: null,
        isBlocking: true,
        itemId: "question-item",
        threadId: "grandchild",
        turnId: "grandchild-turn",
        questions: [
          {
            id: "choice",
            header: "Proceed",
            question: "Continue?",
            isOther: false,
            isSecret: false,
            options: null,
          },
        ],
      },
    });
    await assertReplay(["grandchild"]);
    expect(projected.get("grandchild")?.pendingQuestions).toHaveLength(1);
    stream.emitNotification({
      method: "serverRequest/resolved",
      params: { threadId: "grandchild", requestId: "question-1" },
    });
    await assertReplay(["grandchild"]);
    expect(projected.get("grandchild")?.pendingQuestions).toEqual([]);
    stream.emitNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "child", delta: 123 },
    });
    await assertReplay([]);
    expect(mutations.at(-1)?.faultRef?.externalSessionId).toBe("child");
    expect(mutations.at(-1)?.fault).toBeDefined();
  } finally {
    rootBuild.mockRestore();
    childBuild.mockRestore();
    for (const unsubscribe of unsubscribes) unsubscribe();
    adapter.releaseRuntime("runtime-live");
  }
});
