import type { RepoRuntimeRef, RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentSessionRuntimePolicy, PolicyBoundSessionRef } from "@openducktor/core";
import { findRuntimeDefinition, runtimeSupportsCapability } from "@/lib/agent-runtime";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { toRuntimeSessionRefWithPolicy } from "./session-runtime-ref";
import { resolveSessionRuntimeScope } from "./session-runtime-scope";

export type SessionRuntimeDataTarget = {
  identity: AgentSessionIdentity;
  repoPath: string;
  selectedModel: AgentSessionState["selectedModel"];
  sessionAssociation: AgentSessionState["sessionAssociation"];
};

export type SessionRuntimeDataRefs =
  | { kind: "none" }
  | { kind: "available"; catalogRef: RepoRuntimeRef; todosRef: PolicyBoundSessionRef | null };

export type ResolveSessionRuntimeDataRefsInput = {
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
  selectedSession,
  runtimePolicy,
  runtimeDefinitions,
}: ResolveSessionRuntimeDataRefsInput): SessionRuntimeDataRefs => {
  if (!selectedSession) {
    return emptySessionRuntimeDataRefs;
  }

  const catalogRef: RepoRuntimeRef = {
    repoPath: selectedSession.repoPath,
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
    selectedSession.repoPath,
    { ...selectedSession.identity, selectedModel: selectedSession.selectedModel },
    runtimePolicy,
  );
  const sessionScope = resolveSessionRuntimeScope(selectedSession.sessionAssociation);
  return {
    kind: "available",
    catalogRef,
    todosRef: sessionScope ? { ...todosRef, sessionScope } : todosRef,
  };
};
