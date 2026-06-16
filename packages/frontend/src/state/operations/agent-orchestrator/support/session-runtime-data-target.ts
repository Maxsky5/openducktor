import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionRef, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { findRuntimeDefinition, runtimeSupportsCapability } from "@/lib/agent-runtime";
import { getAgentSessionActivityStateFromSession } from "@/lib/agent-session-activity-state";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import { isSessionHistoryLoaded } from "@/state/operations/agent-orchestrator/lifecycle/session-history-loader";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { resolveRuntimeWorkingDirectoryRefState } from "./session-runtime-ref";

export type SessionRuntimeDataTarget =
  | {
      kind: "none";
    }
  | {
      kind: "blocked";
      supportError: string;
    }
  | {
      kind: "modelCatalog";
      runtimeRef: RuntimeWorkingDirectoryRef;
    }
  | {
      kind: "modelCatalogAndTodos";
      runtimeRef: RuntimeWorkingDirectoryRef;
      todosSessionRef: AgentSessionRef;
    };

type ResolveSessionRuntimeDataTargetArgs = {
  repoPath: string | null;
  session: AgentSessionState | null;
  runtimeDefinitions: RuntimeDescriptor[];
  repoReadinessState: RepoRuntimeReadinessState;
};

export const resolveSessionRuntimeDataTarget = ({
  repoPath,
  session,
  runtimeDefinitions,
  repoReadinessState,
}: ResolveSessionRuntimeDataTargetArgs): SessionRuntimeDataTarget => {
  const { runtimeRef, runtimeRefError } = resolveRuntimeWorkingDirectoryRefState({
    repoPath,
    session,
  });

  if (!session) {
    return { kind: "none" };
  }

  if (runtimeRefError) {
    return {
      kind: "blocked",
      supportError: runtimeRefError,
    };
  }

  const activityState = getAgentSessionActivityStateFromSession(session);
  if (repoReadinessState !== "ready" || runtimeRef === null || activityState === "starting") {
    return { kind: "none" };
  }

  const runtimeDefinition = session?.runtimeKind
    ? findRuntimeDefinition(runtimeDefinitions, session.runtimeKind)
    : null;
  const supportsTodos = runtimeDefinition
    ? runtimeSupportsCapability(runtimeDefinition, "optionalSurfaces.supportsTodos")
    : false;

  if (!supportsTodos || !isSessionHistoryLoaded(session)) {
    return {
      kind: "modelCatalog",
      runtimeRef,
    };
  }

  return {
    kind: "modelCatalogAndTodos",
    runtimeRef,
    todosSessionRef: {
      ...runtimeRef,
      externalSessionId: session.externalSessionId,
    },
  };
};
