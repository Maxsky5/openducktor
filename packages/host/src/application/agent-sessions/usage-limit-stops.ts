import {
  type AgentSessionLiveEnvelope,
  type AgentSessionLiveRef,
  type AgentSessionLiveSnapshot,
  isAcceptedUserMessage,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeKind,
  type UsageLimitAutoResume,
  type WorkflowFailure,
} from "@openducktor/contracts";
import {
  agentSessionRefKey,
  type UsageLimitRecovery,
  type UsageLimitStop,
} from "@openducktor/core";
import { hasForegroundTurn } from "./session-foreground-readiness";
import {
  isNewTurnWorkEvent,
  nextUsageLimitStop,
  type UsageLimitStopSignal,
} from "./usage-limit-stop-signal";

/** The resume waits this long after the reset, so a clock difference cannot use the one attempt. */
export const USAGE_LIMIT_RESUME_GRACE_MS = 30_000;

export type UsageLimitStopPhase =
  /** The failed turn has not ended, or the stop waits for its reset time. */
  | "observed"
  /** The root check before the plan runs. */
  | "planning"
  | "scheduled"
  /** The due time passed, and the checks before the resume run. Clients still see `scheduled`. */
  | "due"
  /**
   * The due time passed during a Claude wake whose outcome is still unknown. Clients still see
   * `scheduled`, and the stop re-enters `scheduled` when the session returns to idle.
   */
  | "waiting_for_idle"
  | "resuming"
  | "failed";

/** The latest usage-limit stop of one session. Only this module changes it. */
export type TrackedUsageLimitStop = {
  readonly ref: AgentSessionLiveRef;
  readonly stopId: string;
  readonly occurredAtEpochMs: number;
  readonly resetsAtEpochMs: number | undefined;
  readonly turnEnded: boolean;
  readonly phase: UsageLimitStopPhase;
  readonly failure: WorkflowFailure | undefined;
};

type MutableStop = {
  -readonly [Field in keyof TrackedUsageLimitStop]: TrackedUsageLimitStop[Field];
} & {
  sawIdleWhileDue: boolean;
};

/** The stops whose due time passed, and the next due time of the others. */
export type DueStops = { due: TrackedUsageLimitStop[]; nextDueAt: number | undefined };

/** What the due-time checks found. `recovery` is the answer of the runtime for the account. */
export type DueCheck =
  | { readonly kind: "blocked_on_input" }
  | { readonly kind: "active_turn" }
  | { readonly kind: "ready"; readonly now: number; readonly recovery: UsageLimitRecovery };

export const supportsUsageLimitAutoResume = (runtimeKind: RuntimeKind): boolean =>
  RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind].capabilities.sessionLifecycle
    .supportsUsageLimitAutoResume;

/**
 * Claude briefly flips foreground active for an empty notification-only wake, so live foreground
 * pulses alone do not cancel a pending Claude stop and due checks defer until the wake ends.
 */
const allowsTransientForegroundWake = (runtimeKind: RuntimeKind): boolean =>
  runtimeKind === "claude";

const stopKey = (stop: Pick<MutableStop, "ref" | "stopId">): string =>
  `${agentSessionRefKey(stop.ref)}\u0000${stop.stopId}`;

/** A reset that is not later than the error would start a retry loop. */
const hasEligibleReset = (stop: MutableStop): boolean =>
  stop.resetsAtEpochMs !== undefined && stop.resetsAtEpochMs > stop.occurredAtEpochMs;

const dueAtOf = (stop: MutableStop): number =>
  (stop.resetsAtEpochMs ?? 0) + USAGE_LIMIT_RESUME_GRACE_MS;

/** Single-use handle for an in-flight history restore. */
export type PendingUsageLimitRestore = {
  /** Applies the history result if no live work invalidated the read. */
  readonly restore: (found: UsageLimitStop | null, now: number) => TrackedUsageLimitStop | null;
  /** Releases the guard when the read finishes, fails, or is cancelled. */
  readonly release: () => void;
};

/**
 * Owns every rule of the usage-limit stops of the host process: which stop is the latest of each
 * session, when it is planned, when new work ends it, and which stops never come back. It does
 * no I/O. `changed` reports a session whose published entry can change, so the owner publishes
 * it and wakes its scheduler.
 */
