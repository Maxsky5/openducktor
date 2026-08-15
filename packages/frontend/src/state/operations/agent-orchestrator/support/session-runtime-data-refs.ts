import type {
  AgentSessionAssociation,
  RepoRuntimeRef,
  RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentSessionRuntimePolicy, PolicyBoundSessionRef } from "@openducktor/core";
import { findRuntimeDefinition, runtimeSupportsCapability } from "@/lib/agent-runtime";
import type {
  AgentSessionIdentity,
  AgentSessionState,
  AgentTaskSessionBinding,
} from "@/types/agent-orchestrator";
import { toRuntimeSessionRefWithPolicy } from "./session-runtime-ref";
import { resolveSessionRuntimeScope } from "./session-runtime-scope";

export type SessionRuntimeDataTarget = {
  identity: AgentSessionIdentity;
  selectedModel: AgentSessionState["selectedModel"];
  taskBinding: AgentTaskSessionBinding | null;
  liveSessionAssociation: AgentSessionAssociation | null;
};

export type SessionRuntimeDataRefs =
  | { kind: "none" }
  | { kind: "unavailable"; error: string }
  | { kind: "available"; catalogRef: RepoRuntimeRef; todosRef: PolicyBoundSessionRef | null };

export type ResolveSessionRuntimeDataRefsInput = {
  repoPath: string | null;
  selectedSession: SessionRuntimeDataTarget | null;
  runtimePolicy: AgentSessionRuntimePolicy | null;
  runtimeDefinitions: RuntimeDescriptor[];
};

export const emptySessionRuntimeDataRefs: SessionRuntimeDataRefs = Object.freeze({
  kind: "none",
});

const runtimeSupportsTodos = (
  runtimeDefinitions: RuntimeDescriptor[],
  selectedSessionIdentity: AgentSessionIdentity,
): boolean => {
  const runtimeDefinition = findRuntimeDefinition(
    runtimeDefinitions,
    selectedSessionIdentity.runtimeKind,
  );
  return runtimeDefinition
    ? runtimeSupportsCapability(runtimeDefinition, "optionalSurfaces.supportsTodos")
    : false;
};

export const resolveSessionRuntimeDataRefs = ({
  repoPath,
  selectedSession,
  runtimePolicy,
  runtimeDefinitions,
}: ResolveSessionRuntimeDataRefsInput): SessionRuntimeDataRefs => {
  if (!selectedSession) {
    return emptySessionRuntimeDataRefs;
  }

  if (!repoPath) {
    return {
      kind: "unavailable",
      error: "Repository path is required to read selected session runtime data.",
    };
  }

  const catalogRef: RepoRuntimeRef = {
    repoPath,
    runtimeKind: selectedSession.identity.runtimeKind,
  };

  if (!runtimeSupportsTodos(runtimeDefinitions, selectedSession.identity)) {
    return {
      kind: "available",
      catalogRef,
      todosRef: null,
    };
  }

  if (!runtimePolicy) {
    return {
      kind: "available",
      catalogRef,
      todosRef: null,
    };
  }

  const todosRef = toRuntimeSessionRefWithPolicy(
    repoPath,
    { ...selectedSession.identity, selectedModel: selectedSession.selectedModel },
    runtimePolicy,
  );
  const sessionScope = resolveSessionRuntimeScope(selectedSession);
  return {
    kind: "available",
    catalogRef,
    todosRef: sessionScope ? { ...todosRef, sessionScope } : todosRef,
  };
};
