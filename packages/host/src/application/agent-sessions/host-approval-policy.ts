import type {
  AgentSessionAuthorizedRoot,
  AgentSessionLiveEnvelope,
  AgentSessionLivePendingApprovalRequest,
  AgentSessionLiveReplyApprovalInput,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  RuntimeDescriptor,
} from "@openducktor/contracts";
import { agentSessionRefKey, normalizeOdtWorkflowToolName } from "@openducktor/core";
import type { TaskWorkflowRole } from "@openducktor/workflows";
import { Deferred, Effect, Exit, FiberSet, Scope } from "effect";
import { HostValidationError, type HostError, errorMessage } from "../../effect/host-errors";
import { requireWorkflowRole } from "../tasks/support/task-workflow-events";
import type { RuntimeDefinitionsService } from "../runtimes/runtime-definitions-service";
import { resolveRuntimeDescriptor } from "../runtimes/runtime-request-resolution";
import type { AgentSessionLiveStateService } from "./agent-session-live-state-service";
import type { createSessionTurnPreparation } from "./session-turn-preparation";
import { resolveOwnedSessionRoot } from "./session-owner-resolution";
import { createHostOperationWorkers } from "../../effect/host-operation-workers";

/** A read-only role may use the workflow tools of its policy. Reject its other tools that write. */
const requiresReadOnlyApprovalRejection = (
  role: TaskWorkflowRole,
  request: AgentSessionLivePendingApprovalRequest,
  descriptor: RuntimeDescriptor,
): boolean => {
  if (role.workspaceAccess !== "read") return false;
  let permittedWorkflowTool = false;
  for (const name of [request.action?.name, request.tool?.name]) {
    if (!name) continue;
    const canonical = normalizeOdtWorkflowToolName(name, descriptor.workflowToolAliasesByCanonical);
    if (canonical) {
      if (!role.tools.some((tool) => tool === canonical)) return true;
      permittedWorkflowTool = true;
    }
    if (descriptor.readOnlyRoleBlockedTools.includes(name)) return true;
  }
  return !permittedWorkflowTool && request.mutation === "mutating";
};

