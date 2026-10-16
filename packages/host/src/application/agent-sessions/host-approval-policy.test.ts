import { describe, expect, test } from "bun:test";
import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentSessionAuthorizedRoot,
  type AgentSessionLivePendingApprovalRequest,
  type AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { Deferred, Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createHostApprovalPolicy } from "./host-approval-policy";
import { resolveOwnedSessionRoot } from "./session-owner-resolution";

const root: AgentSessionAuthorizedRoot = {
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo/tree",
  externalSessionId: "root",
  sessionScope: { kind: "workflow", taskId: "task-1", role: "qa" },
};
const child = {
  repoPath: root.repoPath,
  runtimeKind: root.runtimeKind,
  workingDirectory: root.workingDirectory,
  externalSessionId: "child",
};
const request: AgentSessionLivePendingApprovalRequest = {
  requestId: "request-1",
  requestType: "command_execution",
  title: "Write a file",
  mutation: "mutating",
  supportedReplyOutcomes: ["approve_once", "reject"],
};
const snapshot = (
  ref = child,
  parentExternalSessionId: string | undefined = "root",
): AgentSessionLiveSnapshot => {
  const result: AgentSessionLiveSnapshot = {
    ref,
    activity: "waiting_for_permission",
    title: "Session",
    startedAt: "2026-10-13T12:00:00Z",
    pendingApprovals: [request],
    pendingQuestions: [],
    contextUsage: null,
  };
  if (parentExternalSessionId) result.parentExternalSessionId = parentExternalSessionId;
  return result;
};

