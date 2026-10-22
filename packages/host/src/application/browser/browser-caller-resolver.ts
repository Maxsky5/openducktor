import {
  type AgentSessionLiveSnapshot,
  type BrowserTabOwner,
  type OdtBrowserCaller,
  RUNTIME_DESCRIPTORS_BY_KIND,
} from "@openducktor/contracts";
import { agentSessionRefsShareRuntimeStream } from "@openducktor/core";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionLiveAdapterBinding } from "../../ports/agent-session-live-adapter-port";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type {
  RuntimeSessionOwner,
  WorkspaceSessionStorePort,
} from "../../ports/workspace-session-store-port";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";
import { BrowserServiceError } from "./browser-service-error";

export type BrowserCallerResolverInput = {
  workspaceId: string;
  caller: OdtBrowserCaller;
};

export type BrowserCallerResolverError =
  | BrowserServiceError
  | HostError
  | TaskStoreError
  | WorkspaceSettingsError;

/** Finds the task or Workspace Session of a browser tool call from the runtime session. */
export type BrowserCallerResolver = {
  resolve(
    input: BrowserCallerResolverInput,
  ): Effect.Effect<BrowserTabOwner, BrowserCallerResolverError>;
};

/** One shared runtime. Its live sessions carry the parent links of subagent sessions. */
type LiveSessionSource = {
  readonly binding: Pick<AgentSessionLiveAdapterBinding, "runtimeKind">;
  listSnapshots(): Effect.Effect<
    ReadonlyArray<Pick<AgentSessionLiveSnapshot, "ref" | "parentExternalSessionId">>,
    HostError
  >;
};

export type CreateBrowserCallerResolverInput = {
  workspaceSettings: Pick<WorkspaceSettingsService, "getRepoConfig">;
  workspaceSessions: Pick<WorkspaceSessionStorePort, "listRuntimeOwners">;
  liveSessions: { list(): ReadonlyArray<LiveSessionSource> };
};

export const createBrowserCallerResolver = ({
  workspaceSettings,
  workspaceSessions,
  liveSessions,
}: CreateBrowserCallerResolverInput): BrowserCallerResolver => {
  /** Child session ID to parent session ID, for the live sessions of one repository. */
  const readParentLinks = (caller: OdtBrowserCaller, repoPath: string) =>
    Effect.gen(function* () {
      const sources = liveSessions
        .list()
        .filter((source) => source.binding.runtimeKind === caller.runtime);
      const snapshots = yield* Effect.forEach(sources, (source) => source.listSnapshots());
      const parents = new Map<string, string>();
      for (const snapshot of snapshots.flat()) {
        if (
          snapshot.parentExternalSessionId !== undefined &&
          agentSessionRefsShareRuntimeStream(snapshot.ref, {
            repoPath,
            runtimeKind: caller.runtime,
          })
        ) {
          parents.set(snapshot.ref.externalSessionId, snapshot.parentExternalSessionId);
        }
      }
      return parents;
    });

  return {
    resolve: ({ workspaceId, caller }) =>
      Effect.gen(function* () {
        const { repoPath } = yield* workspaceSettings.getRepoConfig(workspaceId);
        const owners = (yield* workspaceSessions.listRuntimeOwners({
          workspaceId,
          repoPath,
        })).filter((owner) => owner.runtimeKind === caller.runtime);
        const toTabOwner = (owner: RuntimeSessionOwner) => {
          if (owner.kind === "task") {
            return Effect.succeed<BrowserTabOwner>({
              kind: "task",
              workspaceId,
              taskId: owner.taskId,
            });
          }
          if (owner.archived) {
            return Effect.fail(unmanagedCaller(caller, "belongs to an archived Workspace Session"));
          }
          return Effect.succeed<BrowserTabOwner>({
            kind: "workspace_session",
            workspaceId,
            sessionId: owner.sessionId,
          });
        };

        // A subagent session calls with its own ID. Its live parent links lead to the root.
        let parents: Map<string, string> | undefined;
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
            return yield* toTabOwner(owner);
          }
          parents ??= yield* readParentLinks(caller, repoPath);
          const parentId = parents.get(sessionId);
          if (parentId === undefined) {
            return yield* unmanagedCaller(
              caller,
              "does not belong to a task or an active Workspace Session of this workspace",
            );
          }
          if (visited.has(parentId)) {
            return yield* unmanagedCaller(caller, "has session parent links that contain a cycle");
          }
          sessionId = parentId;
        }
      }),
  };
};

const unmanagedCaller = (caller: OdtBrowserCaller, reason: string): BrowserServiceError =>
  new BrowserServiceError({
    code: "browser_unmanaged_caller",
    operation: "browser.resolveCaller",
    message: `Browser tools need a managed OpenDucktor session. The ${RUNTIME_DESCRIPTORS_BY_KIND[caller.runtime].label} session '${caller.runtimeSessionId}' ${reason}.`,
    details: { runtime: caller.runtime, runtimeSessionId: caller.runtimeSessionId },
  });
