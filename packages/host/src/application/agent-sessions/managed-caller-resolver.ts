import {
  type AgentSessionLiveSnapshot,
  type OdtCaller,
  RUNTIME_DESCRIPTORS_BY_KIND,
  RUNTIME_HOST_TRAITS_BY_KIND,
} from "@openducktor/contracts";
import { agentSessionRefsShareRuntimeStream } from "@openducktor/core";
import { Effect } from "effect";
import { type HostError, HostValidationError } from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterBinding,
  AgentSessionLiveAdapterPort,
} from "../../ports/agent-session-live-adapter-port";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type {
  RuntimeSessionOwner,
  WorkspaceSessionStorePort,
} from "../../ports/workspace-session-store-port";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";

export type ManagedCallerResolverInput = {
  workspaceId: string;
  caller: OdtCaller;
};

export type ManagedCallerResolverError = HostError | TaskStoreError | WorkspaceSettingsError;

/** Resolves a runtime caller to its saved root session and workflow role. */
export type ManagedCallerResolver = {
  resolve(
    input: ManagedCallerResolverInput,
  ): Effect.Effect<RuntimeSessionOwner, ManagedCallerResolverError>;
};

/** One shared runtime. Its live sessions carry the parent links of subagent sessions. */
type LiveSessionSource = Pick<AgentSessionLiveAdapterPort, "resolveCallerBinding"> & {
  readonly binding: Pick<AgentSessionLiveAdapterBinding, "runtimeKind">;
  listSnapshots(): Effect.Effect<
    ReadonlyArray<Pick<AgentSessionLiveSnapshot, "ref" | "parentExternalSessionId">>,
    HostError
  >;
};

export type CreateManagedCallerResolverInput = {
  workspaceSettings: Pick<WorkspaceSettingsService, "getRepoConfig">;
  workspaceSessions: Pick<WorkspaceSessionStorePort, "listRuntimeOwners">;
  liveSessions: { list(): ReadonlyArray<LiveSessionSource> };
  stagedOwners?: ((workspaceId: string) => readonly RuntimeSessionOwner[]) | undefined;
};

