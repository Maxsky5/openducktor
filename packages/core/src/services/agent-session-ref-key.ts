import { trimTrailingPathSeparators } from "@openducktor/path-support";
import type { AgentEvent, AgentSessionRef } from "../types/agent-orchestrator";

const SESSION_REF_KEY_SEPARATOR = "|";

const encodeSessionRefKeyPart = (value: string): string => encodeURIComponent(value);

const normalizeSessionRefPath = (value: string): string => trimTrailingPathSeparators(value.trim());

export const agentSessionRuntimeStreamKey = ({
  repoPath,
  runtimeKind,
}: Pick<AgentSessionRef, "repoPath" | "runtimeKind">): string =>
  [
    encodeSessionRefKeyPart(normalizeSessionRefPath(repoPath)),
    encodeSessionRefKeyPart(runtimeKind),
  ].join(SESSION_REF_KEY_SEPARATOR);

export const agentSessionRefKey = ({
  repoPath,
  runtimeKind,
  workingDirectory,
  externalSessionId,
}: AgentSessionRef): string =>
  [
    encodeSessionRefKeyPart(normalizeSessionRefPath(repoPath)),
    encodeSessionRefKeyPart(runtimeKind),
    encodeSessionRefKeyPart(normalizeSessionRefPath(workingDirectory)),
    encodeSessionRefKeyPart(externalSessionId),
  ].join(SESSION_REF_KEY_SEPARATOR);

export const agentSessionRefsEqual = (first: AgentSessionRef, second: AgentSessionRef): boolean =>
  agentSessionRefKey(first) === agentSessionRefKey(second);

export const agentSessionRefsShareRuntimeStream = (
  first: Pick<AgentSessionRef, "repoPath" | "runtimeKind">,
  second: Pick<AgentSessionRef, "repoPath" | "runtimeKind">,
): boolean => agentSessionRuntimeStreamKey(first) === agentSessionRuntimeStreamKey(second);

export const withAgentSessionRef = <Event extends AgentEvent>(
  sessionRef: AgentSessionRef,
  event: Event,
): Event => ({
  ...event,
  sessionRef,
});
