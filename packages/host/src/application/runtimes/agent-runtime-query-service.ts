import type { AgentSessionScope, RepoRuntimeRef, RuntimeDescriptor } from "@openducktor/contracts";
import { agentSessionRefsEqual } from "@openducktor/core";
import { Effect } from "effect";
import type { AgentRuntimeQueryPort } from "../../ports/agent-runtime-query-port";
import type {
  AgentSessionLiveAdapterPort,
  AgentSessionLiveAdapterRegistryPort,
} from "../../ports/agent-session-live-adapter-port";
import type { GitPort } from "../../ports/git-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { TaskReader } from "../../ports/task-repository-ports";
import type { TaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { resolveRepoPath } from "./runtime-orchestrator-model";
import {
  requireRuntimeWorkingDirectory,
  type RuntimeWorkingDirectoryDependencies,
} from "./runtime-working-directory";
import { runtimeQueryError, type RuntimeQueryError } from "../../ports/runtime-query-error";

export type AgentRuntimeQueryDependencies = RuntimeWorkingDirectoryDependencies & {
  adapterRegistry: AgentSessionLiveAdapterRegistryPort;
  runtimeRegistry: Pick<RuntimeRegistryPort, "findWorkspaceRuntime">;
  gitPort: Pick<GitPort, "canonicalizePath" | "isGitRepository">;
  taskReader: Pick<TaskReader, "getTaskMetadata">;
  worktreeReads: Pick<TaskSessionLifecycleCoordinator, "runWorktreeRead">;
};

type QueryInput = RepoRuntimeRef & {
  workingDirectory?: string;
  externalSessionId?: string;
  sessionScope?: AgentSessionScope | undefined;
};

type QueryMethod = keyof AgentRuntimeQueryPort;
const supportsQuery = (runtime: RuntimeDescriptor, method: QueryMethod): boolean => {
  const { promptInput, optionalSurfaces, history } = runtime.capabilities;
  switch (method) {
    case "listAvailableModels":
      return true;
    case "listAvailableSlashCommands":
      return promptInput.supportsSlashCommands;
    case "listAvailableSkills":
      return promptInput.supportsSkillReferences;
    case "listAvailableSubagents":
      return promptInput.supportsSubagentReferences;
    case "searchFiles":
      return promptInput.supportsFileSearch;
    case "loadSessionHistory":
      return history.loadable;
    case "loadSessionTodos":
      return optionalSurfaces.supportsTodos;
    case "loadSessionDiff":
      return optionalSurfaces.supportsDiff;
    case "loadFileStatus":
      return optionalSurfaces.supportsFileStatus;
  }
};

const requireSessionScope = (
  dependencies: AgentRuntimeQueryDependencies,
  adapter: AgentSessionLiveAdapterPort,
  input: QueryInput,
  operation: string,
) =>
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
    const metadata = yield* dependencies.taskReader
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
      // Native lineage proves a relationship. Only the ODT record above proves task ownership.
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

export const createAgentRuntimeQueryService = (
  dependencies: AgentRuntimeQueryDependencies,
): AgentRuntimeQueryPort => {
  const resolveAdapter = (input: RepoRuntimeRef, operation: string) =>
    Effect.gen(function* () {
      const runtime = yield* dependencies.runtimeRegistry
        .findWorkspaceRuntime(input)
        .pipe(
          Effect.mapError((cause) =>
            runtimeQueryError(
              operation,
              input,
              "runtime_unavailable",
              "Cannot resolve the selected runtime. Start it from the runtime controls.",
              cause,
            ),
          ),
        );
      const adapter = yield* dependencies.adapterRegistry
        .resolveForScope(input)
        .pipe(
          Effect.mapError((cause) =>
            runtimeQueryError(
              operation,
              input,
              "runtime_unavailable",
              "The selected runtime has no active query adapter. Start it from the runtime controls.",
              cause,
            ),
          ),
        );
      if (
        !runtime ||
        runtime.runtimeId !== adapter.binding.runtimeId ||
        runtime.kind !== input.runtimeKind ||
        runtime.repoPath !== input.repoPath
      ) {
        return yield* runtimeQueryError(
          operation,
          input,
          "runtime_unavailable",
          "The selected runtime changed or stopped. Reload the runtime data.",
        );
      }
      return { runtime, adapter };
    });

  const read = <Input extends QueryInput, Result>(
    method: QueryMethod,
    input: Input,
    invoke: (
      queries: AgentRuntimeQueryPort,
      input: Input,
    ) => Effect.Effect<Result, RuntimeQueryError>,
  ): Effect.Effect<Result, RuntimeQueryError> =>
    Effect.gen(function* () {
      const repoPath = yield* resolveRepoPath(dependencies.gitPort, input.repoPath).pipe(
        Effect.mapError((cause) =>
          runtimeQueryError(
            method,
            input,
            "scope_mismatch",
            "The selected repository is missing or inaccessible. Check the repository path.",
            cause,
          ),
        ),
      );
      const request = { ...input, repoPath };
      const directory = input.workingDirectory ?? repoPath;
      return yield* dependencies.worktreeReads.runWorktreeRead(
        directory,
        Effect.gen(function* () {
          yield* requireRuntimeWorkingDirectory(dependencies, {
            repoPath,
            workingDirectory: directory,
          }).pipe(
            Effect.mapError((cause) =>
              runtimeQueryError(
                method,
                request,
                "scope_mismatch",
                "The working directory is missing, inaccessible, or outside the selected workspace. Select an existing workspace directory.",
                cause,
              ),
            ),
          );
          const { runtime, adapter } = yield* resolveAdapter(request, method);
          if (!supportsQuery(runtime.descriptor, method)) {
            return yield* runtimeQueryError(
              method,
              request,
              "unsupported_operation",
              `${runtime.descriptor.label} does not support this read.`,
            );
          }
          yield* requireSessionScope(dependencies, adapter, request, method);
          const result = yield* invoke(adapter.queries, request);
          const current = yield* resolveAdapter(request, method);
          if (current.adapter !== adapter) {
            return yield* runtimeQueryError(
              method,
              request,
              "runtime_unavailable",
              "The runtime changed during this read. Reload the runtime data.",
            );
          }
          return result;
        }),
      );
    });

  return {
    listAvailableModels: (input) =>
      read("listAvailableModels", input, (queries, request) =>
        queries.listAvailableModels(request),
      ),
    listAvailableSlashCommands: (input) =>
      read("listAvailableSlashCommands", input, (queries, request) =>
        queries.listAvailableSlashCommands(request),
      ),
    listAvailableSkills: (input) =>
      read("listAvailableSkills", input, (queries, request) =>
        queries.listAvailableSkills(request),
      ),
    listAvailableSubagents: (input) =>
      read("listAvailableSubagents", input, (queries, request) =>
        queries.listAvailableSubagents(request),
      ),
    searchFiles: (input) =>
      read("searchFiles", input, (queries, request) => queries.searchFiles(request)),
    loadSessionHistory: (input) =>
      read("loadSessionHistory", input, (queries, request) => queries.loadSessionHistory(request)),
    loadSessionTodos: (input) =>
      read("loadSessionTodos", input, (queries, request) => queries.loadSessionTodos(request)),
    loadSessionDiff: (input) =>
      read("loadSessionDiff", input, (queries, request) => queries.loadSessionDiff(request)),
    loadFileStatus: (input) =>
      read("loadFileStatus", input, (queries, request) => queries.loadFileStatus(request)),
  };
};
