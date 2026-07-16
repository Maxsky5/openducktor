import {
  createOpencodeLiveSessionController,
  type OpencodeLiveSessionChange,
  type OpencodeLiveSessionController,
} from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionControlSummary,
  type AgentSessionLiveRef,
  acceptedAgentUserMessageSchema,
  agentSessionLiveRefSchema,
  agentSessionLiveSnapshotSchema,
  agentSessionTranscriptEventSchema,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionRuntimeAdapterPort,
} from "../../ports/agent-session-live-adapter-port";
import type {
  PreparedRuntimeLiveSessionAdapter,
  RuntimeLiveSessionLifecyclePort,
} from "../../ports/runtime-live-session-lifecycle-port";
import {
  parseOutput,
  refKey,
  refsEqual,
  requireRuntime,
  toContextUsage,
  toControlSummary,
  toLiveSnapshot,
  toSessionRef,
  validateChangeOwnership,
} from "./opencode-live-session-normalization";

export type OpenCodeLiveSessionAdapterPreparer = (
  runtime: RuntimeInstanceSummary,
) => Effect.Effect<PreparedRuntimeLiveSessionAdapter, HostError>;

export type CreateOpenCodeLiveSessionAdapterPreparerInput = {
  readonly liveSessionLifecycle: Pick<
    RuntimeLiveSessionLifecyclePort,
    "releaseRuntime" | "runAdapterMutation"
  >;
  readonly controller?: OpencodeLiveSessionController;
};

