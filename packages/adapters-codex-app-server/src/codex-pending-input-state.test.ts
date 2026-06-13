import { describe, expect, test } from "bun:test";
import { CodexPendingInputState } from "./codex-pending-input-state";

const approvalRequest = (requestId: string) => ({
  requestId,
  requestType: "permission_grant" as const,
  title: "Approve read",
});

const questionRequest = (requestId: string) => ({
  requestId,
  questions: [{ header: "Confirm", question: "Proceed?", options: [] }],
});

describe("CodexPendingInputState", () => {
  test("indexes pending approvals and questions by owning session", () => {
    const pendingInput = new CodexPendingInputState();

    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: approvalRequest("approval-1"),
    });
    pendingInput.addQuestion({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: questionRequest("question-1"),
      questionIds: ["question-item-1"],
      input: { requestId: "question-1" },
    });

    expect(pendingInput.pendingApprovalsForSession("thread-1")).toEqual([
      approvalRequest("approval-1"),
    ]);
    expect(pendingInput.pendingQuestionsForSession("thread-1")).toEqual([
      questionRequest("question-1"),
    ]);
    expect(pendingInput.pendingApprovalsForSession("thread-2")).toEqual([]);
    expect(pendingInput.pendingQuestionsForSession("thread-2")).toEqual([]);
  });

  test("resolves one request without clearing unrelated pending input", () => {
    const pendingInput = new CodexPendingInputState();
    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: approvalRequest("approval-1"),
    });
    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "thread-2",
      request: approvalRequest("approval-2"),
    });

    pendingInput.resolveApproval("approval-1");

    expect(pendingInput.approval("approval-1")).toBeUndefined();
    expect(pendingInput.pendingApprovalsForSession("thread-1")).toEqual([]);
    expect(pendingInput.pendingApprovalsForSession("thread-2")).toEqual([
      approvalRequest("approval-2"),
    ]);
  });

  test("requires pending requests to belong to the replying session", () => {
    const pendingInput = new CodexPendingInputState();
    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: approvalRequest("approval-1"),
    });
    pendingInput.addQuestion({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: questionRequest("question-1"),
      questionIds: ["question-item-1"],
      input: { requestId: "question-1" },
    });

    expect(pendingInput.requireApprovalForSession("approval-1", "thread-1")).toMatchObject({
      threadId: "thread-1",
    });
    expect(pendingInput.requireQuestionForSession("question-1", "thread-1")).toMatchObject({
      threadId: "thread-1",
    });
    expect(() => pendingInput.requireApprovalForSession("approval-1", "thread-2")).toThrow(
      "belongs to session 'thread-1', not 'thread-2'",
    );
    expect(() => pendingInput.requireQuestionForSession("question-1", "thread-2")).toThrow(
      "belongs to session 'thread-1', not 'thread-2'",
    );
  });

  test("clears all pending input for one session only", () => {
    const pendingInput = new CodexPendingInputState();
    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: approvalRequest("approval-1"),
    });
    pendingInput.addQuestion({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: questionRequest("question-1"),
      questionIds: ["question-item-1"],
      input: { requestId: "question-1" },
    });
    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "thread-2",
      request: approvalRequest("approval-2"),
    });

    pendingInput.clearSession("thread-1");

    expect(pendingInput.pendingApprovalsForSession("thread-1")).toEqual([]);
    expect(pendingInput.pendingQuestionsForSession("thread-1")).toEqual([]);
    expect(pendingInput.pendingApprovalsForSession("thread-2")).toEqual([
      approvalRequest("approval-2"),
    ]);
  });
});