export const createUsageLimitStops = (changed: (ref: AgentSessionLiveRef) => void) => {
  /** The auto-resume setting. While it is off, no stop is due and clients see no plan. */
  let enabled = false;
  const stops = new Map<string, MutableStop>();
  /** Stops that ended in this process. A history rebuild never plans them again. */
  const ended = new Set<string>();
  /** Guards for in-flight history reads, so live work invalidates them even across removal. */
  const pendingRestores = new Map<string, Set<{ invalidated: boolean }>>();
  /** Supported sessions whose latest observed live snapshot has an active foreground turn. */
  const activeForegroundKeys = new Set<string>();

  const isCurrent = (stop: TrackedUsageLimitStop): boolean =>
    stops.get(agentSessionRefKey(stop.ref)) === stop;

  const setPhase = (stop: MutableStop, phase: UsageLimitStopPhase): void => {
    stop.phase = phase;
    changed(stop.ref);
  };

  const end = (key: string): void => {
    const stop = stops.get(key);
    if (!stop) return;
    ended.add(stopKey(stop));
    stops.delete(key);
    changed(stop.ref);
  };

  const countWork = (key: string): void => {
    const guards = pendingRestores.get(key);
    if (!guards) return;
    for (const guard of guards) guard.invalidated = true;
  };

  /** New work in the session ends its stop. */
  const newWork = (key: string): void => {
    countWork(key);
    end(key);
  };

  const noteIdle = (key: string): void => {
    activeForegroundKeys.delete(key);
    const stop = stops.get(key);
    if (!stop) return;
    if (stop.phase === "due") stop.sawIdleWhileDue = true;
    else if (stop.phase === "waiting_for_idle") setPhase(stop, "scheduled");
  };

  /** Moves an eligible stop to the root check. The caller runs the check. */
  const toPlan = (stop: MutableStop): TrackedUsageLimitStop | null => {
    if (
      stop.phase !== "observed" ||
      !stop.turnEnded ||
      !hasEligibleReset(stop) ||
      ended.has(stopKey(stop)) ||
      !supportsUsageLimitAutoResume(stop.ref.runtimeKind)
    )
      return null;
    stop.phase = "planning";
    return stop;
  };

  const observeLimitError = (
    key: string,
    event: Extract<
      Extract<AgentSessionLiveEnvelope, { type: "transcript_event" }>["event"],
      { type: "turn_error" }
    >,
  ): TrackedUsageLimitStop | null => {
    if (!event.usageLimit || !event.messageId) return null;
    const resetsAtEpochMs = event.usageLimit.resetsAtEpochMs;
    const stop = stops.get(key);
    if (
      !stop ||
      nextUsageLimitStop(stop, { kind: "limit_error", stopId: event.messageId }) !== "same_stop"
    ) {
      // A new stop replaces the previous one, also while its resume runs.
      end(key);
      stops.set(key, {
        ref: event.sessionRef,
        stopId: event.messageId,
        occurredAtEpochMs: Date.parse(event.timestamp),
        resetsAtEpochMs,
        turnEnded: false,
        phase: "observed",
        failure: undefined,
        sawIdleWhileDue: false,
      });
      return null;
    }
    // Claude can report the reset time of the same stop after its turn ended.
    if (resetsAtEpochMs === undefined || resetsAtEpochMs === stop.resetsAtEpochMs) return null;
    stop.resetsAtEpochMs = resetsAtEpochMs;
    switch (stop.phase) {
      case "observed":
        return toPlan(stop);
      case "scheduled":
      case "due":
        if (!hasEligibleReset(stop)) end(key);
        // A due stop waits again for the new time. Its running checks then stop.
        else setPhase(stop, "scheduled");
        return null;
      case "waiting_for_idle":
        if (!hasEligibleReset(stop)) end(key);
        else changed(stop.ref);
        return null;
      default:
        return null;
    }
  };

  const observeSession = (session: AgentSessionLiveSnapshot): void => {
    if (!supportsUsageLimitAutoResume(session.ref.runtimeKind)) return;
    const key = agentSessionRefKey(session.ref);
    if (!hasForegroundTurn(session)) {
      noteIdle(key);
      return;
    }
    activeForegroundKeys.add(key);
    const stop = stops.get(key);
    // The resume of the owner shows foreground work too. The resume result ends that stop.
    if (stop?.phase === "resuming") return;
    // Foreground work during the failed turn is that turn.
    if (stop?.turnEnded === false) {
      countWork(key);
      return;
    }
    // Claude briefly flips foreground active for an empty notification-only wake. Wait for real
    // turn output, a user message, a host operation, or the wake ending before deciding.
    if (allowsTransientForegroundWake(session.ref.runtimeKind)) return;
    newWork(key);
  };

  return {
    /** Applies one live change. Returns the stop that needs a root check before its plan. */
    observe: (envelope: AgentSessionLiveEnvelope): TrackedUsageLimitStop | null => {
      switch (envelope.type) {
        case "transcript_event": {
          const { event } = envelope;
          if (!supportsUsageLimitAutoResume(event.sessionRef.runtimeKind)) return null;
          const key = agentSessionRefKey(event.sessionRef);
          if (event.type === "turn_error") {
            if (event.usageLimit && event.messageId) return observeLimitError(key, event);
            const stop = stops.get(key);
            if (stop?.phase !== "resuming" && stop?.turnEnded !== false) newWork(key);
            return null;
          }
          if (isAcceptedUserMessage(event)) {
            newWork(key);
          } else if (isNewTurnWorkEvent(event)) {
            const stop = stops.get(key);
            if (stop?.phase !== "resuming") {
              if (stop?.turnEnded === false) countWork(key);
              else newWork(key);
            }
          }
          if (event.type === "session_idle") noteIdle(key);
          if (event.type !== "session_turn_finished" && event.type !== "session_idle") return null;
          const stop = stops.get(key);
          if (!stop || !event.turnOutcome) return null;
          // Only the end of the failed turn counts here. Later work ends the stop elsewhere.
          const signal: UsageLimitStopSignal = { kind: "turn_end", outcome: event.turnOutcome };
          if (nextUsageLimitStop(stop, signal) !== "turn_ended") return null;
          stop.turnEnded = true;
          return toPlan(stop);
        }
        case "session_upsert":
          observeSession(envelope.session);
          return null;
        case "session_removed": {
          if (!supportsUsageLimitAutoResume(envelope.ref.runtimeKind)) return null;
          noteIdle(agentSessionRefKey(envelope.ref));
          return null;
        }
        case "snapshot":
          for (const session of envelope.sessions) observeSession(session);
          return null;
        case "session_operation_updated": {
          const { observation } = envelope;
          if (!supportsUsageLimitAutoResume(observation.ref.runtimeKind)) return null;
          const key = agentSessionRefKey(observation.ref);
          if (!observation.pending) return null;
          // A Stop, or a Resume that the owner did not start, ends the planned auto-resume.
          if (observation.kind === "stop") newWork(key);
          else if (observation.kind === "continue" && stops.get(key)?.phase !== "resuming")
            newWork(key);
          return null;
        }
        default:
          return null;
      }
    },
    /** Applies the root check of a planned stop. */
    planned: (stop: TrackedUsageLimitStop, rootFound: boolean): void => {
      const current = stops.get(agentSessionRefKey(stop.ref));
      if (current !== stop || current.phase !== "planning") return;
      if (!rootFound || !hasEligibleReset(current)) end(agentSessionRefKey(stop.ref));
      else setPhase(current, "scheduled");
    },
    setEnabled: (next: boolean): void => {
      if (next === enabled) return;
      enabled = next;
      // A due stop waits again, so its running checks stop. Clients see no plan while it is off.
      for (const stop of stops.values())
        if (stop.phase === "scheduled" || stop.phase === "due") setPhase(stop, "scheduled");
        else if (stop.phase === "waiting_for_idle") changed(stop.ref);
    },
    /** Marks the scheduled stops whose due time passed. Returns them and the next due time. */
    takeDue: (now: number): DueStops => {
      const due: TrackedUsageLimitStop[] = [];
      let nextDueAt: number | undefined;
      // The setting is off. The stops become due again when it turns on.
      if (!enabled) return { due, nextDueAt };
      for (const stop of stops.values()) {
        if (stop.phase !== "scheduled") continue;
        const dueAt = dueAtOf(stop);
        if (dueAt <= now) {
          stop.phase = "due";
          stop.sawIdleWhileDue = false;
          due.push(stop);
        } else nextDueAt = Math.min(nextDueAt ?? dueAt, dueAt);
      }
      return { due, nextDueAt };
    },
    /** True while the due-time checks of the stop may continue. */
    isDue: (stop: TrackedUsageLimitStop): boolean => isCurrent(stop) && stop.phase === "due",
    /** Applies the due-time checks. Returns true when the resume starts. */
    startResume: (stop: TrackedUsageLimitStop, check: DueCheck): boolean => {
      const key = agentSessionRefKey(stop.ref);
      const current = stops.get(key);
      if (current !== stop || current.phase !== "due") return false;
      if (!hasEligibleReset(current) || check.kind === "blocked_on_input") {
        end(key);
        return false;
      }
      const becameIdleDuringCheck = check.kind === "active_turn" && current.sawIdleWhileDue;
      const stillActive =
        activeForegroundKeys.has(key) || (check.kind === "active_turn" && !becameIdleDuringCheck);
      if (stillActive) {
        if (!allowsTransientForegroundWake(current.ref.runtimeKind)) {
          end(key);
          return false;
        }
        setPhase(current, "waiting_for_idle");
        return false;
      }
      if (check.kind === "active_turn") {
        setPhase(current, "scheduled");
        return false;
      }
      if (check.now < dueAtOf(current)) {
        setPhase(current, "scheduled");
        return false;
      }
      // Only the runtime can say that the account works again. Asking again uses no attempt.
      if (check.recovery.kind === "unknown") {
        end(key);
        return false;
      }
      if (check.recovery.kind === "waiting") {
        current.resetsAtEpochMs = Math.max(
          check.recovery.resetsAtEpochMs,
          current.resetsAtEpochMs ?? 0,
        );
        setPhase(current, "scheduled");
        return false;
      }
      ended.add(stopKey(current));
      setPhase(current, "resuming");
      return true;
    },
    /** Applies the result of a resume, or of failed checks. Each stop gets one attempt. */
    finishResume: (stop: TrackedUsageLimitStop, failure: WorkflowFailure | null): void => {
      const key = agentSessionRefKey(stop.ref);
      const current = stops.get(key);
      if (current !== stop) {
        // A newer stop replaced it. Its entry is current.
        changed(stop.ref);
        return;
      }
      if (current.phase !== "due" && current.phase !== "resuming") return;
      if (failure === null) {
        end(key);
        return;
      }
      ended.add(stopKey(current));
      current.failure = failure;
      setPhase(current, "failed");
    },
    /** Cancels the plan of one stop. Returns false when its resume already started. */
    cancel: (ref: AgentSessionLiveRef, stopId: string): boolean => {
      const key = agentSessionRefKey(ref);
      const stop = stops.get(key);
      if (!stop || stop.stopId !== stopId) return true;
      if (stop.phase === "resuming") return false;
      end(key);
      return true;
    },
    /** True when a history read for the session can add nothing. */
    hasStop: (ref: AgentSessionLiveRef): boolean => stops.has(agentSessionRefKey(ref)),
    /**
     * Registers an in-flight history restore so live work invalidates it even across removal.
     * A passed reset waits for a manual Resume.
     */
    beginRestore: (ref: AgentSessionLiveRef): PendingUsageLimitRestore => {
      const key = agentSessionRefKey(ref);
      const entry = { invalidated: false };
      let released = false;
      let guards = pendingRestores.get(key);
      if (!guards) {
        guards = new Set();
        pendingRestores.set(key, guards);
      }
      guards.add(entry);
      const release = (): void => {
        if (released) return;
        released = true;
        const current = pendingRestores.get(key);
        if (!current) return;
        current.delete(entry);
        if (current.size === 0) pendingRestores.delete(key);
      };
      return {
        release,
        restore: (found, now) => {
          if (released) return null;
          release();
          if (
            entry.invalidated ||
            !found ||
            found.resetsAtEpochMs === undefined ||
            found.resetsAtEpochMs <= now ||
            stops.has(key)
          )
            return null;
          const stop: MutableStop = {
            ref,
            stopId: found.stopId,
            occurredAtEpochMs: found.occurredAtEpochMs,
            resetsAtEpochMs: found.resetsAtEpochMs,
            turnEnded: true,
            phase: "observed",
            failure: undefined,
            sawIdleWhileDue: false,
          };
          if (ended.has(stopKey(stop))) return null;
          stops.set(key, stop);
          return toPlan(stop);
        },
      };
    },
    /** The published entry of a session, or null. Clients see a due stop as scheduled. */
    entry: (ref: AgentSessionLiveRef): UsageLimitAutoResume | null => {
      const stop = stops.get(agentSessionRefKey(ref));
      if (!stop || stop.resetsAtEpochMs === undefined) return null;
      const base = { ref: stop.ref, stopId: stop.stopId, resumeAtEpochMs: dueAtOf(stop) };
      switch (stop.phase) {
        case "scheduled":
        case "due":
        case "waiting_for_idle":
          return enabled ? { ...base, state: "scheduled" } : null;
        case "resuming":
          return { ...base, state: "resuming" };
        case "failed":
          // `finishResume` sets the failure with the phase.
          return stop.failure ? { ...base, state: "failed", failure: stop.failure } : null;
        default:
          return null;
      }
    },
    clear: (): void => {
      stops.clear();
      ended.clear();
      for (const guards of pendingRestores.values()) {
        for (const guard of guards) guard.invalidated = true;
      }
      pendingRestores.clear();
      activeForegroundKeys.clear();
    },
  };
};
