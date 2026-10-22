import { describe, expect, test } from "bun:test";
import type { CodexAppServerTurn } from "@openducktor/contracts";
import {
  codexSessionRuntimeRef,
  codexStartSessionInput,
  codexThreadFixture,
  codexThreadStartResultFixture,
  codexTurnFixture,
  codexUserMessageInput,
  createHarness,
  createRuntimeStreamSubscription,
  flushCodexAdapterWork,
  RecordingTransport,
} from "./codex-app-server-adapter.test-harness";
import {
  codexAgentMessageItemFixture,
  codexUserMessageItemFixture,
} from "./test-fixtures/codex-protocol";
import type { CodexJsonRpcRequest } from "./types";

const sourceId = "thread/start-runtime-live";
const replyId = "reply-selected";

const completedTurn = (): CodexAppServerTurn =>
  codexTurnFixture({
    id: "turn-selected",
    status: "completed",
    startedAt: 1_778_112_001,
    completedAt: 1_778_112_002,
    durationMs: 1_000,
    items: [
      codexUserMessageItemFixture({
        id: "user-selected",
        content: [{ type: "text", text: "First request", text_elements: [] }],
      }),
      codexAgentMessageItemFixture({ id: "commentary", text: "Checking", phase: "commentary" }),
      codexAgentMessageItemFixture({ id: replyId, text: "First answer", phase: "final_answer" }),
    ],
  });

class ReplyForkTransport extends RecordingTransport {
  source = codexThreadFixture({
    id: sourceId,
    status: { type: "active", activeFlags: [] },
    turns: [
      completedTurn(),
      codexTurnFixture({
        id: "turn-later",
        status: "inProgress",
        items: [
          codexAgentMessageItemFixture({
            id: "reply-later",
            text: "Still running",
            phase: "final_answer",
          }),
        ],
      }),
    ],
  });
  child = codexThreadFixture({
    id: "fork-child",
    forkedFromId: sourceId,
    cwd: "/fork",
    status: { type: "idle" },
    turns: [completedTurn()],
  });
  returnedChildId = "fork-child";
  forkFailure: Error | undefined;
  nameFailure: Error | undefined;
  interruptFailure: Error | undefined;

  constructor() {
    super("runtime-live", true);
  }

  async request(request: CodexJsonRpcRequest) {
    if (request.method === "thread/fork") {
      this.calls.push(request);
      if (this.forkFailure) throw this.forkFailure;
      return {
        ...codexThreadStartResultFixture(this.returnedChildId, "thread/fork"),
        cwd: this.child.cwd,
        thread: { ...this.child, id: this.returnedChildId, turns: [] },
      };
    }
    if (request.method === "thread/read") {
      this.calls.push(request);
      const thread = request.params.threadId === sourceId ? this.source : this.child;
      return { thread: { ...thread, turns: [] } };
    }
    if (request.method === "thread/turns/list") {
      this.calls.push(request);
      const thread = request.params.threadId === sourceId ? this.source : this.child;
      return { data: thread.turns, nextCursor: null, backwardsCursor: null };
    }
    if (request.method === "turn/interrupt" && this.interruptFailure) {
      this.calls.push(request);
      throw this.interruptFailure;
    }
    if (
      request.method === "thread/name/set" &&
      request.params.threadId === this.child.id &&
      this.nameFailure
    ) {
      this.calls.push(request);
      throw this.nameFailure;
    }
    return super.request(request);
  }
}

const forkInput = () => ({
  ...codexStartSessionInput(),
  workingDirectory: "/fork",
  sourceWorkingDirectory: "/repo",
  parentExternalSessionId: sourceId,
  forkPoint: { messageId: replyId },
});

