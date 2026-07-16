import { describe, expect, test } from "bun:test";
import type { ActiveCodexTurn } from "./codex-app-server-shared";
import { CodexPendingInputState } from "./codex-pending-input-state";
import type { CodexSubagentRoute } from "./codex-subagent-link-state";

type PendingInputFixture = {
  runtimeId?: string;
  threadId?: string;
  nativeRequestId?: string | number;
  route?: CodexSubagentRoute;
};

const registerApproval = (
  pendingInput: CodexPendingInputState,
  fixture: PendingInputFixture = {},
) =>
  pendingInput.addApproval({
    runtimeId: fixture.runtimeId ?? "runtime-1",
    threadId: fixture.threadId ?? "thread-1",
    nativeRequest: {
      id: fixture.nativeRequestId ?? "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { threadId: fixture.threadId ?? "thread-1" },
    },
    request: {
      requestType: "permission_grant",
      title: "Approve read",
    },
    ...(fixture.route ? { route: fixture.route } : {}),
  });

const registerQuestion = (
  pendingInput: CodexPendingInputState,
  fixture: PendingInputFixture = {},
) =>
  pendingInput.addQuestion({
    runtimeId: fixture.runtimeId ?? "runtime-1",
    threadId: fixture.threadId ?? "thread-1",
    nativeRequest: {
      id: fixture.nativeRequestId ?? "question-1",
      method: "item/tool/requestUserInput",
      params: { threadId: fixture.threadId ?? "thread-1" },
    },
    request: {
      questions: [{ header: "Confirm", question: "Proceed?", options: [] }],
    },
    questionIds: ["question-item-1"],
    input: { questions: [{ header: "Confirm", question: "Proceed?", options: [] }] },
    ...(fixture.route ? { route: fixture.route } : {}),
  });

const route = (
  parentExternalSessionId = "parent-thread",
  childExternalSessionId = "child-thread",
  runtimeId?: string,
): CodexSubagentRoute => ({
  ...(runtimeId ? { runtimeId } : {}),
  parentExternalSessionId,
  childExternalSessionId,
  subagentCorrelationKey: `codex-subagent:${parentExternalSessionId}:${childExternalSessionId}`,
});

