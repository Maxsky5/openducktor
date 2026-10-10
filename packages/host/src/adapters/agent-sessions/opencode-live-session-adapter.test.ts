import { unexpectedSessionImport } from "../../test-support/session-import-test-doubles";
import { unexpectedRuntimeQueries } from "../../test-support/runtime-query-test-doubles";
import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import { describe, expect, test } from "bun:test";
import { OpenCodeMessageRejectedError } from "@openducktor/adapters-opencode-sdk";
import { AgentSessionMessageRejectedError } from "../../ports/agent-session-send-error";
import type {
  PrepareOpencodeSessionRuntime,
  OpencodeRuntimeSnapshotRead,
  OpencodeRuntimeSnapshotSource,
} from "@openducktor/adapters-opencode-sdk";
import type {
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  AgentSessionTranscriptEvent,
  RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { agentSessionLiveEnvelopeSchema } from "@openducktor/contracts";
import { Effect } from "effect";
import { toAgentSessionLiveEnvelope } from "../../application/agent-sessions/agent-session-live-envelope";
import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveAdapterPort,
} from "../../ports/agent-session-live-adapter-port";
import { createLiveSessionAdapterRegistry } from "./live-session-adapter-registry";
import { createTestOpenCodeLiveSessionAdapterPreparer as createOpenCodeLiveSessionAdapterPreparer } from "./opencode-live-session-adapter.test-support";
import {
  createLifecycle,
  createRuntimeHarness,
  ref,
  runtime,
  ignoreObservationLoss,
} from "./opencode-live-session-adapter.test-support";

