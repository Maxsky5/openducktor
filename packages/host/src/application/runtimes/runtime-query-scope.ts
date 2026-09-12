import type { AgentSessionScope, RepoRuntimeRef } from "@openducktor/contracts";
import { agentSessionRefsEqual } from "@openducktor/core";
import { Effect } from "effect";
import type { AgentSessionLiveAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type { TaskReader } from "../../ports/task-repository-ports";
import { runtimeQueryError, type RuntimeQueryError } from "../../ports/runtime-query-error";

export type QueryInput = RepoRuntimeRef & {
  workingDirectory?: string;
  externalSessionId?: string;
  sessionScope?: AgentSessionScope | undefined;
};

/**
 * Check session identity and workflow ownership without binding the session.
 * Native parent links must lead to a stored task session; they do not grant ownership.
 */
export const requireSessionScope = (
  taskReader: Pick<TaskReader, "getTaskMetadata">,
  adapter: AgentSessionLiveAdapterPort,
  input: QueryInput,
  operation: string,
): Effect.Effect<void, RuntimeQueryError> =>
  Effect.gen(function* () {
    if (input.externalSessionId === undefined || input.workingDirectory === undefined) return;
    const ref = {
      ...input,
      externalSessionId: input.externalSessionId,
      workingDirectory: input.workingDirectory,
    };
    const snapshot = yield* adapter
      .readSnapshot(ref)
      .pipe(
        Effect.mapError((cause) =>
          runtimeQueryError(
            operation,
            input,
            "scope_mismatch",
            "Cannot verify the selected session. Reload the session list.",
            cause,
          ),
        ),
      );
    if (snapshot.type === "live" && !agentSessionRefsEqual(snapshot.session.ref, ref)) {
      return yield* runtimeQueryError(
        operation,
        input,
        "scope_mismatch",
        "The selected session does not match the requested repository or directory. Select the session again.",
      );
    }
    if (input.sessionScope?.kind !== "workflow") return;
    const scope = input.sessionScope;
    const metadata = yield* taskReader
      .getTaskMetadata({ repoPath: input.repoPath, taskId: scope.taskId })
      .pipe(
        Effect.mapError((cause) =>
          runtimeQueryError(
            operation,
            input,
            "scope_mismatch",
            "Cannot read this task's session ownership records. Reload the task.",
            cause,
          ),
        ),
      );
    let owner = snapshot;
    let ownerRef = ref;
    const visited = new Set([ref.externalSessionId]);
    while (true) {
      const record = metadata.agentSessions.find((entry) =>
        agentSessionRefsEqual({ ...entry, repoPath: input.repoPath }, ownerRef),
      );
      if (record) {
        if (record.role !== scope.role) {
          return yield* runtimeQueryError(
            operation,
            input,
            "scope_mismatch",
            "The selected session belongs to a different workflow role. Select the matching session.",
          );
        }
        return;
      }
      const parentId =
        owner.type === "live" && owner.session.parentExternalSessionId
          ? owner.session.parentExternalSessionId
          : yield* adapter.queries.resolveSessionParent(ownerRef);
      if (parentId === null) {
        return yield* runtimeQueryError(
          operation,
          input,
          "scope_mismatch",
          "This task has no ownership record for the selected session. Select a session recorded for this task.",
        );
      }
      if (visited.has(parentId)) {
        return yield* runtimeQueryError(
          operation,
          input,
          "scope_mismatch",
          "The session parent chain is invalid. Reload the session list.",
        );
      }
      visited.add(parentId);
      ownerRef = { ...ref, externalSessionId: parentId };
      owner = yield* adapter
        .readSnapshot(ownerRef)
        .pipe(
          Effect.mapError((cause) =>
            runtimeQueryError(
              operation,
              input,
              "scope_mismatch",
              "Cannot verify the selected session parent. Reload the session list.",
              cause,
            ),
          ),
        );
      if (owner.type === "live" && !agentSessionRefsEqual(owner.session.ref, ownerRef)) {
        return yield* runtimeQueryError(
          operation,
          input,
          "scope_mismatch",
          "The session parent belongs to a different directory. Select the matching session.",
        );
      }
    }
  });