export const createOpenCodeLiveSessionAdapterPreparer =
  ({
    liveSessionLifecycle,
    controller = createOpencodeLiveSessionController(),
  }: CreateOpenCodeLiveSessionAdapterPreparerInput): OpenCodeLiveSessionAdapterPreparer =>
  (runtimeInput) =>
    Effect.gen(function* () {
      const runtime = yield* requireRuntime(runtimeInput);
      const attachment = yield* Effect.tryPromise({
        try: () =>
          controller.initializeRuntime({
            repoPath: runtime.repoPath,
            runtimeKind: runtime.kind,
            runtimeId: runtime.runtimeId,
            runtimeEndpoint: runtime.runtimeRoute.endpoint,
          }),
        catch: (cause) =>
          toHostOperationError(cause, "opencode-live-session.initialize-runtime", {
            runtimeId: runtime.runtimeId,
            repoPath: runtime.repoPath,
          }),
      });
      const initialSnapshots = yield* Effect.forEach(attachment.snapshots, (snapshot) =>
        validateChangeOwnership(runtime, snapshot.runtimeId, "initial_snapshot", snapshot.ref).pipe(
          Effect.zipRight(toLiveSnapshot(snapshot)),
        ),
      );
      const snapshotsByRef = new Map(
        initialSnapshots.map((snapshot) => [refKey(snapshot.ref), snapshot] as const),
      );
      const controlledRefs = new Map<string, AgentSessionLiveRef>();
      let released = false;

      const forgetRef = (ref: AgentSessionLiveRef): void => {
        snapshotsByRef.delete(refKey(ref));
        controlledRefs.delete(refKey(ref));
      };
      const rememberControlledRef = (ref: AgentSessionLiveRef): void => {
        controlledRefs.set(refKey(ref), ref);
      };
      const readSnapshots = () =>
        Effect.forEach([...snapshotsByRef.values()], (snapshot) =>
          parseOutput(
            agentSessionLiveSnapshotSchema,
            snapshot,
            "opencode-live-session.clone-retained-snapshot",
          ),
        );

      const normalizeChange = (
        change: OpencodeLiveSessionChange,
      ): Effect.Effect<AgentSessionLiveAdapterChange | null, HostError> => {
        switch (change.type) {
          case "session_upsert":
            return validateChangeOwnership(
              runtime,
              change.snapshot.runtimeId,
              change.type,
              change.snapshot.ref,
            ).pipe(
              Effect.zipRight(toLiveSnapshot(change.snapshot)),
              Effect.map((snapshot) => ({ type: "session_upsert" as const, snapshot })),
            );
          case "session_removed":
            return validateChangeOwnership(runtime, change.runtimeId, change.type, change.ref).pipe(
              Effect.zipRight(
                parseOutput(
                  agentSessionLiveRefSchema,
                  change.ref,
                  "opencode-live-session.normalize-removed-ref",
                ),
              ),
              Effect.map((ref) => ({ type: "session_removed" as const, ref })),
            );
          case "transcript_event":
            return validateChangeOwnership(runtime, change.runtimeId, change.type, change.ref).pipe(
              Effect.zipRight(
                parseOutput(
                  agentSessionTranscriptEventSchema,
                  { ...change.event, sessionRef: change.ref },
                  "opencode-live-session.normalize-transcript-event",
                ),
              ),
              Effect.map((event) => ({ type: "transcript_event" as const, event })),
            );
          case "runtime_fault":
            return validateChangeOwnership(runtime, change.runtimeId, change.type).pipe(
              Effect.as({
                type: "fault" as const,
                repoPath: runtime.repoPath,
                operation: "opencode-live-session.observe-runtime",
                message: change.message,
              }),
            );
        }
      };

      const applyNormalizedChange = (
        change: AgentSessionLiveAdapterChange,
      ): ReadonlyArray<AgentSessionLiveAdapterChange> => {
        if (released) {
          return [];
        }
        if (change.type === "session_upsert") {
          snapshotsByRef.set(refKey(change.snapshot.ref), change.snapshot);
          return [change];
        }
        if (change.type === "session_removed") {
          const wasRetained = snapshotsByRef.has(refKey(change.ref));
          forgetRef(change.ref);
          return wasRetained ? [change] : [];
        }
        return [change];
      };

      const releaseSessionProjection = (
        ref: AgentSessionLiveRef,
      ): ReadonlyArray<AgentSessionLiveAdapterChange> => {
        const key = refKey(ref);
        const wasKnown = snapshotsByRef.has(key) || controlledRefs.has(key);
        forgetRef(ref);
        return wasKnown ? [{ type: "session_removed", ref: toSessionRef(ref) }] : [];
      };

      const releaseAdapter = (): Effect.Effect<ReadonlyArray<AgentSessionLiveRef>, HostError> =>
        Effect.suspend(() => {
          if (released) {
            return Effect.succeed([]);
          }
          released = true;
          const retainedRefs = [...snapshotsByRef.values()].map((snapshot) => snapshot.ref);
          snapshotsByRef.clear();
          controlledRefs.clear();
          return Effect.tryPromise({
            try: () => attachment.release(),
            catch: (cause) =>
              toHostOperationError(cause, "opencode-live-session.release-runtime", {
                runtimeId: runtime.runtimeId,
              }),
          }).pipe(Effect.as(retainedRefs));
        });

      const runControlSummary = (
        operation: string,
        run: () => Promise<unknown>,
        input: { repoPath: string; runtimeKind: "opencode" | "codex" },
      ): Effect.Effect<AgentSessionControlSummary, HostError> =>
        Effect.tryPromise({
          try: run,
          catch: (cause) =>
            toHostOperationError(cause, operation, { runtimeId: runtime.runtimeId }),
        }).pipe(
          Effect.flatMap(toControlSummary),
          Effect.flatMap((summary) =>
            summary.runtimeKind === "opencode"
              ? Effect.succeed(summary)
              : Effect.fail(
                  new HostValidationError({
                    field: "runtimeKind",
                    message: `OpenCode control '${operation}' returned runtime kind '${summary.runtimeKind}'.`,
                    details: { operation, runtimeId: runtime.runtimeId },
                  }),
                ),
          ),
          Effect.flatMap((summary) =>
            liveSessionLifecycle.runAdapterMutation(
              Effect.sync(() => {
                rememberControlledRef({
                  repoPath: input.repoPath,
                  runtimeKind: "opencode",
                  workingDirectory: summary.workingDirectory,
                  externalSessionId: summary.externalSessionId,
                });
                return { value: summary, changes: [] };
              }),
            ),
          ),
        );

      const adapter: AgentSessionRuntimeAdapterPort = {
        binding: {
          runtimeId: runtime.runtimeId,
          runtimeKind: runtime.kind,
          repoPath: runtime.repoPath,
        },
        matches: (ref) => snapshotsByRef.has(refKey(ref)) || controlledRefs.has(refKey(ref)),
        listRetainedSnapshots: (repoPath) =>
          repoPath === runtime.repoPath ? readSnapshots() : Effect.succeed([]),
        readRetainedSnapshot: (ref) =>
          readSnapshots().pipe(
            Effect.map((snapshots) => {
              const snapshot = snapshots.find((candidate) => refsEqual(candidate.ref, ref));
              return snapshot
                ? ({ type: "live", session: snapshot } as const)
                : ({ type: "missing", ref } as const);
            }),
          ),
        loadContext: (input) =>
          Effect.tryPromise({
            try: () => controller.loadSessionContextUsage(runtime.runtimeId, input),
            catch: (cause) =>
              toHostOperationError(cause, "opencode-live-session.load-context", {
                runtimeId: runtime.runtimeId,
                externalSessionId: input.externalSessionId,
              }),
          }).pipe(Effect.flatMap(toContextUsage)),
        replyApproval: (input) =>
          Effect.tryPromise({
            try: () =>
              controller.replyApproval({
                runtimeId: runtime.runtimeId,
                ref: toSessionRef(input),
                requestId: input.requestId,
                outcome: input.outcome,
                ...(input.message ? { message: input.message } : {}),
              }),
            catch: (cause) =>
              toHostOperationError(cause, "opencode-live-session.reply-approval", {
                runtimeId: runtime.runtimeId,
                externalSessionId: input.externalSessionId,
                requestId: input.requestId,
              }),
          }),
        replyQuestion: (input) =>
          Effect.tryPromise({
            try: () =>
              controller.replyQuestion({
                runtimeId: runtime.runtimeId,
                ref: toSessionRef(input),
                requestId: input.requestId,
                answers: input.answers,
              }),
            catch: (cause) =>
              toHostOperationError(cause, "opencode-live-session.reply-question", {
                runtimeId: runtime.runtimeId,
                externalSessionId: input.externalSessionId,
                requestId: input.requestId,
              }),
          }),
        releaseRuntime: releaseAdapter,
        startSession: (input) =>
          runControlSummary(
            "opencode-live-session.start-session",
            () =>
              controller.startSession(runtime.runtimeId, {
                repoPath: input.repoPath,
                runtimeKind: "opencode",
                runtimePolicy: { kind: "opencode" },
                workingDirectory: input.workingDirectory,
                sessionScope: input.sessionScope,
                systemPrompt: input.systemPrompt,
                ...(input.model ? { model: input.model } : {}),
              }),
            input,
          ),
        resumeSession: (input) =>
          runControlSummary(
            "opencode-live-session.resume-session",
            () =>
              controller.resumeSession(runtime.runtimeId, {
                ...toSessionRef(input),
                runtimeKind: "opencode",
                runtimePolicy: { kind: "opencode" },
                sessionScope: input.sessionScope,
                ...(input.model ? { model: input.model } : {}),
                ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
              }),
            input,
          ),
        forkSession: (input) =>
          runControlSummary(
            "opencode-live-session.fork-session",
            () =>
              controller.forkSession(runtime.runtimeId, {
                repoPath: input.repoPath,
                runtimeKind: "opencode",
                runtimePolicy: { kind: "opencode" },
                workingDirectory: input.workingDirectory,
                sessionScope: input.sessionScope,
                systemPrompt: input.systemPrompt,
                parentExternalSessionId: input.parentExternalSessionId,
                ...(input.runtimeHistoryAnchor
                  ? { runtimeHistoryAnchor: input.runtimeHistoryAnchor }
                  : {}),
                ...(input.model ? { model: input.model } : {}),
              }),
            input,
          ),
        sendUserMessage: (input) =>
          Effect.tryPromise({
            try: () =>
              controller.sendUserMessage(runtime.runtimeId, {
                ...toSessionRef(input),
                runtimeKind: "opencode",
                runtimePolicy: { kind: "opencode" },
                sessionScope: input.sessionScope,
                parts: input.parts as Parameters<
                  OpencodeLiveSessionController["sendUserMessage"]
                >[1]["parts"],
                ...(input.model ? { model: input.model } : {}),
                ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
              }),
            catch: (cause) =>
              toHostOperationError(cause, "opencode-live-session.send-user-message", {
                runtimeId: runtime.runtimeId,
                externalSessionId: input.externalSessionId,
              }),
          }).pipe(
            Effect.flatMap((event) =>
              parseOutput(
                acceptedAgentUserMessageSchema,
                event,
                "opencode-live-session.normalize-user-message",
              ),
            ),
            Effect.flatMap((value) =>
              liveSessionLifecycle.runAdapterMutation(
                Effect.sync(() => {
                  rememberControlledRef(toSessionRef(input));
                  return { value, changes: [] };
                }),
              ),
            ),
          ),
        updateSessionModel: (input) =>
          Effect.tryPromise({
            try: async () => {
              await controller.updateSessionModel(runtime.runtimeId, input);
            },
            catch: (cause) =>
              toHostOperationError(cause, "opencode-live-session.update-session-model", {
                runtimeId: runtime.runtimeId,
                externalSessionId: input.externalSessionId,
              }),
          }).pipe(
            Effect.flatMap(() =>
              liveSessionLifecycle.runAdapterMutation(
                Effect.succeed({ value: undefined, changes: [] }),
              ),
            ),
          ),
        stopSession: (input) =>
          Effect.tryPromise({
            try: () => controller.stopSession(runtime.runtimeId, input),
            catch: (cause) =>
              toHostOperationError(cause, "opencode-live-session.stop-session", {
                runtimeId: runtime.runtimeId,
                externalSessionId: input.externalSessionId,
              }),
          }).pipe(
            Effect.flatMap(() =>
              liveSessionLifecycle.runAdapterMutation(
                Effect.sync(() => {
                  return {
                    value: undefined,
                    changes: releaseSessionProjection(input),
                  };
                }),
              ),
            ),
          ),
        releaseSession: (input) =>
          Effect.tryPromise({
            try: () => controller.releaseSession(runtime.runtimeId, input),
            catch: (cause) =>
              toHostOperationError(cause, "opencode-live-session.release-session", {
                runtimeId: runtime.runtimeId,
                externalSessionId: input.externalSessionId,
              }),
          }).pipe(
            Effect.flatMap(() =>
              liveSessionLifecycle.runAdapterMutation(
                Effect.sync(() => {
                  return {
                    value: undefined,
                    changes: releaseSessionProjection(input),
                  };
                }),
              ),
            ),
          ),
      };

      return {
        adapter,
        startForwarding: () =>
          Effect.tryPromise({
            try: () =>
              attachment.startForwarding((change) =>
                Effect.runPromise(
                  normalizeChange(change).pipe(
                    Effect.flatMap((normalized) =>
                      normalized
                        ? liveSessionLifecycle.runAdapterMutation(
                            Effect.sync(() => {
                              return {
                                value: undefined,
                                changes: applyNormalizedChange(normalized),
                              };
                            }),
                          )
                        : Effect.void,
                    ),
                    Effect.flatMap(() =>
                      change.type === "runtime_fault"
                        ? liveSessionLifecycle.releaseRuntime(runtime.runtimeId).pipe(Effect.asVoid)
                        : Effect.void,
                    ),
                  ),
                ),
              ),
            catch: (cause) =>
              toHostOperationError(cause, "opencode-live-session.start-forwarding", {
                runtimeId: runtime.runtimeId,
              }),
          }),
        discard: () => releaseAdapter().pipe(Effect.asVoid),
      } satisfies PreparedRuntimeLiveSessionAdapter;
    });
