import type { AgentRole } from "@openducktor/core";
import { useCallback, useRef } from "react";
import {
  createSessionStartGate,
  type SessionStartGate,
} from "@/features/session-start/session-start-gate";
import type { SessionStartWorkflowResult } from "@/features/session-start/session-start-workflow";

type SessionStartPromise = Promise<SessionStartWorkflowResult | undefined>;
type StartSession = () => SessionStartPromise;

export type AgentStudioSessionStartGate = {
  run: (key: string, start: StartSession) => SessionStartPromise;
};

export const buildAgentStudioSessionStartKey = (params: {
  taskId: string;
  role: AgentRole;
  launchActionId: string;
}): string => {
  return `${params.taskId}:${params.role}:${params.launchActionId}`;
};

export function useAgentStudioSessionStartGate(
  scopeKey: string | null,
): AgentStudioSessionStartGate {
  const scopeKeyRef = useRef(scopeKey);
  const gateRef = useRef<SessionStartGate<SessionStartWorkflowResult | undefined> | null>(null);
  if (gateRef.current === null) {
    gateRef.current = createSessionStartGate<SessionStartWorkflowResult | undefined>();
  }
  const gate = gateRef.current;
  if (scopeKeyRef.current !== scopeKey) {
    scopeKeyRef.current = scopeKey;
    gate.clear();
  }

  const run = useCallback(
    (key: string, start: StartSession): SessionStartPromise => {
      return gate.run(key, start);
    },
    [gate],
  );

  return {
    run,
  };
}
