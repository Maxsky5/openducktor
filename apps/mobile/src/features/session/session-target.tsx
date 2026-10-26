import type {
  AgentSessionAssociation,
  AgentSessionScope,
  WorkspaceRecord,
  WorkspaceSession,
} from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import type { RuntimeReadiness } from "@openducktor/frontend-core/lib/use-runtime-readiness";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { createContext, type PropsWithChildren, type ReactElement, use, useMemo } from "react";
import type { WorkOwnerParams } from "@/navigation/routes";

/** The task or chat that owns a session. A Subagent session opened alone has no known owner. */
export type SessionOwner =
  | { kind: "task"; taskId: string; role: AgentRole }
  | { kind: "chat"; record: WorkspaceSession }
  | { kind: "none" };

/** The session that the session screen shows. These values change only when the target changes. */
export type SessionTarget = {
  workspace: WorkspaceRecord;
  repoPath: string;
  /** A stable identity object. Pass it to store hooks as it is. */
  identity: AgentSessionIdentity;
  sessionKey: string;
  /** A Read-only Session View shows the transcript and sends no command. */
  readOnly: boolean;
  owner: SessionOwner;
  sessionAssociation: AgentSessionAssociation;
  /** The scope that pending input replies use, or null for a session without an owner. */
  sessionScope: AgentSessionScope | null;
  /** The owner of the work views of this session, or null when it has none. */
  workOwner: WorkOwnerParams | null;
};

/** Whether the session can take host commands now. */
export type SessionInteraction = {
  /** True while the host connection, the runtime, and the session can take commands. */
  canInteract: boolean;
  /** Why commands cannot run now, or null when they can. Disabled controls show it. */
  blockedReason: string | null;
  runtimeReadiness: RuntimeReadiness;
  /** True while a chat prepares its runtime session. */
  isPreparing: boolean;
  /** True when another part of the screen shows `blockedReason`; else the error row shows it. */
  reasonShown: boolean;
};

export type SessionScreenValue = {
  target: SessionTarget;
  interaction: SessionInteraction;
  /** The route asked to scroll to and focus the pending input. */
  focusPendingInput: boolean;
};

type SessionScreenRoute = Pick<SessionScreenValue, "target" | "focusPendingInput">;

// The interaction changes while the session prepares and when the connection changes. A separate
// context renders only its readers again, not every view of the screen.
const SessionRouteContext = createContext<SessionScreenRoute | null>(null);
const SessionInteractionContext = createContext<SessionInteraction | null>(null);

export function SessionScreenProvider({
  target,
  interaction,
  focusPendingInput,
  children,
}: PropsWithChildren<SessionScreenValue>): ReactElement {
  const route = useMemo(() => ({ target, focusPendingInput }), [focusPendingInput, target]);
  return (
    <SessionRouteContext value={route}>
      <SessionInteractionContext value={interaction}>{children}</SessionInteractionContext>
    </SessionRouteContext>
  );
}

const useSessionRoute = (): SessionScreenRoute => {
  const value = use(SessionRouteContext);
  if (!value) throw new Error("Session views need the session screen of a session route.");
  return value;
};

/** The session screen state. Read it only inside the session screen. */
export const useSessionScreen = (): SessionScreenValue => {
  const route = useSessionRoute();
  const interaction = use(SessionInteractionContext);
  if (!interaction) throw new Error("Session views need the session screen of a session route.");
  return { ...route, interaction };
};

/** The session target alone. Its readers do not render again when the interaction changes. */
export const useSessionTarget = (): SessionTarget => useSessionRoute().target;

/** True when the route asked to scroll to and focus the pending input. */
export const useFocusPendingInput = (): boolean => useSessionRoute().focusPendingInput;