export const createHostApprovalPolicy = (deps: {
  live: Pick<
    AgentSessionLiveStateService,
    "resolvePendingApproval" | "replyApproval" | "list" | "reportApprovalPolicyFailure"
  >;
  readRoots: (repoPath: string) => Effect.Effect<AgentSessionAuthorizedRoot[], HostError>;
  definitions: RuntimeDefinitionsService;
  preparation: Pick<
    ReturnType<typeof createSessionTurnPreparation>,
    "promptOverrides" | "taskWorkflow"
  >;
  reportFailure: (error: HostError) => Effect.Effect<void>;
}) => {
  const workers = createHostOperationWorkers();
  const scope = Scope.makeUnsafe();
  const background = Effect.runSync(Scope.provide(FiberSet.make<void>(), scope));
  const claims = new Map<string, { done: Deferred.Deferred<void, HostError>; issued: boolean }>();
  type Occurrence = { owner: AgentSessionLiveRef; requestId: string };
  const automatic = new Map<string, Occurrence>();
  const failures = new Map<string, Occurrence & { message: string }>();
  const publishFailures = (owner: AgentSessionLiveRef) => {
    const messages = [...failures.values()]
      .filter((failure) => agentSessionRefKey(failure.owner) === agentSessionRefKey(owner))
      .map((failure) => failure.message);
    return deps.live.reportApprovalPolicyFailure(
      owner,
      messages.length ? messages.join("\n") : null,
    );
  };
  const clearFailure = (key: string) =>
    Effect.suspend(() => {
      const failure = failures.get(key);
      if (!failure) return Effect.void;
      failures.delete(key);
      return publishFailures(failure.owner);
    });
  const clearResolved = (session: AgentSessionLiveSnapshot) =>
    Effect.gen(function* () {
      // Unavailable status does not prove that a native request resolved.
      if (session.statusUnavailableReason) return;
      const resolved = (value: Occurrence) =>
        agentSessionRefKey(value.owner) === agentSessionRefKey(session.ref) &&
        !session.pendingApprovals.some((request) => request.requestId === value.requestId);
      for (const [key, failure] of failures) if (resolved(failure)) yield* clearFailure(key);
      for (const [key, occurrence] of automatic) if (resolved(occurrence)) automatic.delete(key);
    });
  const reply = (
    input: AgentSessionLiveReplyApprovalInput,
    policyOnly = false,
  ): Effect.Effect<void, HostError> =>
    workers.run(
      Effect.suspend(() => {
        let owner: AgentSessionLiveRef = input;
        let requestId = input.requestId;
        let key = `unresolved\u0000${agentSessionRefKey(input)}\u0000${input.requestId}`;
        return Effect.gen(function* () {
          const resolved = yield* deps.live.resolvePendingApproval(input);
          owner = resolved.owner;
          requestId = resolved.request.requestId;
          const unresolvedKey = key;
          key = `${resolved.runtimeId}\u0000${agentSessionRefKey(owner)}\u0000${resolved.request.requestId}`;
          const unresolved = failures.get(unresolvedKey);
          if (unresolved) {
            failures.delete(unresolvedKey);
            failures.set(key, { ...unresolved, owner, requestId });
            if (agentSessionRefKey(unresolved.owner) !== agentSessionRefKey(owner)) {
              yield* publishFailures(unresolved.owner);
              yield* publishFailures(owner);
            }
          }
          // A native ID in a replacement runtime names a new occurrence.
          const replaced = (priorKey: string, occurrence: Occurrence) =>
            priorKey !== key &&
            occurrence.requestId === requestId &&
            agentSessionRefKey(occurrence.owner) === agentSessionRefKey(owner);
          for (const [priorKey, failure] of failures)
            if (replaced(priorKey, failure)) yield* clearFailure(priorKey);
          for (const [priorKey, occurrence] of automatic)
            if (replaced(priorKey, occurrence)) automatic.delete(priorKey);
          if (policyOnly && automatic.has(key)) return;
          if (policyOnly) automatic.set(key, { owner, requestId: resolved.request.requestId });
          const roots = yield* deps.readRoots(resolved.owner.repoPath);
          const sessions = yield* deps.live.list({ repoPath: resolved.owner.repoPath });
          const root = yield* resolveOwnedSessionRoot({ ref: resolved.owner, roots, sessions });
          const descriptor = yield* resolveRuntimeDescriptor(
            deps.definitions,
            resolved.owner.runtimeKind,
          );
          const scope = root.sessionScope;
          const workflowSession =
            scope.kind === "workflow"
              ? {
                  scope,
                  workflow: yield* deps.preparation.taskWorkflow(root.repoPath, scope.taskId),
                }
              : null;
          const workflowRole = workflowSession
            ? yield* requireWorkflowRole(workflowSession.workflow, workflowSession.scope.role)
            : null;
          const reject =
            workflowRole !== null &&
            requiresReadOnlyApprovalRejection(workflowRole, resolved.request, descriptor);
          if (policyOnly && !reject) return;
          const outcome = reject ? "reject" : input.outcome;
          if (
            resolved.request.supportedReplyOutcomes &&
            !resolved.request.supportedReplyOutcomes.includes(outcome)
          )
            return yield* new HostValidationError({
              field: "outcome",
              message:
                "The native approval does not support the required reply. Review the pending request in the selected runtime.",
            });
          const prior = claims.get(key);
          if (prior) return yield* Deferred.await(prior.done);
          const claim = { done: Deferred.makeUnsafe<void, HostError>(), issued: false };
          claims.set(key, claim);
          const work = Effect.gen(function* () {
            let message = input.message;
            if (reject && workflowSession)
              message = workflowSession.workflow.prompts.readOnlyRejection({
                role: workflowSession.scope.role,
                overrides: yield* deps.preparation.promptOverrides(
                  root.repoPath,
                  workflowSession.workflow,
                ),
              });
            const replyInput: AgentSessionLiveReplyApprovalInput = {
              ...resolved.owner,
              requestId: resolved.request.requestId,
              outcome,
            };
            if (message !== undefined) replyInput.message = message;
            yield* deps.live.replyApproval(replyInput, {
              onIssued: () => {
                claim.issued = true;
              },
            });
            yield* clearFailure(key);
          });
          const result = yield* Effect.exit(work);
          if (Exit.isFailure(result) && !claim.issued) claims.delete(key);
          yield* Deferred.done(claim.done, result);
          return yield* Deferred.await(claim.done);
        }).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const message = `Workflow approval policy failed: ${errorMessage(error)} Review the pending request. No permission bypass is available.`;
              if (failures.get(key)?.message !== message) {
                failures.set(key, { owner, requestId, message });
                yield* publishFailures(owner);
              }
              return yield* Effect.fail(error);
            }),
          ),
        );
      }),
    );
  const observe = (envelope: AgentSessionLiveEnvelope) => {
    const sessions =
      envelope.type === "snapshot"
        ? envelope.sessions
        : envelope.type === "session_upsert"
          ? [envelope.session]
          : envelope.type === "task_session_records_updated" && envelope.liveSession
            ? [envelope.liveSession]
            : [];
    if (envelope.type === "task_session_records_updated") {
      Effect.runSync(
        FiberSet.run(
          background,
          reconcile(envelope.repoPath).pipe(Effect.catch(deps.reportFailure)),
        ),
      );
      return;
    }
    for (const session of sessions) {
      Effect.runSync(
        FiberSet.run(background, clearResolved(session).pipe(Effect.catch(deps.reportFailure))),
      );
      if (session.statusUnavailableReason) continue;
      for (const request of session.pendingApprovals) {
        Effect.runSync(
          FiberSet.run(
            background,
            reply({ ...session.ref, requestId: request.requestId, outcome: "reject" }, true).pipe(
              Effect.catch(deps.reportFailure),
            ),
          ),
        );
      }
    }
  };
  const reconcile = (repoPath: string) =>
    Effect.gen(function* () {
      const sessions = yield* deps.live.list({ repoPath });
      for (const [key, occurrence] of automatic)
        if (occurrence.owner.repoPath === repoPath) automatic.delete(key);
      for (const session of sessions) yield* clearResolved(session);
      observe({ type: "snapshot", repoPath, sessions: [...sessions], messageQueues: [] });
    });
  return {
    reply: (input: AgentSessionLiveReplyApprovalInput) => reply(input),
    observe,
    reconcile,
    shutdown: () => Scope.close(scope, Exit.void).pipe(Effect.ensuring(workers.shutdown())),
  };
};