describe("createOpenCodeLiveSessionAdapterPreparer", () => {
  test("invalidates queried catalog scopes without live sessions and keeps runtime ownership", async () => {
    const harness = createRuntimeHarness();
    const changes: AgentSessionLiveAdapterChange[] = [];
    const prepare = createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle: createLifecycle(changes),
      prepareRuntime: async (input) => {
        const prepared = await harness.prepareRuntime(input);
        return {
          ...prepared,
          queries: {
            ...prepared.queries,
            loadRuntimeCatalog: async () => ({
              slashCommands: { status: "available", catalog: { commands: [] } },
            }),
          },
        };
      },
    });
    const prepared = await Effect.runPromise(prepare(runtime));
    const scopes = [
      { repoPath: "/repo", workingDirectory: "/repo" },
      { repoPath: "/repo", workingDirectory: "/repo/worktree" },
      { repoPath: "/other", workingDirectory: "/other" },
    ];
    try {
      await Effect.runPromise(prepared.startForwarding());
      for (const scope of [...scopes, scopes[0]!])
        await Effect.runPromise(
          prepared.adapter.queries.loadRuntimeCatalog({ ...scope, runtimeKind: "opencode" }),
        );
      expect(await Effect.runPromise(prepared.adapter.listSnapshots())).toEqual([]);
      await harness.emit({ type: "catalog_invalidated", workingDirectory: "/repo/worktree" });
      await harness.emit({ type: "catalog_invalidated", workingDirectory: "/unknown" });
      await harness.emit({ type: "catalog_invalidated" });
      expect(changes).toEqual([
        {
          type: "catalog_invalidated",
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/repo/worktree",
        },
        { type: "catalog_invalidated", repoPath: "/repo", runtimeKind: "opencode" },
        { type: "catalog_invalidated", repoPath: "/other", runtimeKind: "opencode" },
      ]);
      await Effect.runPromise(
        prepared.adapter.resumeSession({
          ...ref,
          repoPath: "/live-only",
          workingDirectory: "/live-only",
          resumeMode: "reattach",
          sessionScope: { kind: "repository" },
        }),
      );
      changes.length = 0;
      await harness.emit({ type: "catalog_invalidated", workingDirectory: "/live-only" });
      expect(changes).toEqual([
        {
          type: "catalog_invalidated",
          repoPath: "/live-only",
          runtimeKind: "opencode",
          workingDirectory: "/live-only",
        },
      ]);
    } finally {
      await Effect.runPromise(prepared.discard());
    }
    const replacement = await Effect.runPromise(prepare({ ...runtime, runtimeId: "runtime-2" }));
    try {
      await Effect.runPromise(replacement.startForwarding());
      changes.length = 0;
      await harness.emit({ type: "catalog_invalidated" });
      expect(changes).toEqual([]);
    } finally {
      await Effect.runPromise(replacement.discard());
    }
  });

  test.each(["rejected", "unknown"] as const)(
    "preserves %s acceptance for a failed OpenCode send",
    async (acceptance) => {
      const cause = new Error("OpenCode send failed");
      const error = acceptance === "rejected" ? new OpenCodeMessageRejectedError(cause) : cause;
      const send = Promise.withResolvers<void>();
      const harness = createRuntimeHarness({
        sendUserMessageBarrier: send.promise,
        onSendUserMessage: () => send.reject(error),
      });
      const prepared = await Effect.runPromise(
        createOpenCodeLiveSessionAdapterPreparer({
          liveSessionLifecycle: createLifecycle([]),
          prepareRuntime: harness.prepareRuntime,
        })(runtime, ignoreObservationLoss),
      );
      try {
        const result = await Effect.runPromise(
          Effect.result(
            prepared.adapter.sendUserMessage({
              ...ref,
              sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
              parts: [{ kind: "text", text: "Continue implementation" }],
            }),
          ),
        );
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.failure instanceof AgentSessionMessageRejectedError).toBe(
            acceptance === "rejected",
          );
          expect(result.failure.message).toContain(cause.message);
          expect(result.failure.cause).toBe(error);
        }
      } finally {
        await Effect.runPromise(prepared.discard());
      }
    },
  );

  test("routes a child setup fault to its parent without releasing runtime registrations", async () => {
    const harness = createRuntimeHarness();
    const changes: AgentSessionLiveAdapterChange[] = [];
    const lost: string[] = [];
    const releases: string[] = [];
    const lifecycle = createLifecycle(changes);
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: {
          ...lifecycle,
          releaseRuntime: (runtimeId) =>
            Effect.sync(() => {
              releases.push(runtimeId);
              return [];
            }),
        },
        prepareRuntime: harness.prepareRuntime,
      })(runtime, {
        ...ignoreObservationLoss,
        onObservationLost: (message) => {
          lost.push(message);
        },
      }),
    );
    const other = {
      ...ref,
      repoPath: "/other",
      workingDirectory: "/other",
      externalSessionId: "session-2",
    };
    try {
      for (const session of [ref, other])
        await Effect.runPromise(
          prepared.adapter.resumeSession({
            ...session,
            resumeMode: "reattach",
            sessionScope: { kind: "repository" },
          }),
        );
      await Effect.runPromise(prepared.startForwarding());
      const before = await Effect.runPromise(prepared.adapter.listSnapshots());
      changes.length = 0;
      await harness.emit({
        type: "session_fault",
        externalSessionId: ref.externalSessionId,
        message: "Child workflow instructions failed. Reopen this workflow.",
      });
      expect(
        changes.map((change) =>
          agentSessionLiveEnvelopeSchema.parse(toAgentSessionLiveEnvelope(change)),
        ),
      ).toEqual([
        {
          type: "fault",
          repoPath: ref.repoPath,
          ref,
          operation: "opencode-live-session.observe-session",
          message: "Child workflow instructions failed. Reopen this workflow.",
        },
      ]);
      expect(await Effect.runPromise(prepared.adapter.listSnapshots())).toEqual(before);
      expect(lost).toEqual([]);
      expect(releases).toEqual([]);
      await harness.emit({
        type: "session_event",
        externalSessionId: other.externalSessionId,
        event: {
          type: "session_idle",
          externalSessionId: other.externalSessionId,
          timestamp: "2026-10-09T10:00:00.000Z",
        },
      });
      expect(
        (await Effect.runPromise(prepared.adapter.listSnapshots())).find(
          (snapshot) => snapshot.ref.externalSessionId === other.externalSessionId,
        )?.activity,
      ).toBe("idle");
      await Effect.runPromise(prepared.adapter.stopSession(other));
      expect(harness.controlCalls.at(-1)).toEqual({ operation: "stop", input: other });
    } finally {
      await Effect.runPromise(prepared.adapter.releaseRuntime());
    }
  });

  test("replays completed subagent history without settling current live work", async () => {
    const harness = createRuntimeHarness();
    const changes: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(changes),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    const event = {
      type: "assistant_part" as const,
      externalSessionId: ref.externalSessionId,
      timestamp: "2026-07-16T10:02:01.000Z",
      part: {
        kind: "subagent" as const,
        messageId: "msg_parent",
        partId: "call_child:subagent",
        correlationKey: "call_child",
        externalSessionId: "ses_child",
        status: "running" as const,
      },
    };
    try {
      await Effect.runPromise(
        prepared.adapter.resumeSession({
          ...ref,
          resumeMode: "reattach",
          sessionScope: { kind: "repository" },
        }),
      );
      await Effect.runPromise(prepared.startForwarding());
      await harness.emit({
        type: "session_event",
        externalSessionId: ref.externalSessionId,
        event,
      });
      changes.length = 0;
      await harness.emit({
        type: "session_event",
        externalSessionId: ref.externalSessionId,
        provenance: "baseline",
        event: { ...event, part: { ...event.part, status: "completed" } },
      });
      expect(
        (await Effect.runPromise(prepared.adapter.listSnapshots())).find(
          (session) => session.ref.externalSessionId === "ses_child",
        )?.activity,
      ).toBe("running");
      expect(
        changes.map((change) =>
          agentSessionLiveEnvelopeSchema.parse(toAgentSessionLiveEnvelope(change)),
        ),
      ).toEqual([
        {
          type: "transcript_event",
          provenance: "baseline",
          event: { ...event, sessionRef: ref, part: { ...event.part, status: "completed" } },
        },
      ]);
      await harness.emit({
        type: "session_event",
        externalSessionId: ref.externalSessionId,
        event: { ...event, part: { ...event.part, status: "completed" } },
      });
      expect(
        (await Effect.runPromise(prepared.adapter.listSnapshots())).find(
          (session) => session.ref.externalSessionId === "ses_child",
        )?.activity,
      ).toBe("idle");
    } finally {
      await Effect.runPromise(prepared.adapter.releaseRuntime());
    }
  });

  for (const operation of ["stopSession", "releaseSession"] as const) {
    test(`starts native ${operation} while a root snapshot read is pending`, async () => {
      const harness = createRuntimeHarness();
      let markReadStarted: () => void = () => undefined;
      let finishRead: () => void = () => undefined;
      let markControlStarted: () => void = () => undefined;
      const readStarted = new Promise<void>((resolve) => {
        markReadStarted = resolve;
      });
      const readGate = new Promise<void>((resolve) => {
        finishRead = resolve;
      });
      const controlStarted = new Promise<void>((resolve) => {
        markControlStarted = resolve;
      });
      const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
        const native = await harness.prepareRuntime(input);
        return {
          ...native,
          connection: {
            ...native.connection,
            readSessionSources: async () => {
              markReadStarted();
              await readGate;
              return { sources: [], failures: [] };
            },
            [operation]: async (ref: AgentSessionLiveRef) => {
              markControlStarted();
              await native.connection[operation](ref);
            },
          },
        };
      };
      const prepared = await Effect.runPromise(
        createOpenCodeLiveSessionAdapterPreparer({
          liveSessionLifecycle: createLifecycle([]),
          prepareRuntime,
        })(runtime),
      );
      if (!prepared.adapter.refreshSnapshots) throw new Error("Expected snapshot support");
      const refresh = Effect.runPromise(prepared.adapter.refreshSnapshots(ref.repoPath, []));
      await readStarted;
      const control = Effect.runPromise(prepared.adapter[operation](ref));
      const startedBeforeReadFinished = await Promise.race([
        controlStarted.then(() => true),
        Bun.sleep(200).then(() => false),
      ]);
      finishRead();
      await Promise.all([refresh, control]);
      expect(startedBeforeReadFinished).toBe(true);
      expect(harness.controlCalls).toMatchObject([
        { operation: operation === "stopSession" ? "stop" : "release", input: ref },
      ]);
      await Effect.runPromise(prepared.adapter.releaseRuntime());
    });
  }
  test("cancels native reads before waiting for a runtime snapshot lane on release", async () => {
    const harness = createRuntimeHarness();
    let markReadStarted: () => void = () => undefined;
    let finishRead: () => void = () => undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const readGate = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const native = await harness.prepareRuntime(input);
      return {
        ...native,
        connection: {
          ...native.connection,
          readSessionSources: async () => {
            markReadStarted();
            await readGate;
            return { sources: [], failures: [] };
          },
        },
        release: async () => {
          finishRead();
          await native.release();
        },
      };
    };
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime,
      })(runtime),
    );
    if (!prepared.adapter.refreshSnapshots) throw new Error("Expected snapshot support");
    const refresh = Effect.runPromise(prepared.adapter.refreshSnapshots(ref.repoPath, []));
    await readStarted;
    const release = Effect.runPromise(prepared.adapter.releaseRuntime());
    const releasedWithoutReadCompletion = await Promise.race([
      release.then(() => true),
      Bun.sleep(200).then(() => false),
    ]);
    finishRead();
    await Promise.allSettled([refresh, release]);
    expect(releasedWithoutReadCompletion).toBe(true);
    expect(harness.releaseCalls).toEqual([runtime.runtimeId]);
  });
  test("publishes parked native messages from the initial source without sending input", async () => {
    const changes: AgentSessionLiveAdapterChange[] = [];
    const harness = createRuntimeHarness({
      sessionSources: [
        {
          externalSessionId: ref.externalSessionId,
          repoPath: ref.repoPath,
          workingDirectory: ref.workingDirectory,
          sessionAssociation: { kind: "repository" },
          title: "Linked conversation",
          startedAt: "2026-07-16T10:00:00.000Z",
          runtimeActivity: "idle",
          pendingApprovals: [],
          pendingQuestions: [],
          queuedMessages: [
            {
              type: "user_message",
              externalSessionId: ref.externalSessionId,
              timestamp: "2026-07-16T10:00:00.000Z",
              messageId: "msg_parked",
              message: "Keep queued",
              parts: [{ kind: "text", text: "Keep queued" }],
              state: "queued",
            },
          ],
        },
      ],
    });
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(changes),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    try {
      if (!prepared.adapter.refreshSnapshots) throw new Error("Expected snapshot support");
      await Effect.runPromise(prepared.adapter.refreshSnapshots(ref.repoPath));
      expect(changes).toContainEqual(
        expect.objectContaining({
          type: "transcript_event",
          event: expect.objectContaining({
            messageId: "msg_parked",
            state: "queued",
            sessionRef: ref,
          }),
        }),
      );
      expect(harness.controlCalls).toEqual([]);
    } finally {
      await Effect.runPromise(prepared.adapter.releaseRuntime());
    }
  });
  test("invalidates old pending occurrences on reconnect even when native IDs stay the same", async () => {
    const harness = createRuntimeHarness();
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime: harness.prepareRuntime,
      })(runtime),
    );
    try {
      await Effect.runPromise(
        prepared.adapter.resumeSession({
          ...ref,
          resumeMode: "reattach",
          sessionScope: { kind: "repository" },
        }),
      );
      await Effect.runPromise(prepared.startForwarding());
      const source: OpencodeRuntimeSnapshotSource = {
        repoPath: ref.repoPath,
        externalSessionId: ref.externalSessionId,
        workingDirectory: ref.workingDirectory,
        sessionAssociation: { kind: "repository" as const },
        title: "Linked",
        startedAt: "2026-07-16T10:00:00.000Z",
        runtimeActivity: "idle" as const,
        pendingApprovals: [
          {
            requestId: "permission_native",
            requestType: "permission_grant" as const,
            title: "Run check",
            action: { name: "shell" },
            supportedReplyOutcomes: ["approve_once", "approve_always", "reject"],
            rejectsAllPendingApprovals: true,
            persistentGrant: {
              scope: "project" as const,
              projectDirectory: "/repo",
              rules: [{ action: "shell", resource: "bun test*" }],
            },
          },
        ],
        pendingQuestions: [
          {
            requestId: "form_native",
            questions: [{ header: "Check", question: "Continue?", options: [] }],
          },
        ],
      };
      await harness.emit({ type: "session_source", source });
      const approval = (await Effect.runPromise(prepared.adapter.listSnapshots()))[0]
        ?.pendingApprovals[0];
      expect(approval).toMatchObject({
        rejectsAllPendingApprovals: true,
        supportedReplyOutcomes: ["approve_once", "approve_always", "reject"],
        persistentGrant: {
          scope: "project",
          projectDirectory: "/repo",
          rules: [{ action: "shell", resource: "bun test*" }],
        },
      });
      const oldID = approval?.requestId;
      if (!oldID) throw new Error("Expected old occurrence");
      await harness.emit({ type: "observation_reset" });
      await harness.emit({
        type: "session_fault",
        externalSessionId: ref.externalSessionId,
        message: "Native restore failed.",
        statusUnavailable: true,
      });
      expect((await Effect.runPromise(prepared.adapter.listSnapshots()))[0]).toMatchObject({
        statusUnavailableReason: "Native restore failed.",
        pendingApprovals: [],
        pendingQuestions: [],
      });
      await harness.emit({ type: "session_source", source });
      const newID = (await Effect.runPromise(prepared.adapter.listSnapshots()))[0]
        ?.pendingApprovals[0]?.requestId;
      expect(newID).not.toBe(oldID);
      await expect(
        Effect.runPromise(
          prepared.adapter.replyApproval({ ...ref, requestId: oldID, outcome: "approve_once" }),
        ),
      ).rejects.toThrow("Unknown or resolved");
      expect(harness.approvalReplies).toEqual([]);
      if (!newID) throw new Error("Expected new occurrence");
      await Effect.runPromise(
        prepared.adapter.replyApproval({ ...ref, requestId: newID, outcome: "approve_once" }),
      );
      expect(harness.approvalReplies[0]).toMatchObject({ nativeRequestId: "permission_native" });
    } finally {
      await Effect.runPromise(prepared.adapter.releaseRuntime());
    }
  });

  test("loads every OpenCode session for task matching", async () => {
    const harness = createRuntimeHarness({
      sessionSources: [
        {
          repoPath: ref.repoPath,
          externalSessionId: ref.externalSessionId,
          workingDirectory: ref.workingDirectory,
          sessionAssociation: { kind: "unbound" },
          title: "Known builder",
          startedAt: "2026-07-16T10:00:00.000Z",
          runtimeActivity: "running",
          pendingApprovals: [
            {
              requestId: "permission-1",
              requestType: "file_change",
              title: "Edit a file",
            },
          ],
          pendingQuestions: [],
        },
      ],
    });
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime: harness.prepareRuntime,
      })(runtime, ignoreObservationLoss),
    );

    const refreshSnapshots = prepared.adapter.refreshSnapshots;
    if (!refreshSnapshots) {
      throw new Error("Expected OpenCode to support runtime snapshot refresh.");
    }
    await Effect.runPromise(refreshSnapshots(ref.repoPath));

    expect(harness.sessionSourceReadCalls).toBe(1);
    await expect(Effect.runPromise(prepared.adapter.listSnapshots())).resolves.toEqual([
      expect.objectContaining({
        ref,
        activity: "waiting_for_permission",
        pendingApprovals: [expect.objectContaining({ requestId: "opencode-pending-1" })],
      }),
    ]);
  });

  test.each(["root", "child"] as const)(
    "retains unread descendants and their approvals when the %s refresh fails",
    async (failedAncestor) => {
      const childRef = { ...ref, externalSessionId: "child" };
      const grandchildRef = { ...ref, externalSessionId: "grandchild" };
      const siblingRef = { ...ref, externalSessionId: "sibling" };
      const healthyRef = { ...ref, externalSessionId: "healthy" };
      const source = (
        sessionRef: AgentSessionLiveRef,
        parentExternalSessionId?: string,
      ): OpencodeRuntimeSnapshotSource => {
        const result: OpencodeRuntimeSnapshotSource = {
          ...sessionRef,
          sessionAssociation: { kind: "repository" },
          title: `Known ${sessionRef.externalSessionId}`,
          startedAt: "2026-07-16T10:00:00.000Z",
          runtimeActivity: "running",
          pendingApprovals: [],
          pendingQuestions: [],
        };
        if (parentExternalSessionId) result.parentExternalSessionId = parentExternalSessionId;
        return result;
      };
      const sources = [
        source(ref),
        source(childRef, ref.externalSessionId),
        {
          ...source(grandchildRef, childRef.externalSessionId),
          pendingApprovals: [
            { requestId: "child-permission", requestType: "file_change" as const, title: "Edit" },
          ],
        },
        source(siblingRef, ref.externalSessionId),
        source(healthyRef),
      ];
      let nextRead: OpencodeRuntimeSnapshotRead = { sources, failures: [] };
      let readGate: Promise<void> | undefined;
      let onRead: () => void = () => undefined;
      const harness = createRuntimeHarness({
        readSessionSources: async () => {
          const result = nextRead;
          onRead();
          await readGate;
          return result;
        },
      });
      const changes: AgentSessionLiveAdapterChange[] = [];
      const prepared = await Effect.runPromise(
        createOpenCodeLiveSessionAdapterPreparer({
          liveSessionLifecycle: createLifecycle(changes),
          prepareRuntime: harness.prepareRuntime,
        })(runtime, ignoreObservationLoss),
      );
      try {
        const adapter = prepared.adapter;
        const refreshSnapshots = adapter.refreshSnapshots;
        if (!refreshSnapshots) throw new Error("Expected OpenCode snapshot refresh.");
        const refresh = () => Effect.runPromise(refreshSnapshots(ref.repoPath));
        await Effect.runPromise(prepared.startForwarding());
        await refresh();
        const initial = await Effect.runPromise(adapter.listSnapshots());
        expect(initial).toHaveLength(5);
        const approvalID = initial.find(
          (snapshot) => snapshot.ref.externalSessionId === "grandchild",
        )?.pendingApprovals[0]?.requestId;
        if (!approvalID) throw new Error("Expected the grandchild approval.");

        const otherRepoRef = {
          ...ref,
          repoPath: "/other-repo",
          workingDirectory: "/other-repo/worktree",
          externalSessionId: "other-repo-child",
        };
        const otherDirectoryRef = {
          ...ref,
          workingDirectory: "/repo/other-worktree",
          externalSessionId: "other-directory-child",
        };
        for (const sessionRef of [otherRepoRef, otherDirectoryRef])
          await harness.emit({
            type: "session_source",
            source: source(sessionRef, ref.externalSessionId),
          });

        const failedRef = failedAncestor === "root" ? ref : childRef;
        nextRead = {
          sources: [
            ...(failedAncestor === "child"
              ? [source(ref), source(siblingRef, ref.externalSessionId)]
              : []),
            { ...source(healthyRef), title: "Updated healthy root" },
          ],
          failures: [{ ...failedRef, message: "Native read failed." }],
        };
        const started = Promise.withResolvers<void>();
        const gate = Promise.withResolvers<void>();
        onRead = () => started.resolve();
        readGate = gate.promise;
        const refreshing = refresh();
        try {
          await started.promise;
          await harness.emit({
            type: "session_event",
            externalSessionId: childRef.externalSessionId,
            event: {
              type: "session_idle",
              externalSessionId: childRef.externalSessionId,
              timestamp: "2026-07-16T10:02:00.000Z",
            },
          });
        } finally {
          gate.resolve();
        }
        await refreshing;
        readGate = undefined;
        const retained = await Effect.runPromise(adapter.listSnapshots());
        expect(retained.map(({ ref: sessionRef }) => sessionRef.externalSessionId).sort()).toEqual([
          "child",
          "grandchild",
          "healthy",
          "other-repo-child",
          "session-1",
          "sibling",
        ]);
        const retainedChild = retained.find(
          ({ ref: sessionRef }) => sessionRef.externalSessionId === "child",
        );
        expect(retainedChild).toMatchObject({ activity: "idle" });
        expect(retainedChild?.statusUnavailableReason).toBeUndefined();
        expect(
          retained.find(({ ref: sessionRef }) => sessionRef.externalSessionId === "grandchild"),
        ).toMatchObject({
          pendingApprovals: [{ requestId: approvalID }],
          statusUnavailableReason: expect.stringContaining("Native read failed."),
        });
        const healthy = retained.find(
          ({ ref: sessionRef }) => sessionRef.externalSessionId === "healthy",
        );
        expect(healthy).toMatchObject({ title: "Updated healthy root" });
        expect(healthy?.statusUnavailableReason).toBeUndefined();
        expect(changes).toContainEqual({
          type: "session_removed",
          ref: otherDirectoryRef,
          provenance: "baseline",
        });

        await harness.emit({
          type: "session_event",
          externalSessionId: grandchildRef.externalSessionId,
          event: {
            type: "session_status",
            externalSessionId: grandchildRef.externalSessionId,
            timestamp: "2026-07-16T10:03:00.000Z",
            status: { type: "busy", message: null },
          },
        });
        const confirmed = await Effect.runPromise(adapter.readSnapshot(grandchildRef));
        expect(confirmed).toMatchObject({
          type: "live",
          session: {
            pendingApprovals: [{ requestId: approvalID }],
          },
        });
        if (confirmed.type !== "live") throw new Error("Expected the retained grandchild.");
        expect(confirmed.session.statusUnavailableReason).toBeUndefined();
        await Effect.runPromise(
          adapter.replyApproval({
            ...grandchildRef,
            requestId: approvalID,
            outcome: "approve_once",
          }),
        );
        expect(harness.approvalReplies).toEqual([
          { ref: grandchildRef, nativeRequestId: "child-permission", outcome: "approve_once" },
        ]);

        nextRead = {
          sources: sources.map((item) => ({ ...item, pendingApprovals: [] })),
          failures: [],
        };
        await refresh();
        expect(
          (await Effect.runPromise(adapter.listSnapshots())).every(
            (snapshot) => snapshot.statusUnavailableReason === undefined,
          ),
        ).toBe(true);
        await harness.emit({ type: "session_removed", externalSessionId: "grandchild" });
        expect(await Effect.runPromise(adapter.readSnapshot(grandchildRef))).toEqual({
          type: "missing",
          ref: grandchildRef,
        });
        nextRead = { sources: [source(ref), source(healthyRef)], failures: [] };
        await refresh();
        expect(
          (await Effect.runPromise(adapter.listSnapshots()))
            .map(({ ref: sessionRef }) => sessionRef.externalSessionId)
            .sort(),
        ).toEqual(["healthy", "other-repo-child", "session-1"]);
      } finally {
        await Effect.runPromise(prepared.adapter.releaseRuntime());
      }
    },
  );

  test("removes current state when OpenCode deletes an owned session", async () => {
    const harness = createRuntimeHarness();
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime, ignoreObservationLoss),
    );
    await Effect.runPromise(
      prepared.adapter.resumeSession({
        resumeMode: "reattach",
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );
    await Effect.runPromise(prepared.startForwarding());

    await harness.emit({ type: "session_removed", externalSessionId: ref.externalSessionId });

    await expect(Effect.runPromise(prepared.adapter.listSnapshots())).resolves.toEqual([]);
    expect(publishedChanges).toContainEqual({ type: "session_removed", ref });
  });

  test("owns strict snapshots, opaque replies, current context, and normalized signals", async () => {
    const harness = createRuntimeHarness();
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime, ignoreObservationLoss),
    );
    const adapter = prepared.adapter;
    await Effect.runPromise(
      adapter.resumeSession({
        resumeMode: "reattach",
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );
    await Effect.runPromise(prepared.startForwarding());
    await harness.emit({
      type: "session_event",
      externalSessionId: "session-1",
      event: {
        type: "approval_required",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:02:00.000Z",
        requestId: "permission-1",
        requestType: "file_change",
        title: "Edit a file",
      },
    });
    await harness.emit({
      type: "session_event",
      externalSessionId: "session-1",
      event: {
        type: "question_required",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:02:01.000Z",
        requestId: "question-1",
        questions: [
          {
            header: "Confirm",
            question: "Continue?",
            options: [{ label: "Yes", description: "Continue" }],
          },
        ],
      },
    });
    await harness.emit({
      type: "context_updated",
      externalSessionId: "session-1",
      contextUsage: {
        totalTokens: 321,
        model: { providerId: "openai", modelId: "gpt-5", variant: "high" },
      },
    });

    const snapshots = await Effect.runPromise(adapter.listSnapshots());
    expect(snapshots).toEqual([
      {
        ref,
        activity: "waiting_for_question",
        title: "Controlled session",
        startedAt: "2026-07-16T10:02:00.000Z",
        pendingApprovals: [
          {
            requestId: "opencode-pending-1",
            requestType: "file_change",
            title: "Edit a file",
          },
        ],
        pendingQuestions: [
          {
            requestId: "opencode-pending-2",
            questions: [
              {
                header: "Confirm",
                question: "Continue?",
                options: [{ label: "Yes", description: "Continue" }],
              },
            ],
          },
        ],
        contextUsage: {
          totalTokens: 321,
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
        },
      } satisfies AgentSessionLiveSnapshot,
    ]);
    await expect(Effect.runPromise(adapter.loadContext(ref))).resolves.toEqual({
      totalTokens: 321,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    });
    expect(harness.contextLoadCalls).toEqual([]);

    publishedChanges.length = 0;
    await Effect.runPromise(
      adapter.replyApproval({
        ...ref,
        requestId: "opencode-pending-1",
        outcome: "approve_once",
      }),
    );
    await Effect.runPromise(
      adapter.replyQuestion({
        ...ref,
        requestId: "opencode-pending-2",
        answers: [["Yes"]],
      }),
    );
    expect(harness.approvalReplies).toEqual([
      {
        ref,
        nativeRequestId: "permission-1",
        outcome: "approve_once",
      },
    ]);
    expect(harness.questionReplies).toEqual([
      {
        ref,
        nativeRequestId: "question-1",
        answers: [["Yes"]],
      },
    ]);
    expect(publishedChanges.filter((change) => change.type === "session_upsert")).toHaveLength(2);

    publishedChanges.length = 0;
    const transcriptEvent = {
      type: "assistant_delta",
      externalSessionId: "session-1",
      timestamp: "2026-07-16T10:04:00.000Z",
      channel: "text",
      delta: "hello",
    } satisfies Omit<
      Extract<AgentSessionTranscriptEvent, { type: "assistant_delta" }>,
      "sessionRef"
    >;
    await harness.emit({
      type: "session_event",
      externalSessionId: "session-1",
      event: transcriptEvent,
    });
    await harness.emit({
      type: "fault",
      message: "OpenCode live event observation failed: connection lost",
    });
    expect(publishedChanges).toEqual([
      {
        type: "transcript_event",
        event: { ...transcriptEvent, sessionRef: ref },
      },
      {
        type: "fault",
        repoPath: "/repo",
        operation: "opencode-live-session.observe-runtime",
        message: "OpenCode live event observation failed: connection lost",
      },
    ]);
  });

  test("clears current pending input when a session errors", async () => {
    const harness = createRuntimeHarness();
    const publishedChanges: AgentSessionLiveAdapterChange[] = [];
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle(publishedChanges),
        prepareRuntime: harness.prepareRuntime,
      })(runtime, ignoreObservationLoss),
    );
    const adapter = prepared.adapter;
    await Effect.runPromise(
      adapter.resumeSession({
        resumeMode: "reattach",
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );
    await Effect.runPromise(prepared.startForwarding());
    await harness.emit({
      type: "session_event",
      externalSessionId: "session-1",
      event: {
        type: "approval_required",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:02:00.000Z",
        requestId: "permission-1",
        requestType: "file_change",
        title: "Edit a file",
      },
    });
    const before = await Effect.runPromise(adapter.readSnapshot(ref));
    if (before.type !== "live") {
      throw new Error("Expected the OpenCode session to be current.");
    }
    const approvalRequestId = before.session.pendingApprovals[0]?.requestId;
    if (!approvalRequestId) {
      throw new Error("Expected a pending OpenCode approval.");
    }

    await Effect.runPromise(prepared.startForwarding());
    await harness.emit({
      type: "session_event",
      externalSessionId: "session-1",
      event: {
        type: "session_error",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:04:00.000Z",
        message: "Turn failed.",
      },
    });

    await expect(Effect.runPromise(adapter.readSnapshot(ref))).resolves.toMatchObject({
      type: "live",
      session: {
        activity: "idle",
        pendingApprovals: [],
        pendingQuestions: [],
      },
    });
    await expect(
      Effect.runPromise(
        adapter.replyApproval({
          ...ref,
          requestId: approvalRequestId,
          outcome: "approve_once",
        }),
      ),
    ).rejects.toThrow("Unknown or resolved OpenCode approval occurrence");
    expect(publishedChanges).toContainEqual({
      type: "session_upsert",
      snapshot: expect.objectContaining({
        ref,
        activity: "idle",
        pendingApprovals: [],
        pendingQuestions: [],
      }),
    });

    await Effect.runPromise(adapter.releaseRuntime());
  });

  test("does not restore a released session when an earlier runtime refresh finishes", async () => {
    const harness = createRuntimeHarness({
      sessionSources: [
        {
          repoPath: ref.repoPath,
          externalSessionId: ref.externalSessionId,
          workingDirectory: ref.workingDirectory,
          sessionAssociation: { kind: "unbound" },
          title: "Known builder",
          startedAt: "2026-07-16T10:00:00.000Z",
          runtimeActivity: "idle",
          pendingApprovals: [],
          pendingQuestions: [],
        },
      ],
    });
    let markReadStarted: () => void = () => undefined;
    let finishRead: () => void = () => undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const readGate = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    const basePrepare = harness.prepareRuntime;
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await basePrepare(input);
      return {
        ...prepared,
        connection: {
          ...prepared.connection,
          readSessionSources: async (repoPath, roots) => {
            markReadStarted();
            await readGate;
            return prepared.connection.readSessionSources(repoPath, roots);
          },
        },
      };
    };
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime,
      })(runtime, ignoreObservationLoss),
    );
    await Effect.runPromise(
      prepared.adapter.resumeSession({
        resumeMode: "reattach",
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );
    const refreshSnapshots = prepared.adapter.refreshSnapshots;
    if (!refreshSnapshots) {
      throw new Error("Expected OpenCode to support runtime snapshot refresh.");
    }

    const refresh = Effect.runPromise(refreshSnapshots(ref.repoPath));
    await readStarted;
    const release = Effect.runPromise(prepared.adapter.releaseSession(ref));
    const releaseFinishedWhileReadWaited = await Promise.race([
      release.then(() => true),
      Bun.sleep(200).then(() => false),
    ]);
    finishRead();
    await Promise.all([refresh, release]);

    expect(releaseFinishedWhileReadWaited).toBe(true);
    await expect(Effect.runPromise(prepared.adapter.readSnapshot(ref))).resolves.toEqual({
      type: "missing",
      ref,
    });
    await Effect.runPromise(prepared.adapter.releaseRuntime());
  });

  test("keeps missing-context work demand-driven and shares one in-flight request", async () => {
    const harness = createRuntimeHarness();
    let resolveContext: (value: { totalTokens: number }) => void = () => undefined;
    const contextGate = new Promise<{ totalTokens: number }>((resolve) => {
      resolveContext = resolve;
    });
    const originalPrepare = harness.prepareRuntime;
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await originalPrepare(input);
      return {
        ...prepared,
        connection: {
          ...prepared.connection,
          loadContextUsage: async (sessionRef) => {
            harness.contextLoadCalls.push(sessionRef.externalSessionId);
            return contextGate;
          },
        },
      };
    };
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime,
      })(runtime, ignoreObservationLoss),
    );
    const adapter = prepared.adapter;

    const first = Effect.runPromise(adapter.loadContext(ref));
    const second = Effect.runPromise(adapter.loadContext(ref));
    expect(harness.contextLoadCalls).toEqual(["session-1"]);
    resolveContext({ totalTokens: 77 });

    await expect(first).resolves.toEqual({ totalTokens: 77 });
    await expect(second).resolves.toEqual({ totalTokens: 77 });
    expect(harness.contextLoadCalls).toEqual(["session-1"]);
  });

  test.each(["measured", "unavailable"])(
    "does not restore stale context after compaction clears %s usage during a read",
    async (previousUsage) => {
      const harness = createRuntimeHarness();
      const started = Promise.withResolvers<void>();
      const finish = Promise.withResolvers<{ totalTokens: number }>();
      const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
        const native = await harness.prepareRuntime(input);
        return {
          ...native,
          connection: {
            ...native.connection,
            loadContextUsage: () => {
              started.resolve();
              return finish.promise;
            },
          },
        };
      };
      const prepared = await Effect.runPromise(
        createOpenCodeLiveSessionAdapterPreparer({
          liveSessionLifecycle: createLifecycle([]),
          prepareRuntime,
        })(runtime, ignoreObservationLoss),
      );
      try {
        await Effect.runPromise(
          prepared.adapter.resumeSession({
            ...ref,
            resumeMode: "reattach",
            sessionScope: { kind: "repository" },
          }),
        );
        await Effect.runPromise(prepared.startForwarding());
        const loading = Effect.runPromise(prepared.adapter.loadContext(ref));
        await started.promise;
        if (previousUsage === "measured")
          await harness.emit({
            type: "context_updated",
            externalSessionId: ref.externalSessionId,
            contextUsage: { totalTokens: 55 },
          });
        await harness.emit({
          type: "context_updated",
          externalSessionId: ref.externalSessionId,
          contextUsage: null,
        });
        finish.resolve({ totalTokens: 77 });
        expect(await loading).toBeNull();
        expect(
          (await Effect.runPromise(prepared.adapter.listSnapshots()))[0]?.contextUsage,
        ).toBeNull();
      } finally {
        finish.resolve({ totalTokens: 77 });
        await Effect.runPromise(prepared.adapter.releaseRuntime());
      }
    },
  );

  test("restores native source usage and clears the old measurement after compaction", async () => {
    const source: OpencodeRuntimeSnapshotSource = {
      repoPath: ref.repoPath,
      externalSessionId: ref.externalSessionId,
      workingDirectory: ref.workingDirectory,
      sessionAssociation: { kind: "repository" },
      title: "Restored conversation",
      startedAt: "2026-07-16T10:02:00.000Z",
      runtimeActivity: "idle",
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: { totalTokens: 3170, model: { providerId: "test", modelId: "test-model" } },
    };
    const harness = createRuntimeHarness({ sessionSources: [source] });
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime: harness.prepareRuntime,
      })(runtime, ignoreObservationLoss),
    );
    try {
      if (!prepared.adapter.refreshSnapshots) throw new Error("Expected snapshot support");
      await Effect.runPromise(prepared.adapter.refreshSnapshots(ref.repoPath));
      expect((await Effect.runPromise(prepared.adapter.listSnapshots()))[0]?.contextUsage).toEqual({
        totalTokens: 3170,
        providerId: "test",
        modelId: "test-model",
      });
      await Effect.runPromise(prepared.startForwarding());
      await harness.emit({
        type: "context_updated",
        externalSessionId: ref.externalSessionId,
        contextUsage: { totalTokens: 55 },
      });
      source.contextUsage = null;
      await Effect.runPromise(prepared.adapter.refreshSnapshots(ref.repoPath));
      await Effect.runPromise(
        prepared.adapter.resumeSession({
          ...ref,
          resumeMode: "reattach",
          sessionScope: { kind: "repository" },
        }),
      );
      expect(
        (await Effect.runPromise(prepared.adapter.listSnapshots()))[0]?.contextUsage,
      ).toBeNull();
    } finally {
      await Effect.runPromise(prepared.adapter.releaseRuntime());
    }
  });

  test("loads context for a persisted session without retaining a live snapshot", async () => {
    const harness = createRuntimeHarness();
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime: harness.prepareRuntime,
      })(runtime, ignoreObservationLoss),
    );

    await expect(Effect.runPromise(prepared.adapter.loadContext(ref))).resolves.toEqual({
      totalTokens: 999,
      providerId: "openai",
      modelId: "gpt-5.1",
    });
    expect(harness.contextLoadCalls).toEqual(["session-1"]);
    await expect(Effect.runPromise(prepared.adapter.listSnapshots())).resolves.toEqual([]);
  });

  test("keeps pending replies usable after context or native reply failures", async () => {
    const harness = createRuntimeHarness();
    const originalPrepare = harness.prepareRuntime;
    let approvalAttempts = 0;
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await originalPrepare(input);
      return {
        ...prepared,
        connection: {
          ...prepared.connection,
          loadContextUsage: async () => {
            throw new Error("context endpoint unavailable");
          },
          replyApproval: async (reply) => {
            approvalAttempts += 1;
            if (approvalAttempts === 1) {
              throw new Error("approval endpoint unavailable");
            }
            await prepared.connection.replyApproval(reply);
          },
        },
      };
    };
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: createLifecycle([]),
        prepareRuntime,
      })(runtime, ignoreObservationLoss),
    );
    const adapter = prepared.adapter;
    await Effect.runPromise(
      adapter.resumeSession({
        resumeMode: "reattach",
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );
    await Effect.runPromise(prepared.startForwarding());
    await harness.emit({
      type: "session_event",
      externalSessionId: "session-1",
      event: {
        type: "approval_required",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:02:00.000Z",
        requestId: "permission-1",
        requestType: "file_change",
        title: "Edit a file",
      },
    });

    await expect(Effect.runPromise(adapter.loadContext(ref))).rejects.toThrow(
      "context endpoint unavailable",
    );
    await expect(
      Effect.runPromise(
        adapter.replyApproval({
          ...ref,
          requestId: "opencode-pending-1",
          outcome: "approve_once",
        }),
      ),
    ).rejects.toThrow("approval endpoint unavailable");

    const afterFailures = await Effect.runPromise(adapter.readSnapshot(ref));
    expect(afterFailures).toMatchObject({
      type: "live",
      session: { pendingApprovals: [{ requestId: "opencode-pending-1" }] },
    });

    await Effect.runPromise(
      adapter.replyApproval({
        ...ref,
        requestId: "opencode-pending-1",
        outcome: "approve_once",
      }),
    );
    const afterReply = await Effect.runPromise(adapter.readSnapshot(ref));
    expect(afterReply).toMatchObject({ type: "live", session: { pendingApprovals: [] } });
    expect(harness.approvalReplies).toHaveLength(1);
  });

  test("isolates identical native request ids across runtime adapters", async () => {
    const firstHarness = createRuntimeHarness();
    const secondHarness = createRuntimeHarness();
    const secondRuntime: RuntimeInstanceSummary = {
      ...runtime,
      runtimeId: "runtime-2",
      runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:43124" },
    };
    const secondRef = { ...ref, externalSessionId: "session-2" };
    const prepareAdapter = createOpenCodeLiveSessionAdapterPreparer({
      liveSessionLifecycle: createLifecycle([]),
      prepareRuntime: (input) =>
        input.runtimeId === runtime.runtimeId
          ? firstHarness.prepareRuntime(input)
          : secondHarness.prepareRuntime(input),
    });

    const first = await Effect.runPromise(prepareAdapter(runtime, ignoreObservationLoss));
    const second = await Effect.runPromise(prepareAdapter(secondRuntime, ignoreObservationLoss));
    const firstAdapter = first.adapter;
    const secondAdapter = second.adapter;
    const sessionScope = { kind: "workflow" as const, taskId: "task-1", role: "build" as const };
    await Effect.runPromise(
      firstAdapter.resumeSession({ resumeMode: "reattach", ...ref, sessionScope }),
    );
    await Effect.runPromise(
      secondAdapter.resumeSession({ resumeMode: "reattach", ...secondRef, sessionScope }),
    );
    await Effect.runPromise(first.startForwarding());
    await Effect.runPromise(second.startForwarding());
    await firstHarness.emit({
      type: "session_event",
      externalSessionId: "session-1",
      event: {
        type: "approval_required",
        externalSessionId: "session-1",
        timestamp: "2026-07-16T10:02:00.000Z",
        requestId: "permission-1",
        requestType: "file_change",
        title: "Edit a file",
      },
    });
    await secondHarness.emit({
      type: "session_event",
      externalSessionId: "session-2",
      event: {
        type: "approval_required",
        externalSessionId: "session-2",
        timestamp: "2026-07-16T10:02:00.000Z",
        requestId: "permission-1",
        requestType: "file_change",
        title: "Edit a file",
      },
    });
    const firstSnapshot = await Effect.runPromise(firstAdapter.readSnapshot(ref));
    const secondSnapshot = await Effect.runPromise(secondAdapter.readSnapshot(secondRef));
    if (firstSnapshot.type !== "live" || secondSnapshot.type !== "live") {
      throw new Error("Expected both OpenCode runtime snapshots to be live.");
    }
    const firstRequestId = firstSnapshot.session.pendingApprovals[0]?.requestId;
    const secondRequestId = secondSnapshot.session.pendingApprovals[0]?.requestId;
    if (!firstRequestId || !secondRequestId) {
      throw new Error("Expected both OpenCode runtimes to retain a pending approval.");
    }
    expect(firstRequestId).not.toBe(secondRequestId);

    await Effect.runPromise(
      firstAdapter.replyApproval({
        ...ref,
        requestId: firstRequestId,
        outcome: "approve_once",
      }),
    );
    const retainedSecond = await Effect.runPromise(secondAdapter.readSnapshot(secondRef));
    expect(retainedSecond).toMatchObject({
      type: "live",
      session: { pendingApprovals: [{ requestId: secondRequestId }] },
    });
    expect(firstHarness.approvalReplies[0]?.nativeRequestId).toBe("permission-1");
    expect(secondHarness.approvalReplies).toEqual([]);
  });

  test("releases only the owning adapter after an observation fault", async () => {
    const harness = createRuntimeHarness({
      sessionSources: [
        {
          repoPath: ref.repoPath,
          externalSessionId: ref.externalSessionId,
          workingDirectory: ref.workingDirectory,
          sessionAssociation: { kind: "unbound" },
          title: "Known builder",
          startedAt: "2026-07-16T10:00:00.000Z",
          runtimeActivity: "idle",
          pendingApprovals: [],
          pendingQuestions: [],
        },
      ],
    });
    const envelopes: Array<{ type: string }> = [];
    const service = createAgentSessionLiveStateService({
      adapterRegistry: createLiveSessionAdapterRegistry(),
      faultLog: () => Effect.void,
      runtimeAdmission: { admit: (_runtimeKind, effect) => effect },
      publish: (envelope) => envelopes.push(envelope),
    });
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: service,
        prepareRuntime: harness.prepareRuntime,
      })(runtime, ignoreObservationLoss),
    );
    await Effect.runPromise(service.registerRuntimeAdapter(prepared.adapter));
    await Effect.runPromise(
      prepared.adapter.resumeSession({
        resumeMode: "reattach",
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );

    const otherRef = { ...ref, runtimeKind: "codex" as const, externalSessionId: "session-2" };
    const otherSnapshot: AgentSessionLiveSnapshot = {
      ref: otherRef,
      activity: "idle",
      title: "Other runtime session",
      startedAt: "2026-07-16T10:02:00.000Z",
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
    };
    const otherAdapter: AgentSessionLiveAdapterPort = {
      queries: unexpectedRuntimeQueries,
      sessionImport: unexpectedSessionImport,
      supportsSessionControl: false,
      beginGeneratedImageBatch: () => Effect.die(new Error("Unexpected beginGeneratedImageBatch")),
      releaseGeneratedImageBatch: () =>
        Effect.die(new Error("Unexpected releaseGeneratedImageBatch")),
      describeGeneratedImages: () => Effect.die(new Error("Unexpected describeGeneratedImages")),
      resolveGeneratedImageSource: () => Effect.die(new Error("Unexpected generated image read")),
      binding: new AgentSessionLiveRegistration(
        { runtimeId: "runtime-2", runtimeKind: "codex" },
        (mutation) => Effect.map(mutation, ({ value }) => value),
      ),
      listSnapshots: () => Effect.succeed([otherSnapshot]),
      readSnapshot: (candidate) =>
        Effect.succeed(
          candidate.externalSessionId === otherRef.externalSessionId
            ? ({ type: "live", session: otherSnapshot } as const)
            : ({ type: "missing", ref: candidate } as const),
        ),
      loadContext: () => Effect.succeed(null),
      replyApproval: () => Effect.void,
      replyQuestion: () => Effect.void,
      releaseRuntime: () => Effect.succeed([otherRef]),
    };
    await Effect.runPromise(service.registerRuntimeAdapter(otherAdapter));
    await Effect.runPromise(prepared.startForwarding());
    await Effect.runPromise(service.refresh({ repoPath: "/repo" }));
    envelopes.length = 0;

    await harness.emit({
      type: "fault",
      message: "OpenCode live event observation failed: connection lost",
    });

    const current = await Effect.runPromise(service.list({ repoPath: "/repo" }));
    expect(current.map((snapshot) => snapshot.ref.externalSessionId)).toEqual(["session-2"]);
    expect(harness.releaseCalls).toEqual(["runtime-1"]);
    expect(envelopes.map((envelope) => envelope.type)).toEqual(["fault", "session_removed"]);
    await Effect.runPromise(service.releaseRuntime("runtime-2"));
  });

  test("keeps a live event newer than an overlapping refresh", async () => {
    const harness = createRuntimeHarness();
    const nextRef = { ...ref, externalSessionId: "session-2" };
    let markRefreshReadStarted: () => void = () => undefined;
    let finishRefreshRead: () => void = () => undefined;
    let markEventCommitStarted: () => void = () => undefined;
    const refreshReadStarted = new Promise<void>((resolve) => {
      markRefreshReadStarted = resolve;
    });
    const refreshReadGate = new Promise<void>((resolve) => {
      finishRefreshRead = resolve;
    });
    const eventCommitStarted = new Promise<void>((resolve) => {
      markEventCommitStarted = resolve;
    });
    let blockRefresh = false;
    const basePrepare = harness.prepareRuntime;
    const readSources = () => ({
      sources: [ref, nextRef].map((candidate) => ({
        repoPath: candidate.repoPath,
        externalSessionId: candidate.externalSessionId,
        workingDirectory: candidate.workingDirectory,
        sessionAssociation: { kind: "unbound" as const },
        title: `Known ${candidate.externalSessionId}`,
        startedAt: "2026-07-16T10:00:00.000Z",
        runtimeActivity: "running" as const,
        pendingApprovals: [],
        pendingQuestions: [],
      })),
      failures: [],
    });
    const prepareRuntime: PrepareOpencodeSessionRuntime = async (input) => {
      const prepared = await basePrepare(input);
      return {
        ...prepared,
        connection: {
          ...prepared.connection,
          readSessionSources: async () => {
            if (!blockRefresh) {
              return readSources();
            }
            markRefreshReadStarted();
            await refreshReadGate;
            return readSources();
          },
        },
      };
    };
    const adapterRegistry = createLiveSessionAdapterRegistry();
    const service = createAgentSessionLiveStateService({
      adapterRegistry,
      faultLog: () => Effect.void,
      runtimeAdmission: { admit: (_runtimeKind, effect) => effect },
      publish: () => undefined,
    });
    let watchCommit = false;
    const prepared = await Effect.runPromise(
      createOpenCodeLiveSessionAdapterPreparer({
        liveSessionLifecycle: {
          releaseRuntime: service.releaseRuntime,
          createRuntimeRegistration: (binding) => {
            const registration = service.createRuntimeRegistration(binding);
            const run = registration.runMutation;
            const watched: typeof run = (mutation) => {
              if (watchCommit) {
                watchCommit = false;
                markEventCommitStarted();
              }
              return run(mutation);
            };
            Object.defineProperty(registration, "runMutation", { value: watched });
            return registration;
          },
        },
        prepareRuntime,
      })(runtime, ignoreObservationLoss),
    );
    await Effect.runPromise(service.registerRuntimeAdapter(prepared.adapter));
    await Effect.runPromise(
      prepared.adapter.resumeSession({
        resumeMode: "reattach",
        ...ref,
        sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
      }),
    );
    await Effect.runPromise(prepared.startForwarding());

    blockRefresh = true;
    const refresh = Effect.runPromise(service.refresh({ repoPath: ref.repoPath }));
    await refreshReadStarted;
    watchCommit = true;
    const event = harness.emit({
      type: "session_event",
      externalSessionId: ref.externalSessionId,
      event: {
        type: "session_idle",
        externalSessionId: ref.externalSessionId,
        timestamp: "2026-07-16T10:04:00.000Z",
      },
    });
    const eventPassedRefresh = await Promise.race([
      eventCommitStarted.then(() => true),
      Bun.sleep(50).then(() => false),
    ]);
    expect(eventPassedRefresh).toBe(true);
    finishRefreshRead();

    await Promise.all([refresh, event]);
    await expect(
      Effect.runPromise(service.list({ repoPath: ref.repoPath })),
    ).resolves.toMatchObject([
      { ref, activity: "idle" },
      { ref: nextRef, activity: "running" },
    ]);
  });
});
