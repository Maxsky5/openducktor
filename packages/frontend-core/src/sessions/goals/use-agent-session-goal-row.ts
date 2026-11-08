import type { AgentSessionGoalControlAction, RuntimeDescriptor } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import { useHostClient } from "../../connection/client-connection-react";
import { errorMessage } from "../../lib/errors";
import type { AgentSessionIdentity, AgentSessionState } from "../../types/agent-orchestrator";
import { useAgentSessionField } from "../session-store-hooks";
import { toBoundRuntimeSessionRef } from "../agent-orchestrator/support/session-runtime-ref";
import { type AgentSessionGoalRow, buildAgentSessionGoalRow } from "./agent-session-goal-row";

export type AgentSessionGoalRowModel = AgentSessionGoalRow & {
  readonly pendingAction: AgentSessionGoalControlAction | null;
  /** The runtime reason of the last failed action. */
  readonly error: string | null;
  readonly onAction: (action: AgentSessionGoalControlAction) => void;
};

export type AgentSessionGoalSource = Pick<
  AgentSessionState,
  "externalSessionId" | "runtimeKind" | "workingDirectory" | "sessionAssociation" | "goal"
>;

type ActionState = {
  readonly sessionId: string;
  readonly pendingAction: AgentSessionGoalControlAction | null;
  readonly error: string | null;
  /** The row when the action started. A clear can make the runtime work for a moment first. */
  readonly rowAtAction: AgentSessionGoalRow | null;
};

/**
 * The goal row of a session. It shows only the goal that the runtime reports, so an action
 * changes the row when the runtime reports the new goal state.
 */
export const useAgentSessionGoalRow = ({
  repoPath,
  session,
  runtimeDescriptor,
}: {
  repoPath: string | null;
  session: AgentSessionGoalSource | null;
  runtimeDescriptor: Pick<RuntimeDescriptor, "capabilities"> | null;
}): AgentSessionGoalRowModel | null => {
  const host = useHostClient();
  const [state, setState] = useState<ActionState | null>(null);
  const sessionId = session?.externalSessionId ?? null;
  const current = state?.sessionId === sessionId ? state : null;
  const row = useMemo(
    () =>
      buildAgentSessionGoalRow(
        session?.goal,
        runtimeDescriptor?.capabilities.goals.supportsPauseResume === true,
      ),
    [runtimeDescriptor, session?.goal],
  );
  const onAction = useCallback(
    (action: AgentSessionGoalControlAction) => {
      if (!session || !repoPath) return;
      const target = { sessionId: session.externalSessionId };
      setState({ ...target, pendingAction: action, error: null, rowAtAction: row });
      void (async () => {
        try {
          await host.agentSessionGoalControl({
            ...toBoundRuntimeSessionRef(repoPath, session, `${action} the goal`),
            action,
          });
          setState({ ...target, pendingAction: null, error: null, rowAtAction: null });
        } catch (cause) {
          setState({
            ...target,
            pendingAction: null,
            error: errorMessage(cause),
            rowAtAction: null,
          });
        }
      })();
    },
    [host, repoPath, row, session],
  );
  // A clear keeps the status that the user cleared, so the row never shows a short Active state.
  const shownRow = current?.pendingAction === "clear" ? (current.rowAtAction ?? row) : row;
  return useMemo(
    () =>
      row && shownRow
        ? {
            ...shownRow,
            pendingAction: current?.pendingAction ?? null,
            error: current?.error ?? null,
            onAction,
          }
        : null,
    [current?.error, current?.pendingAction, onAction, row, shownRow],
  );
};

/**
 * The goal row of the session of a composer. It reads only the goal and the scope of the session,
 * so streamed text does not render it again.
 */
export const useSessionGoalRow = ({
  repoPath,
  identity,
  runtimeDescriptor,
}: {
  repoPath: string | null;
  identity: AgentSessionIdentity | null;
  runtimeDescriptor: Pick<RuntimeDescriptor, "capabilities"> | null;
}): AgentSessionGoalRowModel | null => {
  const goal = useAgentSessionField(identity, "goal");
  const sessionAssociation = useAgentSessionField(identity, "sessionAssociation");
  const session = useMemo(
    () => (identity && sessionAssociation ? { ...identity, sessionAssociation, goal } : null),
    [goal, identity, sessionAssociation],
  );
  return useAgentSessionGoalRow({ repoPath, session, runtimeDescriptor });
};

/**
 * The scope in which the goal row animates its changes. A session that becomes attached, such as
 * after a switch or a reload, shows its known goal at once, so the transcript does not move.
 */
export const useSessionGoalRowScope = (identity: AgentSessionIdentity | null): string | null => {
  const livePresence = useAgentSessionField(identity, "livePresence");
  return identity ? `${identity.externalSessionId}:${livePresence ?? "unobserved"}` : null;
};
