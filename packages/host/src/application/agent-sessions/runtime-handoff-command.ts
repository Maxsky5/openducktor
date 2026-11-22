import type {
  AgentChatHandoffCheckInput,
  AgentChatHandoffSendInput,
  AgentChatRef,
  AgentMessageTarget,
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentSessionScope,
  AgentSessionUserMessagePart,
  HandoffContextPrefix,
  HandoffLink,
  HandoffNativeSession,
} from "@openducktor/contracts";
import { agentSessionRefsEqual, findCatalogModel } from "@openducktor/core";
import { Effect } from "effect";
import { createHostOperationWorkers } from "../../effect/host-operation-workers";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type { AgentRuntimeQueryPort } from "../../ports/agent-runtime-query-port";
import type { TaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import type { AgentSessionOperationPolicy } from "./agent-session-operation-policy";
import type { createSessionCreationPreparation } from "./session-creation-preparation";
import { sendOutcome } from "./agent-message-send-outcome";
import {
  prepareHandoffModel,
  requireHandoffSourceReady,
  unsupportedHandoffParts,
} from "./runtime-handoff-readiness";
import {
  prepareRuntimeHandoffHistory,
  projectHandoffEnvelope,
  readFramedHandoffReceipt,
  type HandoffPrefixDigest,
} from "./runtime-handoff-history";
import {
  handoffChatKey,
  handoffFailure as failure,
  keepAcceptedFailure,
  newHandoffResult,
  restoredHandoffResult,
  unknownHandoffSubmission,
} from "./runtime-handoff-result";
import {
  settleAcceptedHandoff,
  releaseStagedHandoff,
  findAcceptedHandoffDestination,
  hasStagedHandoffDestination,
  type PendingHandoff,
  type HandoffCommit,
} from "./runtime-handoff-settlement";

export type RuntimeHandoffOwner = {
  scope: AgentSessionScope;
  prepareSend: Effect.Effect<string, HostError>;
  requireWritable: Effect.Effect<void, HostError>;
  links: HandoffLink[];
  active: HandoffNativeSession;
};

const invalid = (message: string) => new HostValidationError({ field: "handoff", message });

export type RuntimeHandoffFactory = (
  creation: ReturnType<typeof createSessionCreationPreparation>,
  policyFor: (scope: AgentSessionScope) => AgentSessionOperationPolicy,
  withRootLock: ReturnType<
    typeof import("./session-operation-owner").createSessionOperationOwner
  >["withRootLock"],
) => ReturnType<typeof createRuntimeHandoffCommands>;

export const createRuntimeHandoffCommands = (deps: {
  runtime: Pick<
    AgentSessionLiveStateService,
    "list" | "read" | "sendUserMessage" | "releaseSession" | "publishOperation" | "retainOperation"
  >;
  queries: Pick<AgentRuntimeQueryPort, "loadRuntimeCatalog">;
  readHistory: (
    target: AgentMessageTarget,
  ) => ReturnType<AgentRuntimeQueryPort["loadSessionHistory"]>;
  creation: Pick<ReturnType<typeof createSessionCreationPreparation>, "startSession">;
  worktreeReads: Pick<TaskSessionLifecycleCoordinator, "runWorktreeRead">;
  resolveOwner: (chat: AgentChatRef) => Effect.Effect<RuntimeHandoffOwner, HostError>;
  withRootLock: ReturnType<
    typeof import("./session-operation-owner").createSessionOperationOwner
  >["withRootLock"];
  requireDestinationAdmission: (
    runtimeKind: HandoffNativeSession["runtimeKind"],
  ) => Effect.Effect<void, HostError>;
  policyFor: (scope: AgentSessionScope) => Pick<AgentSessionOperationPolicy, "run">;
  resolveParts: (
    parts: AgentSessionUserMessagePart[],
  ) => Effect.Effect<AgentSessionUserMessagePart[], HostError>;
  ensureNoScheduledWork: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>;
  checkActiveMember: (target: AgentMessageTarget) => Effect.Effect<void, HostError>;
  readDestinationBudget: (
    target: AgentMessageTarget,
    model: AgentChatHandoffSendInput["destination"],
    contextWindow: number | undefined,
  ) => Effect.Effect<{ contextWindow: number | undefined; usedTokens: number }, HostError>;
  readStagedHistory: (
    target: AgentMessageTarget,
  ) => ReturnType<AgentRuntimeQueryPort["loadSessionHistory"]>;
  readPrefix: (
    ref: AgentSessionLiveRef & { sessionScope?: AgentSessionScope | undefined },
    candidate?: HandoffContextPrefix,
  ) => Effect.Effect<{ firstMessageId: string; receipt: HandoffContextPrefix } | null, HostError>;
  commit: HandoffCommit;
  publishOwner: (chat: AgentChatRef) => Effect.Effect<void, HostError>;
  digestPrefix: HandoffPrefixDigest;
  admission: {
    create: (runtime: HandoffNativeSession["runtimeKind"], key: string) => string;
    matches: (
      runtime: HandoffNativeSession["runtimeKind"],
      key: string,
      messageId: string,
    ) => boolean;
  };
}) => {
  const workers = createHostOperationWorkers();
  const attempts = new Map<string, PendingHandoff>();
  const byChat = new Map<string, PendingHandoff>();
  const operationKey = (input: AgentChatHandoffCheckInput) =>
    JSON.stringify([handoffChatKey(input.chat), input.submissionId]);

  const publish = (attempt: PendingHandoff) => {
    const observation = { ...attempt.result, handoff: { ...attempt.result.handoff } };
    return deps.runtime.publishOperation({ type: "session_operation_updated", observation }).pipe(
      Effect.catch((cause) =>
        deps.runtime.retainOperation({
          ...observation,
          failure: keepAcceptedFailure(
            observation.failure,
            failure("publish", cause.message, "Reconnect to read the current handoff result."),
          ),
        }),
      ),
    );
  };

  const settleAccepted = settleAcceptedHandoff({
    commit: deps.commit,
    publishOwner: deps.publishOwner,
    publish,
    onCommit: (chat) => {
      byChat.delete(handoffChatKey(chat));
    },
  });

  const runSend = (
    input: AgentChatHandoffSendInput,
    attempt: PendingHandoff,
    owner: RuntimeHandoffOwner,
    source: AgentMessageTarget,
  ) =>
    Effect.gen(function* () {
      const systemPrompt = yield* owner.prepareSend;
      yield* requireHandoffSourceReady(source, deps.runtime, deps.ensureNoScheduledWork);
      const target = {
        repoPath: source.repoPath,
        workingDirectory: source.workingDirectory,
        runtimeKind: input.destination.runtimeKind,
        sessionScope: owner.scope,
        systemPrompt,
      };
      if (target.runtimeKind === source.runtimeKind)
        return yield* invalid("Choose a model on another runtime.");
      const catalog = yield* deps.queries.loadRuntimeCatalog(target);
      const models = catalog.models?.status === "available" ? catalog.models.catalog : null;
      const model = findCatalogModel(models, input.destination);
      if (!models || !model)
        return yield* invalid(
          "The selected destination model is unavailable. Refresh the model list and choose a model.",
        );
      const promptInput = catalog.runtime?.capabilities.promptInput;
      if (!promptInput)
        return yield* invalid("Refresh the destination catalog before switching runtimes.");
      const unsupported = unsupportedHandoffParts(input.parts, promptInput, model);
      if (unsupported.length) {
        attempt.result.handoff.unsupportedPartIndexes = unsupported.map(({ index }) => index);
        return yield* invalid(unsupported.map(({ reason }) => reason).join(" "));
      }
      const parts = yield* deps.resolveParts(input.parts);
      const members = [...owner.links.map(({ from }) => from), owner.active];
      const segments = yield* Effect.forEach(members, (ref) =>
        deps
          .readHistory({ ...ref, repoPath: source.repoPath, sessionScope: owner.scope })
          .pipe(Effect.map((messages) => ({ messages, knownOmissions: false }))),
      );
      const destination = yield* prepareHandoffModel(models, input.destination);
      attempt.result.handoff.destination = destination;
      yield* deps.requireDestinationAdmission(target.runtimeKind);
      const started = yield* deps.creation.startSession({ ...target, model: destination });
      const staged: AgentMessageTarget = {
        repoPath: source.repoPath,
        workingDirectory: started.workingDirectory,
        runtimeKind: started.runtimeKind,
        externalSessionId: started.externalSessionId,
        sessionScope: owner.scope,
      };
      attempt.staged = staged;
      attempt.result.handoff.destinationStartedAt = started.startedAt;
      const admissionId = deps.admission.create(staged.runtimeKind, operationKey(input));
      const budget = yield* deps.readDestinationBudget(staged, destination, model.contextWindow);
      const history = prepareRuntimeHandoffHistory({
        segments,
        parts,
        antigravityAdmissionId: staged.runtimeKind === "antigravity" ? admissionId : undefined,
        ...budget,
        digest: deps.digestPrefix,
      });
      if (!history)
        return yield* invalid(
          "Earlier messages do not fit this model's available context. Choose a larger model or shorten the draft.",
        );
      attempt.receipt = history.receipt;
      attempt.partialHistory = history.partialHistory;
      yield* requireHandoffSourceReady(source, deps.runtime, deps.ensureNoScheduledWork);
      attempt.admissionId = admissionId;
      const outcome = yield* sendOutcome(
        deps.runtime.sendUserMessage({
          ...staged,
          systemPrompt,
          parts,
          submissionId: input.submissionId,
          delivery: "new_turn",
          handoff: { admissionId, historyPrefix: history.prefix },
        }),
      );
      const acceptedFailure =
        outcome.kind === "accepted_then_failed" && "acceptedMessage" in outcome.error.failure
          ? outcome.error.failure
          : null;
      if (outcome.kind === "accepted_then_failed" && acceptedFailure) {
        attempt.acceptedFailure = {
          ...failure(
            acceptedFailure.stage,
            outcome.error.message,
            "Review the destination transcript and reload its history if needed.",
          ),
          code: acceptedFailure.kind,
        };
      }
      const accepted =
        outcome.kind === "accepted" ? outcome.acceptedMessage : acceptedFailure?.acceptedMessage;
      if (accepted?.type === "user_message" && accepted.messageId === admissionId) {
        yield* settleAccepted(attempt, admissionId);
        return;
      }
      if (outcome.kind !== "busy" && outcome.kind !== "refused") {
        if (attempt.observedAdmission) {
          yield* settleAccepted(attempt, admissionId);
          return;
        }
        attempt.result.nativeOutcome = "uncertain";
        attempt.result.failure = failure(
          "send",
          outcome.kind === "unknown"
            ? outcome.error.message
            : "The runtime returned an unrecognized handoff receipt.",
          "Check delivery before sending again.",
        );
        return;
      }
      attempt.result.nativeOutcome = "refused";
      return yield* invalid(outcome.error.message);
    });

  return {
    send: (input: AgentChatHandoffSendInput) =>
      workers
        .run(
          Effect.gen(function* () {
            const owner = yield* deps.resolveOwner(input.chat);
            yield* owner.requireWritable;
            const ref = { ...input.expectedActive, repoPath: input.chat.repoPath };
            const source = { ...ref, sessionScope: owner.scope };
            return yield* deps.withRootLock(
              source,
              deps.policyFor(owner.scope).run(
                source,
                "handoff",
                Effect.gen(function* () {
                  const key = operationKey(input);
                  const previous = attempts.get(key);
                  if (previous) return previous.result;
                  const current = yield* deps.resolveOwner(input.chat);
                  yield* current.requireWritable;
                  if (!agentSessionRefsEqual(source, { ...current.active, repoPath: ref.repoPath }))
                    return yield* invalid(
                      "The active runtime changed. Reopen the chat and confirm the destination before sending.",
                    );
                  if (byChat.has(handoffChatKey(input.chat)))
                    return yield* invalid(
                      "Check the pending handoff before sending another message.",
                    );
                  const attempt: PendingHandoff = { result: newHandoffResult(input) };
                  attempts.set(key, attempt);
                  byChat.set(handoffChatKey(input.chat), attempt);
                  yield* publish(attempt);
                  const sent = yield* Effect.result(
                    deps.worktreeReads.runWorktreeRead(
                      source.workingDirectory,
                      runSend(input, attempt, current, source),
                    ),
                  );
                  if (sent._tag === "Failure") {
                    const released = yield* Effect.result(
                      releaseStagedHandoff(attempt, deps.runtime.releaseSession),
                    );
                    attempt.result.failure = failure(
                      "handoff",
                      released._tag === "Success"
                        ? sent.failure.message
                        : `${sent.failure.message} ${released.failure.message}`,
                      "Review the failure, then retry or choose the source runtime to keep editing.",
                    );
                    byChat.delete(handoffChatKey(input.chat));
                  }
                  attempt.result.pending = false;
                  yield* publish(attempt);
                  return attempt.result;
                }),
              ),
            );
          }),
        )
        .pipe(
          Effect.catch((cause) =>
            Effect.sync(() => {
              const key = operationKey(input);
              const previous = attempts.get(key);
              if (previous) return previous.result;
              const result = newHandoffResult(input);
              result.pending = false;
              result.failure = failure(
                "admission",
                cause.message,
                "Resolve the reported issue before retrying the handoff.",
              );
              attempts.set(key, { result });
              return result;
            }),
          ),
        ),
    check: (input: AgentChatHandoffCheckInput) =>
      workers.run(
        Effect.gen(function* () {
          const attempt = attempts.get(operationKey(input));
          const owner = yield* deps.resolveOwner(input.chat);
          if (!attempt) {
            const restored = restoredHandoffResult(input, owner.links, (link) =>
              deps.admission.matches(link.to.runtimeKind, operationKey(input), link.firstMessageId),
            );
            if (!restored)
              return yield* unknownHandoffSubmission(
                { ...owner.active, repoPath: input.chat.repoPath },
                input.submissionId,
              );
            const publication = yield* Effect.result(deps.publishOwner(input.chat));
            if (publication._tag === "Failure")
              restored.failure = failure(
                "publish",
                publication.failure.message,
                "Reopen the chat to see the committed handoff.",
              );
            return restored;
          }
          if (attempt.result.handoff.committed) return attempt.result;
          const source = { ...attempt.result.ref, sessionScope: owner.scope };
          return yield* deps.policyFor(owner.scope).run(
            source,
            "check handoff",
            Effect.gen(function* () {
              const accepted = attempt.result.handoff.acceptedLink;
              if (accepted && !attempt.result.handoff.committed) {
                yield* owner.requireWritable;
                yield* settleAccepted(attempt, accepted.firstMessageId);
              } else if (attempt.result.nativeOutcome === "uncertain" && attempt.staged) {
                yield* owner.requireWritable;
                const read = yield* Effect.result(deps.readStagedHistory(attempt.staged));
                const matched =
                  read._tag === "Success" &&
                  read.success.find(
                    (message) =>
                      message.role === "user" &&
                      message.state === "read" &&
                      message.messageId === attempt.admissionId,
                  );
                if (matched) yield* settleAccepted(attempt, matched.messageId);
                else {
                  attempt.result.failure = failure(
                    "check",
                    read._tag === "Failure"
                      ? read.failure.message
                      : "The destination has no conclusive receipt yet.",
                    "Keep the draft and check delivery again later.",
                  );
                  yield* publish(attempt);
                }
              }
              return attempt.result;
            }),
          );
        }),
      ),
    hasUnresolvedHandoff: (chat: AgentChatRef): boolean => byChat.has(handoffChatKey(chat)),
    hasUnresolvedWorkspaceHandoff: (workspaceId: string) =>
      [...byChat.values()].some(({ result }) => result.handoff.chat.workspaceId === workspaceId),
    hasUnresolvedTaskHandoff: (ref: { workspaceId: string; taskId: string }) =>
      [...byChat.values()].some(({ result }) => {
        const { chat } = result.handoff;
        return (
          chat.kind === "task_session" &&
          chat.workspaceId === ref.workspaceId &&
          chat.taskId === ref.taskId
        );
      }),
    guardWork: (target: AgentMessageTarget) =>
      Effect.gen(function* () {
        for (const attempt of byChat.values()) {
          if (
            agentSessionRefsEqual(target, attempt.result.ref) ||
            (attempt.staged && agentSessionRefsEqual(target, attempt.staged))
          )
            return yield* invalid(
              "Check the pending handoff before starting more work in this chat.",
            );
        }
        yield* deps.checkActiveMember(target);
      }),
    stagedOwners: () =>
      [...byChat.values()].flatMap(({ staged, result }) =>
        staged ? [{ target: staged, chat: result.handoff.chat }] : [],
      ),
    isStagedHandoffMember: (ref: AgentMessageTarget) =>
      hasStagedHandoffDestination(byChat.values(), ref),
    acceptedDestination: (ref: AgentSessionLiveRef, scope: AgentSessionScope | undefined) =>
      findAcceptedHandoffDestination(byChat.values(), ref, scope),
    observe: (envelope: AgentSessionLiveEnvelope) => {
      if (
        envelope.type !== "transcript_event" ||
        envelope.event.type !== "user_message" ||
        envelope.event.state === "pending"
      )
        return;
      for (const attempt of byChat.values()) {
        if (
          !attempt.staged ||
          !agentSessionRefsEqual(attempt.staged, envelope.event.sessionRef) ||
          envelope.event.messageId !== attempt.admissionId
        )
          continue;
        attempt.observedAdmission = true;
        if (attempt.result.nativeOutcome === "uncertain") {
          const staged = attempt.staged;
          const accepted = envelope.event.messageId;
          const scope = staged.sessionScope;
          Effect.runFork(
            workers.run(
              deps.policyFor(scope).run(
                { ...attempt.result.ref, sessionScope: scope },
                "settle handoff",
                Effect.suspend(() =>
                  attempt.result.nativeOutcome === "uncertain"
                    ? settleAccepted(attempt, accepted)
                    : Effect.void,
                ),
              ),
            ),
          );
        }
      }
    },
    projectEvent: (envelope: AgentSessionLiveEnvelope) =>
      projectHandoffEnvelope(
        envelope,
        (event) =>
          Effect.gen(function* () {
            const attempt = [...byChat.values()].find(
              ({ staged, admissionId }) =>
                staged &&
                agentSessionRefsEqual(staged, event.sessionRef) &&
                admissionId === event.messageId,
            );
            if (attempt?.receipt) return attempt.receipt;
            const own = yield* deps.readPrefix(event.sessionRef);
            if (own?.firstMessageId === event.messageId) return own.receipt;
            const candidate = readFramedHandoffReceipt(event.message, deps.digestPrefix);
            const match = candidate ? yield* deps.readPrefix(event.sessionRef, candidate) : null;
            return match?.receipt ?? null;
          }),
        deps.digestPrefix,
      ),
    shutdown: workers.shutdown,
  };
};
