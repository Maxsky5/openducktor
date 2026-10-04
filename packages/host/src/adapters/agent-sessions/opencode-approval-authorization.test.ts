import { describe, expect, test } from "bun:test";
import type { AgentRole, RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { Effect } from "effect";
import { createOpenCodeLiveSessionAdapterPreparer } from "./opencode-live-session-adapter";
import {
  createLifecycle,
  createRuntimeHarness,
  ref,
  runtime,
  ignoreObservationLoss,
  unexpectedMcpStatusProbe,
} from "./opencode-live-session-adapter.test-support";

const roles: AgentRole[] = ["spec", "planner", "build", "qa"];
const permittedWrite = {
  spec: "odt_set_spec",
  planner: "odt_set_plan",
  build: "odt_build_completed",
  qa: "odt_qa_approved",
};

describe("OpenCode approval authorization at the host reply boundary", () => {
  test.each(roles)(
    "enforces %s eligibility for native requests and keeps explicit rejection available",
    async (role) => {
      const harness = createRuntimeHarness();
      const prepared = await Effect.runPromise(
        createOpenCodeLiveSessionAdapterPreparer({
          liveSessionLifecycle: createLifecycle([]),
          prepareRuntime: harness.prepareRuntime,
          probeMcpStatus: unexpectedMcpStatusProbe,
        })(runtime, ignoreObservationLoss),
      );
      const adapter = prepared.adapter;
      await Effect.runPromise(
        adapter.resumeSession({
          ...ref,
          resumeMode: "reattach",
          sessionScope: { kind: "workflow", taskId: "task-1", role },
        }),
      );
      await Effect.runPromise(prepared.startForwarding());
      const cases = [
        {
          permission: `functions.openducktor_${permittedWrite[role]}`,
          mutation: "mutating" as const,
          allowed: true,
        },
        { permission: "odt_create_task", mutation: "mutating" as const, allowed: true },
        {
          permission: role === "build" ? "odt_set_plan" : "odt_build_completed",
          mutation: "mutating" as const,
          allowed: false,
        },
        { permission: "openducktor_odt_future_tool", mutation: "unknown" as const, allowed: false },
        { permission: "odt_get_workspaces", mutation: "read_only" as const, allowed: false },
        { permission: "edit", mutation: "mutating" as const, allowed: role === "build" },
        { permission: "bash", mutation: "mutating" as const, allowed: role === "build" },
        { permission: "other_mcp_tool", mutation: "unknown" as const, allowed: true },
      ];
      for (const [index, entry] of cases.entries()) {
        const nativeRequestId = `native-${index}`;
        await harness.emit({
          type: "session_event",
          externalSessionId: ref.externalSessionId,
          event: {
            type: "approval_required",
            externalSessionId: ref.externalSessionId,
            timestamp: "2026-07-16T10:02:00.000Z",
            requestId: nativeRequestId,
            requestType: "permission_grant",
            title: entry.permission,
            action: { name: entry.permission },
            mutation: entry.mutation,
          },
        });
        const read = await Effect.runPromise(adapter.readSnapshot(ref));
        if (read.type !== "live") throw new Error("Expected an attached session");
        const requestId = read.session.pendingApprovals[0]!.requestId;
        const before = harness.approvalReplies.length;
        if (entry.allowed) {
          await Effect.runPromise(
            adapter.replyApproval({ ...ref, requestId, outcome: "approve_session" }),
          );
          expect(harness.approvalReplies.at(-1)).toMatchObject({
            nativeRequestId,
            outcome: "approve_session",
          });
        } else {
          for (const outcome of [
            "approve_once",
            "approve_session",
          ] satisfies RuntimeApprovalReplyOutcome[]) {
            await expect(
              Effect.runPromise(adapter.replyApproval({ ...ref, requestId, outcome })),
            ).rejects.toThrow(`The ${role} role cannot approve`);
          }
          expect(harness.approvalReplies).toHaveLength(before);
          const pending = await Effect.runPromise(adapter.readSnapshot(ref));
          if (pending.type !== "live") throw new Error("Expected pending state to remain live");
          expect(pending.session.pendingApprovals[0]?.requestId).toBe(requestId);
          await Effect.runPromise(adapter.replyApproval({ ...ref, requestId, outcome: "reject" }));
          expect(harness.approvalReplies.at(-1)).toMatchObject({
            nativeRequestId,
            outcome: "reject",
          });
        }
      }
      await Effect.runPromise(prepared.discard());
    },
  );

  test("authorizes child-owned requests through the registered workflow ancestor", async () => {
    const harness = createRuntimeHarness();
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime: harness.prepareRuntime,
        probeMcpStatus: unexpectedMcpStatusProbe,
      })(runtime, ignoreObservationLoss),
    );
    await Effect.runPromise(
      prepared.adapter.resumeSession({
        ...ref,
        resumeMode: "reattach",
        sessionScope: { kind: "workflow", taskId: "task-1", role: "qa" },
      }),
    );
    await Effect.runPromise(prepared.startForwarding());
    const childRef = { ...ref, externalSessionId: "child" };
    await harness.emit({
      type: "session_event",
      externalSessionId: ref.externalSessionId,
      event: {
        type: "approval_required",
        externalSessionId: ref.externalSessionId,
        childExternalSessionId: "child",
        parentExternalSessionId: ref.externalSessionId,
        timestamp: "2026-07-16T10:02:00.000Z",
        requestId: "child-edit",
        requestType: "file_change",
        title: "Edit",
        action: { name: "write" },
        mutation: "mutating",
      },
    });
    const read = await Effect.runPromise(prepared.adapter.readSnapshot(childRef));
    if (read.type !== "live") throw new Error("Expected a child-owned request");
    const requestId = read.session.pendingApprovals[0]!.requestId;
    await expect(
      Effect.runPromise(
        prepared.adapter.replyApproval({ ...childRef, requestId, outcome: "approve_once" }),
      ),
    ).rejects.toThrow("The qa role cannot approve");
    expect(harness.approvalReplies).toEqual([]);
    await Effect.runPromise(
      prepared.adapter.replyApproval({ ...childRef, requestId, outcome: "reject" }),
    );
    expect(harness.approvalReplies[0]).toMatchObject({
      ref: childRef,
      nativeRequestId: "child-edit",
      outcome: "reject",
    });
    await Effect.runPromise(prepared.discard());
  });
});