describe("Codex completed reply forks", () => {
  test("forks an exact completed prefix into the destination and preserves pending source input", async () => {
    const transport = new ReplyForkTransport();
    const stream = createRuntimeStreamSubscription();
    const { adapter, respondServerRequest } = createHarness({
      transportFactory: () => transport,
      subscribeEvents: stream.subscribeEvents,
    });
    await adapter.startSession(codexStartSessionInput());
    transport.turnStartDeferred.resolve({ turn: transport.source.turns[1]! });
    await adapter.sendUserMessage(
      codexUserMessageInput({
        externalSessionId: sourceId,
        parts: [{ kind: "text", text: "Keep working" }],
      }),
    );
    stream.emitServerRequest({
      id: 31,
      method: "item/fileChange/requestApproval",
      params: { itemId: "approval", startedAtMs: 1, threadId: sourceId, turnId: "turn-later" },
    });
    stream.emitServerRequest({
      id: 32,
      method: "item/tool/requestUserInput",
      params: {
        autoResolutionMs: null,
        isBlocking: true,
        threadId: sourceId,
        turnId: "turn-later",
        itemId: "question",
        questions: [
          {
            id: "environment",
            header: "Environment",
            question: "Which environment?",
            isOther: false,
            isSecret: false,
            options: null,
          },
        ],
      },
    });
    await flushCodexAdapterWork();
    const sourceBefore = adapter
      .listLiveSessionSnapshots("runtime-live")
      .find((snapshot) => snapshot.ref.externalSessionId === sourceId);
    expect(sourceBefore?.pendingApprovals).toHaveLength(1);
    expect(sourceBefore?.pendingQuestions).toHaveLength(1);

    const child = await adapter.forkSession(forkInput());

    expect(child).toMatchObject({
      externalSessionId: "fork-child",
      workingDirectory: "/fork",
      status: "idle",
    });
    expect(transport.calls.find((call) => call.method === "thread/fork")?.params).toMatchObject({
      threadId: sourceId,
      lastTurnId: "turn-selected",
      cwd: "/fork",
      excludeTurns: true,
      deferGoalContinuation: true,
      model: "gpt-5",
    });
    expect(
      adapter
        .listLiveSessionSnapshots("runtime-live")
        .find((snapshot) => snapshot.ref.externalSessionId === sourceId),
    ).toEqual(sourceBefore);
    expect(
      adapter
        .listLiveSessionSnapshots("runtime-live")
        .find((snapshot) => snapshot.ref.externalSessionId === "fork-child"),
    ).toMatchObject({ activity: "idle", pendingApprovals: [], pendingQuestions: [] });
    expect(respondServerRequest).not.toHaveBeenCalled();
    expect(
      transport.calls.filter((call) => ["thread/resume", "turn/interrupt"].includes(call.method)),
    ).toEqual([]);

    const history = await adapter.loadSessionHistory({
      ...codexSessionRuntimeRef("fork-child"),
      workingDirectory: "/fork",
    });
    expect(history.find((message) => message.messageId === replyId)?.forkPoint).toEqual({
      messageId: replyId,
    });
    expect(history.some((message) => message.messageId === "reply-later")).toBe(false);
    expect(history.at(-1)?.notice).toMatchObject({
      reason: "session_forked",
      parentExternalSessionId: sourceId,
    });
  });

  for (const messageId of ["missing", "commentary", "reply-later"]) {
    test(`rejects the non-final or unfinished target '${messageId}' before native creation`, async () => {
      const transport = new ReplyForkTransport();
      const { adapter } = createHarness({ transportFactory: () => transport });
      await expect(
        adapter.forkSession({ ...forkInput(), forkPoint: { messageId } }),
      ).rejects.toThrow("not a final reply of a completed turn");
      expect(transport.calls.some((call) => call.method === "thread/fork")).toBe(false);
    });
  }

  test("keeps completed history targets available while later work runs", async () => {
    const transport = new ReplyForkTransport();
    const { adapter } = createHarness({ transportFactory: () => transport });
    const history = await adapter.loadSessionHistory(codexSessionRuntimeRef(sourceId));
    expect(
      history.filter((message) => message.forkPoint).map((message) => message.forkPoint),
    ).toEqual([{ messageId: replyId }]);
  });

  for (const invalidChild of ["source", "extra_turn", "active", "wrong_directory"] as const) {
    test(`rejects an invalid child '${invalidChild}' without source mutation`, async () => {
      const transport = new ReplyForkTransport();
      if (invalidChild === "source") transport.returnedChildId = sourceId;
      if (invalidChild === "extra_turn" || invalidChild === "active")
        transport.child.turns.push(
          codexTurnFixture({
            id: "unexpected-turn",
            status: invalidChild === "active" ? "inProgress" : "completed",
            items: [],
          }),
        );
      if (invalidChild === "active") transport.child.status = { type: "active", activeFlags: [] };
      if (invalidChild === "wrong_directory") transport.child.cwd = "/other";
      const { adapter } = createHarness({ transportFactory: () => transport });
      await adapter.startSession(codexStartSessionInput());
      const sourceBefore = adapter.listLiveSessionSnapshots("runtime-live");
      await expect(adapter.forkSession(forkInput())).rejects.toThrow();
      expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual(sourceBefore);
      expect(transport.calls.filter((call) => call.method === "turn/interrupt")).toEqual(
        invalidChild === "active"
          ? [
              {
                method: "turn/interrupt",
                params: { threadId: "fork-child", turnId: "unexpected-turn" },
              },
            ]
          : [],
      );
      expect(transport.calls.filter((call) => call.method === "thread/fork")).toHaveLength(1);
    });
  }

  test("reports a native refusal without retrying another fork point", async () => {
    const transport = new ReplyForkTransport();
    transport.forkFailure = new Error("The selected turn cannot be forked");
    const { adapter } = createHarness({ transportFactory: () => transport });
    await expect(adapter.forkSession(forkInput())).rejects.toThrow(
      "The selected turn cannot be forked",
    );
    expect(transport.calls.filter((call) => call.method === "thread/fork")).toHaveLength(1);
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
  });

  test("reports a retained native child when naming fails and keeps the source registered", async () => {
    const transport = new ReplyForkTransport();
    transport.nameFailure = new Error("name failed");
    const { adapter } = createHarness({ transportFactory: () => transport });
    await adapter.startSession(codexStartSessionInput());
    const sourceBefore = adapter.listLiveSessionSnapshots("runtime-live");

    const failure = await adapter.forkSession(forkInput()).then(
      () => undefined,
      (cause: unknown) => cause,
    );

    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error))
      throw new Error("Expected a fork failure.", { cause: failure });
    expect(failure.message).toContain("fork-child");
    expect(failure.message).toContain("remains in Codex history");
    expect(failure.cause).toBe(transport.nameFailure);
    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual(sourceBefore);
    expect(transport.calls.filter((call) => call.method === "thread/name/set")).toEqual([
      { method: "thread/name/set", params: { threadId: sourceId, name: "BUILD task-1" } },
      { method: "thread/name/set", params: { threadId: "fork-child", name: "BUILD task-1" } },
    ]);
    expect(
      transport.calls.filter((call) =>
        ["thread/resume", "turn/start", "turn/interrupt"].includes(call.method),
      ),
    ).toEqual([]);
    expect(transport.calls.filter((call) => call.method === "thread/fork")).toHaveLength(1);
  });

  test("reports failed child interruption with the child identity", async () => {
    const transport = new ReplyForkTransport();
    transport.child.status = { type: "active", activeFlags: [] };
    transport.child.turns.push(
      codexTurnFixture({ id: "unexpected-turn", status: "inProgress", items: [] }),
    );
    transport.interruptFailure = new Error("Runtime disconnected");
    const { adapter } = createHarness({ transportFactory: () => transport });
    const failure = await adapter.forkSession(forkInput()).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error) || !(failure.cause instanceof AggregateError)) {
      throw new Error("Expected a fork cleanup failure.", { cause: failure });
    }
    expect(failure.message).toContain(
      "Could not stop work in fork 'fork-child': Runtime disconnected",
    );
    expect(failure.cause.errors).toContain(transport.interruptFailure);
    expect(failure.cause.cause).toHaveProperty(
      "message",
      "Codex started work in the fork. Inspect the fork before retrying.",
    );
    expect(failure.cause.errors).toContain(failure.cause.cause);
  });
});
