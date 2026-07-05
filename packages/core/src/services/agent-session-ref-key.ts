import { trimTrailingPathSeparators } from "@openducktor/path-support";
import type { AgentEvent, SessionRef } from "../types/agent-orchestrator";

const SESSION_REF_KEY_SEPARATOR = "|";

const encodeSessionRefKeyPart = (value: string): string => encodeURIComponent(value);

const normalizeSessionRefPath = (value: string): string => trimTrailingPathSeparators(value.trim());

export const agentSessionRuntimeStreamKey = ({
  repoPath,
  runtimeKind,
}: Pick<SessionRef, "repoPath" | "runtimeKind">): string =>
  [
    encodeSessionRefKeyPart(normalizeSessionRefPath(repoPath)),
    encodeSessionRefKeyPart(runtimeKind),
  ].join(SESSION_REF_KEY_SEPARATOR);

export const agentSessionRefKey = ({
  repoPath,
  runtimeKind,
  workingDirectory,
  externalSessionId,
}: SessionRef): string =>
  [
    encodeSessionRefKeyPart(normalizeSessionRefPath(repoPath)),
    encodeSessionRefKeyPart(runtimeKind),
    encodeSessionRefKeyPart(normalizeSessionRefPath(workingDirectory)),
    encodeSessionRefKeyPart(externalSessionId),
  ].join(SESSION_REF_KEY_SEPARATOR);

export const agentSessionRefsEqual = (first: SessionRef, second: SessionRef): boolean =>
  agentSessionRefKey(first) === agentSessionRefKey(second);

export const agentSessionRefsShareRuntimeStream = (
  first: Pick<SessionRef, "repoPath" | "runtimeKind">,
  second: Pick<SessionRef, "repoPath" | "runtimeKind">,
): boolean => agentSessionRuntimeStreamKey(first) === agentSessionRuntimeStreamKey(second);

export const withAgentSessionRef = <Event extends AgentEvent>(
  sessionRef: SessionRef,
  event: Event,
): Event => ({
  ...event,
  sessionRef,
});
