import { useState } from "react";
import { createSessionStartGate, type SessionStartGate } from "./session-start-gate";

/**
 * A session start gate for one workspace.
 *
 * A workspace change clears the gate, so a queued start of the previous workspace does not run
 * and a new start does not join a start of the previous workspace.
 */
export const useWorkspaceSessionStartGate = <Result>(
  workspaceId: string | null,
): SessionStartGate<Result> => {
  const [gate] = useState(createSessionStartGate<Result>);
  const [gateWorkspaceId, setGateWorkspaceId] = useState(workspaceId);
  if (gateWorkspaceId !== workspaceId) {
    setGateWorkspaceId(workspaceId);
    gate.clear();
  }
  return gate;
};
