import type { RemoteFailure } from "@openducktor/contracts";
import type { RemoteConnectionState } from "@openducktor/host-client/remote";
import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AccessibilityInfo } from "react-native";
import {
  type ConnectionPhase,
  commandsAllowed,
  connectionCopy,
  connectionPhase,
} from "./connection-phase";
import type { ActiveHostSession, RemoteHostSession } from "./host-session-owner";

const ActiveSessionContext = createContext<ActiveHostSession | null>(null);

export function ActiveSessionProvider({
  session,
  children,
}: PropsWithChildren<{ session: ActiveHostSession }>): ReactElement {
  return <ActiveSessionContext value={session}>{children}</ActiveSessionContext>;
}

/** The saved host or the demo, and the connection that the current tree shows. */
export const useActiveSession = (): ActiveHostSession => {
  const session = use(ActiveSessionContext);
  if (!session) throw new Error("This view needs an active host connection.");
  return session;
};

/** True while the app shows the demo with its sample data. */
export const useIsDemo = (): boolean => useActiveSession().kind === "demo";

/** True while the app shows the demo. A view outside a connection tree shows no demo. */
export const useOptionalIsDemo = (): boolean => use(ActiveSessionContext)?.kind === "demo";

/** The connection to a saved host. A view that only a saved host has, such as pairing, reads it. */
export const useRemoteSession = (): RemoteHostSession => {
  const session = useActiveSession();
  if (session.kind !== "remote") throw new Error("This view needs a saved host, not the demo.");
  return session;
};

const useRemoteConnectionState = (): RemoteConnectionState => {
  const { remote } = useRemoteSession().remote;
  return useSyncExternalStore(remote.subscribeState, remote.readState, remote.readState);
};

const useDeviceOnline = (): boolean => {
  const { lifecycle } = useRemoteSession();
  return useSyncExternalStore(
    lifecycle.subscribeDeviceOnline,
    lifecycle.deviceOnline,
    lifecycle.deviceOnline,
  );
};

const NO_CHANGES = () => () => {};
const NEVER = () => false;

/**
 * True after a return to the foreground without a live connection, until the connection connects
 * or fails again. Live changes wait during this time. The demo has no connection, so it never
 * resumes.
 */
export const useResuming = (): boolean => {
  const session = useActiveSession();
  const lifecycle = session.kind === "remote" ? session.lifecycle : null;
  return useSyncExternalStore(
    lifecycle?.subscribeResuming ?? NO_CHANGES,
    lifecycle?.resuming ?? NEVER,
    lifecycle?.resuming ?? NEVER,
  );
};

/** The connection phase that the banner and failure screen show. */
const useConnectionPhase = (): ConnectionPhase => {
  const { remote } = useRemoteSession().remote;
  const state = useRemoteConnectionState();
  const deviceOnline = useDeviceOnline();
  const resuming = useResuming();
  // The first admission of this connection decides between Connecting and Reconnecting.
  const [connectedBefore, setConnectedBefore] = useState(
    () => remote.readState().status === "connected",
  );
  const [lastFailure, setLastFailure] = useState<RemoteFailure | null>(
    () => remote.readState().failure ?? null,
  );
  useEffect(
    () =>
      remote.subscribeState((current) => {
        if (current.status === "connected") {
          setConnectedBefore(true);
          setLastFailure(null);
        } else if (current.failure) {
          setLastFailure(current.failure);
        }
      }),
    [remote],
  );
  const reachedConnected = connectedBefore || state.status === "connected";
  const failure = state.status === "connected" ? null : lastFailure;
  return useMemo(
    () =>
      connectionPhase({
        state,
        connectedBefore: reachedConnected,
        lastFailure: failure,
        deviceOnline,
        resuming,
      }),
    [state, reachedConnected, failure, deviceOnline, resuming],
  );
};

/**
 * Announces each new connection status once, also on iOS, where VoiceOver has no live regions.
 * The first status of a connection is not announced. The banners have no live region, so
 * TalkBack does not say a status twice.
 */
const useAnnounceConnectionStatus = (phase: ConnectionPhase): void => {
  const { host } = useActiveSession();
  const { status } = connectionCopy(phase, host.label);
  const announcement = commandsAllowed(phase) ? status : `${status}. Actions are paused.`;
  const announced = useRef(announcement);
  useEffect(() => {
    if (announced.current === announcement) return;
    announced.current = announcement;
    AccessibilityInfo.announceForAccessibility(announcement);
  }, [announcement]);
};

export type CommandGate = { open: boolean; phase: ConnectionPhase };

const CommandGateContext = createContext<CommandGate | null>(null);

/** Publishes one command gate, so every host command control reads the same connection phase. */
export function CommandGateProvider({ children }: PropsWithChildren): ReactElement {
  return useActiveSession().kind === "demo" ? (
    <CommandGateContext value={DEMO_GATE}>{children}</CommandGateContext>
  ) : (
    <RemoteCommandGateProvider>{children}</RemoteCommandGateProvider>
  );
}

/** The demo answers every command on the device, so its gate stays open. */
const DEMO_GATE: CommandGate = { open: true, phase: { kind: "connected" } };

function RemoteCommandGateProvider({ children }: PropsWithChildren): ReactElement {
  const phase = useConnectionPhase();
  useAnnounceConnectionStatus(phase);
  const open = commandsAllowed(phase);
  const value = useMemo(() => ({ open, phase }), [open, phase]);
  return <CommandGateContext value={value}>{children}</CommandGateContext>;
}

/** Host commands run only while the connection is live. Draft editing stays available. */
export const useCommandGate = (): CommandGate => {
  const gate = use(CommandGateContext);
  if (!gate) throw new Error("Host command controls need the command gate of a host connection.");
  return gate;
};

/** True while a control can send a host command. Outside a connection tree, no host exists. */
export const useOptionalCommandGate = (): CommandGate | null => use(CommandGateContext);

/**
 * True while a control that sends a host command must wait for the connection. A command control
 * outside a connection tree is a bug, so it throws.
 */
export const useCommandBlocked = (command: boolean, controlName: string): boolean => {
  const gate = useOptionalCommandGate();
  if (command && !gate) {
    throw new Error(`The ${controlName} control sends a host command outside a host connection.`);
  }
  return command && gate !== null && !gate.open;
};