export const createManagedCallerResolver = ({
  workspaceSettings,
  workspaceSessions,
  liveSessions,
  stagedOwners,
}: CreateManagedCallerResolverInput): ManagedCallerResolver => {
  /**
   * The session that holds a caller binding. A runtime that starts the MCP process before the
   * session has an ID names a binding, and its live adapter resolves it.
   */
  const toRuntimeSessionCaller = (
    caller: OdtCaller,
  ): Effect.Effect<RuntimeCaller, ManagedCallerResolverError> => {
    if (!("callerBindingId" in caller)) return Effect.succeed(caller);
    return Effect.gen(function* () {
      const label = RUNTIME_DESCRIPTORS_BY_KIND[caller.runtime].label;
      if (RUNTIME_HOST_TRAITS_BY_KIND[caller.runtime].mcpCaller.source !== "process_binding")
        return yield* unmanagedCaller(caller, `names a caller binding, but ${label} uses none`);
      for (const source of liveSessions.list()) {
        // Only the live adapter of a runtime that uses caller bindings resolves them.
        if (source.binding.runtimeKind !== caller.runtime || !source.resolveCallerBinding) continue;
        const ref = yield* source.resolveCallerBinding(caller.callerBindingId);
        if (ref) return { runtime: caller.runtime, runtimeSessionId: ref.externalSessionId };
      }
      return yield* unmanagedCaller(caller, `is not open in a running ${label} runtime`);
    });
  };

  /** Child session ID to parent session ID, for the live sessions of one repository. */
  const readParentLinks = (caller: RuntimeCaller, repoPath: string) =>
    Effect.gen(function* () {
      const sources = liveSessions
        .list()
        .filter((source) => source.binding.runtimeKind === caller.runtime);
      const snapshots = yield* Effect.forEach(sources, (source) => source.listSnapshots());
      const parents = new Map<string, string | null>();
      for (const snapshot of snapshots.flat()) {
        if (
          snapshot.parentExternalSessionId !== undefined &&
          agentSessionRefsShareRuntimeStream(snapshot.ref, {
            repoPath,
            runtimeKind: caller.runtime,
          })
        ) {
          const previousParent = parents.get(snapshot.ref.externalSessionId);
          parents.set(
            snapshot.ref.externalSessionId,
            previousParent !== undefined && previousParent !== snapshot.parentExternalSessionId
              ? null
              : snapshot.parentExternalSessionId,
          );
        }
      }
      return parents;
    });

  return {
    resolve: ({ workspaceId, caller: nativeCaller }) =>
      Effect.gen(function* () {
        const caller = yield* toRuntimeSessionCaller(nativeCaller);
        const { repoPath } = yield* workspaceSettings.getRepoConfig(workspaceId);
        const readOwners = (externalSessionIds: readonly string[]) =>
          workspaceSessions
            .listRuntimeOwners({
              workspaceId,
              repoPath,
              filter: { runtimeKind: caller.runtime, externalSessionIds },
            })
            .pipe(
              Effect.map((saved) => [
                ...saved,
                ...(stagedOwners?.(workspaceId) ?? []).filter(
                  (owner) =>
                    owner.runtimeKind === caller.runtime &&
                    externalSessionIds.includes(owner.externalSessionId) &&
                    !saved.some(
                      (record) =>
                        record.runtimeKind === owner.runtimeKind &&
                        record.externalSessionId === owner.externalSessionId,
                    ),
                ),
              ]),
            );
        let owners = yield* readOwners([caller.runtimeSessionId]);
        // A subagent session calls with its own ID. Its live parent links lead to the root.
        let parents: Map<string, string | null> | undefined;
        let sessionId = caller.runtimeSessionId;
        const visited = new Set<string>();
        while (true) {
          visited.add(sessionId);
          const matches = owners.filter((owner) => owner.externalSessionId === sessionId);
          const [owner] = matches;
          if (matches.length > 1) {
            return yield* unmanagedCaller(
              caller,
              "has a root session that more than one task or Workspace Session owns",
            );
          }
          if (owner) {
            if (owner.kind === "workspace" && owner.archived) {
              return yield* unmanagedCaller(caller, "belongs to an archived Workspace Session");
            }
            return owner;
          }
          if (parents === undefined) {
            parents = yield* readParentLinks(caller, repoPath);
            const ancestors: string[] = [];
            const seen = new Set([sessionId]);
            let ancestor = parents.get(sessionId);
            while (ancestor !== undefined && ancestor !== null && !seen.has(ancestor)) {
              ancestors.push(ancestor);
              seen.add(ancestor);
              ancestor = parents.get(ancestor);
            }
            owners = ancestors.length === 0 ? [] : yield* readOwners(ancestors);
          }
          const parentId = parents.get(sessionId);
          if (parentId === undefined) {
            return yield* unmanagedCaller(
              caller,
              "does not belong to a task or an active Workspace Session of this workspace",
            );
          }
          if (parentId === null) {
            return yield* unmanagedCaller(caller, "has conflicting session parent links");
          }
          if (visited.has(parentId)) {
            return yield* unmanagedCaller(caller, "has session parent links that contain a cycle");
          }
          sessionId = parentId;
        }
      }),
  };
};

/** A caller that names its runtime session. */
type RuntimeCaller = { runtime: OdtCaller["runtime"]; runtimeSessionId: string };

const unmanagedCaller = (caller: OdtCaller, reason: string) => {
  const label = RUNTIME_DESCRIPTORS_BY_KIND[caller.runtime].label;
  const session =
    "runtimeSessionId" in caller
      ? `session '${caller.runtimeSessionId}'`
      : `session with caller binding '${caller.callerBindingId}'`;
  const details = { operation: "managedCaller.resolve", ...caller };
  return new HostValidationError<typeof details>({
    field: "caller",
    message: `The ${label} ${session} ${reason}.`,
    details,
  });
};
