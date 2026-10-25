import type { RemoteFailure } from "@openducktor/contracts";
import type { RemoteConnectionState } from "@openducktor/host-client/remote";

/** The connection states that the user sees. */
export type ConnectionPhase =
  | { kind: "connecting" }
  | { kind: "restoring" }
  | { kind: "connected" }
  | { kind: "reconnecting"; failure: RemoteFailure | null }
  | { kind: "failed"; failure: RemoteFailure | null }
  | { kind: "offline" };

export type ConnectionPhaseInput = {
  state: RemoteConnectionState;
  /** True after this connection reached `connected` once. */
  connectedBefore: boolean;
  /**
   * The last failure since the connection was last connected. A retry starts a new attempt
   * without a failure, and the phase keeps this one until the host answers.
   */
  lastFailure: RemoteFailure | null;
  deviceOnline: boolean;
  /**
   * True after a return to the foreground until the restart of the connection connects or fails.
   * A failure from the background period then says nothing about the host, because Android blocks
   * the network of an app in the background.
   */
  resuming: boolean;
};

export const connectionPhase = ({
  state,
  connectedBefore,
  lastFailure,
  deviceOnline,
  resuming,
}: ConnectionPhaseInput): ConnectionPhase => {
  if (resuming && state.status !== "connected" && state.status !== "synchronizing") {
    if (!deviceOnline) return { kind: "offline" };
    return connectedBefore ? { kind: "reconnecting", failure: null } : { kind: "connecting" };
  }
  const failure = state.failure ?? lastFailure;
  if (state.status === "failed") return { kind: "failed", failure };
  if (!deviceOnline) return { kind: "offline" };
  switch (state.status) {
    case "connected":
      return { kind: "connected" };
    case "synchronizing":
      return { kind: "restoring" };
    case "disconnected":
      return { kind: "reconnecting", failure };
    case "connecting":
    case "idle":
      return connectedBefore || failure !== null
        ? { kind: "reconnecting", failure }
        : { kind: "connecting" };
  }
};

/** Host commands run only while the connection is live. Draft editing stays available. */
export const commandsAllowed = (phase: ConnectionPhase): boolean => phase.kind === "connected";

/** The words of a connection phase: a short status line and the full explanation. */
export type ConnectionCopy = {
  /** The status line of the banner, such as "Can't reach the host". */
  status: string;
  /** The title of the full-screen state. */
  title: string;
  /** The reason and the next action, or null when the title says enough. */
  message: string | null;
  /** Things to check on the host and the device, for a host that does not answer. */
  checks: readonly string[];
  tone: "info" | "warning" | "destructive";
  /** True while the app works on the connection by itself. */
  busy: boolean;
  /** True when a manual retry can help. */
  canRetry: boolean;
};

const HOST_CHECKS = [
  "OpenDucktor is open on the host computer",
  "Remote control is on in its settings",
  "This device is on the same network",
] as const;

const unreachable = (failure: RemoteFailure | null): boolean =>
  failure === null ||
  failure.transportCause === "network" ||
  failure.transportCause === "timeout" ||
  failure.code === "unavailable";

/**
 * A host that does not answer gets its reason and a checklist. Another failure, such as an old
 * host version, gets its reason and its next action.
 */
const failureCopy = (failure: RemoteFailure | null) => {
  if (unreachable(failure)) {
    return {
      status: "Can't reach the host",
      title: "Can't reach your host",
      message: failure?.message ?? null,
      checks: HOST_CHECKS,
    };
  }
  return {
    status: "Connection failed",
    title: "Connection failed",
    message: failure ? `${failure.message} ${failure.nextAction}` : null,
    checks: [],
  };
};

/** The words that the banner and the full-screen connection state show for a phase. */
export const connectionCopy = (phase: ConnectionPhase, hostLabel: string): ConnectionCopy => {
  switch (phase.kind) {
    case "connected":
      return {
        status: "Connected",
        title: "Connected",
        message: null,
        checks: [],
        tone: "info",
        busy: false,
        canRetry: false,
      };
    case "connecting":
      return {
        status: "Connecting…",
        title: `Connecting to ${hostLabel}`,
        message: null,
        checks: [],
        tone: "info",
        busy: true,
        canRetry: false,
      };
    case "restoring":
      return {
        status: "Restoring your work…",
        title: "Restoring your work",
        message: "OpenDucktor reads the latest state from the host.",
        checks: [],
        tone: "info",
        busy: true,
        canRetry: false,
      };
    case "offline":
      return {
        status: "You're offline",
        title: "You're offline",
        message: "Connect this device to a network. OpenDucktor reconnects by itself.",
        checks: [],
        tone: "warning",
        busy: false,
        canRetry: false,
      };
    case "reconnecting":
      if (!phase.failure) {
        return {
          status: "Reconnecting…",
          title: `Reconnecting to ${hostLabel}`,
          message: null,
          checks: [],
          tone: "info",
          busy: true,
          canRetry: true,
        };
      }
      return { ...failureCopy(phase.failure), tone: "warning", busy: false, canRetry: true };
    case "failed":
      return { ...failureCopy(phase.failure), tone: "destructive", busy: false, canRetry: true };
  }
};

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/**
 * The status line of the full-screen connection state: the manual retry, the work that the app
 * does by itself, the last failed retry, or what happens next.
 */
export const retryStatusLabel = ({
  phase,
  copy,
  retrying,
  failedAt,
}: {
  phase: ConnectionPhase;
  copy: Pick<ConnectionCopy, "busy" | "status">;
  /** True while a manual retry runs. */
  retrying: boolean;
  /** When the last manual retry failed, or null. */
  failedAt: number | null;
}): string => {
  if (retrying) return "Retrying…";
  if (copy.busy) return copy.status;
  if (failedAt !== null) return `Still unreachable · tried at ${clock.format(failedAt)}`;
  if (phase.kind === "failed") return "Automatic retries stopped";
  if (phase.kind === "offline") return "Waiting for a network";
  return "Retries automatically";
};