describe("host workflow approval policy", () => {
  test("keeps a failed mutating occurrence visible after an unrelated reply and clears it on native resolution", async () => {
    const failed = Deferred.makeUnsafe<void>();
    const readonly = { ...request, requestId: "read-only", mutation: "read_only" as const };
    const second = { ...request, requestId: "second" };
    let pending = [request, readonly, second];
    let promptReads = 0;
    const faults: Array<string | null> = [];
    const policy = createHostApprovalPolicy({
      live: {
        resolvePendingApproval: (input) =>
          Effect.succeed({
            owner: child,
            root,
            request:
              input.requestId === request.requestId
                ? request
                : input.requestId === second.requestId
                  ? second
                  : readonly,
            runtimeId: "generation-1",
          }),
        list: () =>
          Effect.succeed([
            { ...snapshot(), pendingApprovals: pending },
            { ...snapshot(root, undefined), pendingApprovals: [] },
          ]),
        replyApproval: (input, options) =>
          Effect.suspend(() => {
            if (input.requestId !== second.requestId) return Effect.void;
            options?.onIssued?.();
            return Effect.fail(
              new HostOperationError({
                operation: "reply",
                message: "Second reply acceptance unknown",
              }),
            );
          }),
        reportApprovalPolicyFailure: (_ref, message) =>
          Effect.gen(function* () {
            faults.push(message);
            if (
              message?.includes("Prompt settings unavailable") &&
              message.includes("Second reply acceptance unknown")
            )
              yield* Deferred.succeed(failed, undefined);
          }),
      },
      readRoots: () => Effect.succeed([root]),
      definitions: { listRuntimeDefinitions: () => [RUNTIME_DESCRIPTORS_BY_KIND.codex] },
      preparation: {
        promptOverrides: () =>
          Effect.suspend(() => {
            promptReads += 1;
            return promptReads === 1
              ? Effect.fail(
                  new HostOperationError({
                    operation: "settings",
                    message: "Prompt settings unavailable",
                  }),
                )
              : Effect.succeed({});
          }),
      },
      reportFailure: () => Effect.void,
    });
    try {
      policy.observe({
        type: "session_upsert",
        session: { ...snapshot(), pendingApprovals: pending },
      });
      await Effect.runPromise(Deferred.await(failed));
      policy.observe({
        type: "session_upsert",
        session: {
          ...snapshot(),
          pendingApprovals: [],
          statusUnavailableReason: "Runtime status unavailable",
        },
      });
      await Effect.runPromise(
        policy.reply({ ...child, requestId: readonly.requestId, outcome: "approve_once" }),
      );
      expect(faults.at(-1)).toContain("Prompt settings unavailable");
      pending = [second];
      policy.observe({
        type: "session_upsert",
        session: { ...snapshot(), pendingApprovals: pending },
      });
      await Effect.runPromise(policy.reconcile(root.repoPath));
      expect(faults.at(-1)).toContain("Second reply acceptance unknown");
      expect(faults.at(-1)).not.toContain("Prompt settings unavailable");
      pending = [];
      policy.observe({
        type: "session_upsert",
        session: { ...snapshot(), pendingApprovals: pending },
      });
      await Effect.runPromise(policy.reconcile(root.repoPath));
      expect(faults.at(-1)).toBeNull();
    } finally {
      await Effect.runPromise(policy.shutdown());
    }
  });

  test("rejects a verified QA child with no frontend and shares its claim with an explicit approve", async () => {
    const issued = Deferred.makeUnsafe<void>();
    const finish = Deferred.makeUnsafe<void>();
    const calls: unknown[] = [];
    const failures: string[] = [];
    const policy = createHostApprovalPolicy({
      live: {
        resolvePendingApproval: () =>
          Effect.succeed({ owner: child, root, request, runtimeId: "generation-1" }),
        list: () => Effect.succeed([snapshot(), snapshot(root, undefined)]),
        replyApproval: (input, options) =>
          Effect.gen(function* () {
            calls.push(input);
            options?.onIssued?.();
            yield* Deferred.succeed(issued, undefined);
            yield* Deferred.await(finish);
          }),
        reportApprovalPolicyFailure: (_ref, message) =>
          Effect.sync(() => {
            if (message) failures.push(message);
          }),
      },
      readRoots: () => Effect.succeed([root]),
      definitions: { listRuntimeDefinitions: () => [RUNTIME_DESCRIPTORS_BY_KIND.codex] },
      preparation: { promptOverrides: () => Effect.succeed({}) },
      reportFailure: () => Effect.void,
    });
    try {
      policy.observe({ type: "session_upsert", session: snapshot() });
      await Effect.runPromise(Deferred.await(issued));
      const explicit = Effect.runPromise(
        policy.reply({ ...root, requestId: request.requestId, outcome: "approve_once" }),
      );
      policy.observe({ type: "session_upsert", session: snapshot() });
      await Effect.runPromise(Deferred.succeed(finish, undefined));
      await explicit;
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        externalSessionId: "child",
        outcome: "reject",
        message: expect.any(String),
      });
      expect(failures).toEqual([]);
    } finally {
      await Effect.runPromise(policy.shutdown());
    }
  });

  test("keeps an issued uncertain reply reserved across repeated clients", async () => {
    let calls = 0;
    const policy = createHostApprovalPolicy({
      live: {
        resolvePendingApproval: () =>
          Effect.succeed({ owner: child, root, request, runtimeId: "generation-1" }),
        list: () => Effect.succeed([snapshot(), snapshot(root, undefined)]),
        replyApproval: (_input, options) =>
          Effect.gen(function* () {
            calls += 1;
            options?.onIssued?.();
            return yield* new HostOperationError({ operation: "reply", message: "response lost" });
          }),
        reportApprovalPolicyFailure: () => Effect.void,
      },
      readRoots: () => Effect.succeed([root]),
      definitions: { listRuntimeDefinitions: () => [RUNTIME_DESCRIPTORS_BY_KIND.codex] },
      preparation: { promptOverrides: () => Effect.succeed({}) },
      reportFailure: () => Effect.void,
    });
    try {
      for (let index = 0; index < 2; index += 1) {
        const result = await Effect.runPromise(
          Effect.result(
            policy.reply({ ...child, requestId: request.requestId, outcome: "approve_once" }),
          ),
        );
        expect(result._tag).toBe("Failure");
      }
      expect(calls).toBe(1);
    } finally {
      await Effect.runPromise(policy.shutdown());
    }
  });

  test("a replacement runtime resolves the old occurrence before reusing its native request ID", async () => {
    let runtimeId = "generation-1";
    const cleared = Deferred.makeUnsafe<void>();
    const calls: string[] = [];
    const faults: Array<string | null> = [];
    const policy = createHostApprovalPolicy({
      live: {
        resolvePendingApproval: () => Effect.succeed({ owner: child, root, request, runtimeId }),
        list: () => Effect.succeed([snapshot(), snapshot(root, undefined)]),
        replyApproval: (_input, options) =>
          Effect.gen(function* () {
            calls.push(runtimeId);
            options?.onIssued?.();
            if (runtimeId === "generation-1")
              return yield* new HostOperationError({
                operation: "reply",
                message: "Old reply acceptance unknown",
              });
            yield* Deferred.succeed(cleared, undefined);
          }),
        reportApprovalPolicyFailure: (_ref, message) =>
          Effect.sync(() => {
            faults.push(message);
          }),
      },
      readRoots: () => Effect.succeed([root]),
      definitions: { listRuntimeDefinitions: () => [RUNTIME_DESCRIPTORS_BY_KIND.codex] },
      preparation: { promptOverrides: () => Effect.succeed({}) },
      reportFailure: () => Effect.void,
    });
    try {
      await Effect.runPromise(
        Effect.result(policy.reply({ ...child, requestId: request.requestId, outcome: "reject" })),
      );
      expect(faults.at(-1)).toContain("Old reply acceptance unknown");
      runtimeId = "generation-2";
      policy.observe({ type: "session_upsert", session: snapshot() });
      await Effect.runPromise(Deferred.await(cleared));
      expect(calls).toEqual(["generation-1", "generation-2"]);
      expect(faults.at(-1)).toBeNull();
    } finally {
      await Effect.runPromise(policy.shutdown());
    }
  });

  test.each(["missing parent", "checkout mismatch", "cycle"])(
    "rejects %s without claiming another saved root",
    async (mode) => {
      const sessions =
        mode === "missing parent"
          ? [snapshot(child, "missing")]
          : mode === "checkout mismatch"
            ? [snapshot(), snapshot({ ...root, workingDirectory: "/repo/other" }, undefined)]
            : [
                snapshot(child, "other"),
                snapshot({ ...child, externalSessionId: "other" }, "child"),
              ];
      const result = await Effect.runPromise(
        Effect.result(resolveOwnedSessionRoot({ ref: child, roots: [root], sessions })),
      );
      expect(result._tag).toBe("Failure");
    },
  );

  test("a saved fork keeps its own role before native ancestry", async () => {
    const ownedChild = {
      ...child,
      sessionScope: { kind: "workflow" as const, taskId: "task-2", role: "build" as const },
    };
    expect(
      await Effect.runPromise(
        resolveOwnedSessionRoot({
          ref: child,
          roots: [root, ownedChild],
          sessions: [snapshot(), snapshot(root, undefined)],
        }),
      ),
    ).toEqual(ownedChild);
  });
});