describe("CodexPendingInputState", () => {
  test("indexes opaque pending approvals and questions by owning session", () => {
    const pendingInput = new CodexPendingInputState();
    const approval = registerApproval(pendingInput);
    const question = registerQuestion(pendingInput);

    expect(pendingInput.pendingApprovalsForSession("thread-1")).toEqual([approval.entry.request]);
    expect(pendingInput.pendingQuestionsForSession("thread-1")).toEqual([question.entry.request]);
    expect(approval.entry.request.requestId).not.toContain("approval-1");
    expect(question.entry.request.requestId).not.toContain("question-1");
    expect(pendingInput.pendingApprovalsForSession("thread-2")).toEqual([]);
  });

  test("resolves one occurrence without clearing unrelated pending input", () => {
    const pendingInput = new CodexPendingInputState();
    const first = registerApproval(pendingInput);
    const second = registerApproval(pendingInput, {
      threadId: "thread-2",
      nativeRequestId: "approval-2",
    });

    pendingInput.resolveApproval(first.entry.request.requestId);

    expect(pendingInput.approval(first.entry.request.requestId)).toBeUndefined();
    expect(pendingInput.pendingApprovalsForSession("thread-1")).toEqual([]);
    expect(pendingInput.pendingApprovalsForSession("thread-2")).toEqual([second.entry.request]);
  });

  test("keeps identical native ids independent across runtimes", () => {
    const pendingInput = new CodexPendingInputState();
    const first = registerApproval(pendingInput, {
      runtimeId: "runtime-1",
      nativeRequestId: 0,
    });
    const second = registerApproval(pendingInput, {
      runtimeId: "runtime-2",
      nativeRequestId: 0,
    });

    expect(first.entry.request.requestId).not.toBe(second.entry.request.requestId);
    pendingInput.resolveApproval(first.entry.request.requestId, "runtime-1");
    expect(pendingInput.approval(second.entry.request.requestId, "runtime-2")).toBe(second.entry);
  });

  test("keeps identical native ids independent across sessions in one runtime", () => {
    const pendingInput = new CodexPendingInputState();
    const first = registerApproval(pendingInput, { threadId: "thread-1", nativeRequestId: 7 });
    const second = registerApproval(pendingInput, { threadId: "thread-2", nativeRequestId: 7 });

    expect(first.entry.request.requestId).not.toBe(second.entry.request.requestId);
    expect(first.entry.request.requestId).not.toContain("runtime-1");
    expect(first.entry.request.requestId).not.toContain("thread-1");
    expect(first.entry.request.requestId).not.toBe("7");
    expect(pendingInput.nativeRequest("runtime-1", "thread-1", 7)).toEqual({
      kind: "approval",
      entry: first.entry,
    });
    expect(pendingInput.nativeRequest("runtime-1", "thread-2", 7)).toEqual({
      kind: "approval",
      entry: second.entry,
    });
  });

  test("deduplicates an unresolved native request and gives sequential reuse a fresh occurrence", () => {
    const pendingInput = new CodexPendingInputState();
    const fixture = { nativeRequestId: "request-1" };

    const first = registerApproval(pendingInput, fixture);
    const duplicate = registerApproval(pendingInput, fixture);

    expect(first.isNew).toBe(true);
    expect(duplicate.isNew).toBe(false);
    expect(duplicate.entry).toBe(first.entry);
    expect(pendingInput.pendingApprovalsForSession("thread-1")).toEqual([first.entry.request]);

    pendingInput.resolveApproval(first.entry.request.requestId);
    const reused = registerApproval(pendingInput, fixture);

    expect(reused.isNew).toBe(true);
    expect(reused.entry.request.requestId).not.toBe(first.entry.request.requestId);
  });

  test("routes native resolutions by runtime, session, kind, and native id", () => {
    const pendingInput = new CodexPendingInputState();
    const approval = registerApproval(pendingInput, { threadId: "thread-1", nativeRequestId: 0 });
    const question = registerQuestion(pendingInput, { threadId: "thread-2", nativeRequestId: 0 });

    expect(pendingInput.nativeRequest("runtime-1", "thread-1", 0)).toEqual({
      kind: "approval",
      entry: approval.entry,
    });
    expect(pendingInput.nativeRequest("runtime-1", "thread-2", 0)).toEqual({
      kind: "question",
      entry: question.entry,
    });
    expect(pendingInput.nativeRequest("runtime-2", "thread-1", 0)).toBeUndefined();
  });

  test("validates occurrence kind, runtime, session ownership, and liveness", () => {
    const pendingInput = new CodexPendingInputState();
    const approval = registerApproval(pendingInput);

    expect(
      pendingInput.requireApprovalForSession(
        approval.entry.request.requestId,
        "thread-1",
        "runtime-1",
      ),
    ).toBe(approval.entry);
    expect(() =>
      pendingInput.requireQuestionForSession(
        approval.entry.request.requestId,
        "thread-1",
        "runtime-1",
      ),
    ).toThrow("Unknown Codex question request");
    expect(() =>
      pendingInput.requireApprovalForSession(
        approval.entry.request.requestId,
        "thread-1",
        "runtime-2",
      ),
    ).toThrow("Unknown Codex approval request");
    expect(() =>
      pendingInput.requireApprovalForSession(
        approval.entry.request.requestId,
        "thread-2",
        "runtime-1",
      ),
    ).toThrow("belongs to session 'thread-1', not 'thread-2'");

    pendingInput.resolveApproval(approval.entry.request.requestId, "runtime-1");
    expect(() =>
      pendingInput.requireApprovalForSession(
        approval.entry.request.requestId,
        "thread-1",
        "runtime-1",
      ),
    ).toThrow("Unknown Codex approval request");
  });

  test("binds active turns only to pending input from the same runtime", () => {
    const pendingInput = new CodexPendingInputState();
    const first = registerApproval(pendingInput, { runtimeId: "runtime-1" });
    const second = registerApproval(pendingInput, {
      runtimeId: "runtime-2",
      nativeRequestId: "approval-2",
    });
    const activeTurn = {
      session: { threadId: "thread-1", runtimeId: "runtime-1" },
    } as unknown as ActiveCodexTurn;

    pendingInput.bindActiveTurn("thread-1", activeTurn);

    expect(pendingInput.resolveApproval(first.entry.request.requestId, "runtime-1")).toBe(
      activeTurn,
    );
    expect(
      pendingInput.resolveApproval(second.entry.request.requestId, "runtime-2"),
    ).toBeUndefined();
  });

  test("clears pending input only for the released runtime session", () => {
    const pendingInput = new CodexPendingInputState();
    const first = registerApproval(pendingInput, {
      runtimeId: "runtime-1",
      threadId: "shared-thread",
      nativeRequestId: 0,
    });
    const second = registerApproval(pendingInput, {
      runtimeId: "runtime-2",
      threadId: "shared-thread",
      nativeRequestId: 0,
    });

    pendingInput.clearSession("shared-thread", "runtime-1");

    expect(pendingInput.approval(first.entry.request.requestId, "runtime-1")).toBeUndefined();
    expect(pendingInput.approval(second.entry.request.requestId, "runtime-2")).toBe(second.entry);
  });

  test("mirrors child pending input to its parent while preserving owner reply routing", () => {
    const pendingInput = new CodexPendingInputState();
    const childRoute = route();
    const approval = registerApproval(pendingInput, {
      threadId: "child-thread",
      route: childRoute,
    });
    const question = registerQuestion(pendingInput, {
      threadId: "child-thread",
      route: childRoute,
    });

    expect(pendingInput.pendingApprovalsForSession("parent-thread")).toEqual([]);
    expect(pendingInput.pendingApprovalEventsForSession("parent-thread")).toEqual([
      { request: approval.entry.request, route: childRoute },
    ]);
    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toEqual([
      { request: question.entry.request, route: childRoute },
    ]);
    expect(
      pendingInput.requireApprovalForSession(approval.entry.request.requestId, "parent-thread"),
    ).toBe(approval.entry);
  });

  test("adds a learned child route to existing owner-scoped pending input exactly once", () => {
    const pendingInput = new CodexPendingInputState();
    const approval = registerApproval(pendingInput, { threadId: "child-thread" });
    const question = registerQuestion(pendingInput, { threadId: "child-thread" });
    const childRoute = route();

    expect(pendingInput.applyRouteToPendingInput(childRoute)).toEqual({
      approvals: [{ request: approval.entry.request, route: childRoute }],
      questions: [{ request: question.entry.request, route: childRoute }],
    });
    expect(pendingInput.applyRouteToPendingInput(childRoute)).toEqual({
      approvals: [],
      questions: [],
    });
  });

  test("binds mirrored child pending input to an active parent turn", () => {
    const pendingInput = new CodexPendingInputState();
    const childRoute = route();
    const question = registerQuestion(pendingInput, {
      threadId: "child-thread",
      route: childRoute,
    });
    const activeTurn = {
      session: { threadId: "parent-thread", runtimeId: "runtime-1" },
    } as unknown as ActiveCodexTurn;

    pendingInput.bindActiveTurn("parent-thread", activeTurn);

    expect(pendingInput.resolveQuestion(question.entry.request.requestId)).toBe(activeTurn);
  });

  test("clearing a parent mirror preserves child pending input but removes parent turn bindings", () => {
    const pendingInput = new CodexPendingInputState();
    const childRoute = route();
    const approval = registerApproval(pendingInput, {
      threadId: "child-thread",
      route: childRoute,
    });
    const activeParentTurn = {
      session: { threadId: "parent-thread", runtimeId: "runtime-1" },
    } as unknown as ActiveCodexTurn;

    pendingInput.bindActiveTurn("parent-thread", activeParentTurn);
    pendingInput.clearSession("parent-thread", "runtime-1");

    expect(pendingInput.pendingApprovalsForSession("child-thread", "runtime-1")).toEqual([
      approval.entry.request,
    ]);
    expect(
      pendingInput.resolveApproval(approval.entry.request.requestId, "runtime-1"),
    ).toBeUndefined();
  });
});
