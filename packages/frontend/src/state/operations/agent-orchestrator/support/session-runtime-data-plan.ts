import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionRef, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { findRuntimeDefinition, runtimeSupportsCapability } from "@/lib/agent-runtime";
import type { SessionRepoReadinessState } from "../lifecycle/session-view-lifecycle";
import {
  type RuntimeWorkingDirectoryAccessState,
  resolveRuntimeWorkingDirectoryRefState,
} from "./session-runtime-ref";

type SessionRuntimeDataPlanSession = RuntimeWorkingDirectoryAccessState & {
  externalSessionId: string;
  status: "starting" | "running" | "idle" | "error" | "stopped";
};

export type SessionRuntimeDataPlan = {
  runtimeRef: RuntimeWorkingDirectoryRef | null;
  sessionRef: AgentSessionRef | null;
  runtimeDataSupportError: string | null;
  canReadModelCatalog: boolean;
  canReadTodos: boolean;
};

export const deriveSessionRuntimeDataPlan = ({
  repoPath,
  session,
  runtimeDefinitions,
  repoReadinessState,
}: {
  repoPath: string | null;
  session: SessionRuntimeDataPlanSession | null;
  runtimeDefinitions: RuntimeDescriptor[];
  repoReadinessState: SessionRepoReadinessState;
}): SessionRuntimeDataPlan => {
  const { runtimeRef, runtimeRefError } = resolveRuntimeWorkingDirectoryRefState({
    repoPath,
    session,
  });
  const canReadModelCatalog =
    repoReadinessState === "ready" &&
    runtimeRef !== null &&
    runtimeRefError === null &&
    session?.status !== "starting";
  const runtimeDefinition = session?.runtimeKind
    ? findRuntimeDefinition(runtimeDefinitions, session.runtimeKind)
    : null;
  const supportsTodos = runtimeDefinition
    ? runtimeSupportsCapability(runtimeDefinition, "optionalSurfaces.supportsTodos")
    : false;
  const sessionRef =
    runtimeRef && session
      ? {
          ...runtimeRef,
          externalSessionId: session.externalSessionId,
        }
      : null;

  return {
    runtimeRef,
    sessionRef,
    runtimeDataSupportError: runtimeRefError,
    canReadModelCatalog,
    canReadTodos: canReadModelCatalog && sessionRef !== null && supportsTodos,
  };
};
