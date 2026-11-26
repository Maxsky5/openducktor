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
};

/** The stops whose due time passed, and the next due time of the others. */
export type DueStops = { due: TrackedUsageLimitStop[]; nextDueAt: number | undefined };

/** What the due-time checks found. `recovery` is the answer of the runtime for the account. */
export type DueCheck = {
  blockedOnInput: boolean;
  hasActiveTurn?: boolean;
  idleCountBefore?: number;
  now: number;
  recovery: UsageLimitRecovery;
};

export const supportsUsageLimitAutoResume = (runtimeKind: RuntimeKind): boolean =>
  RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind].capabilities.sessionLifecycle
    .supportsUsageLimitAutoResume;

const stopKey = (stop: Pick<MutableStop, "ref" | "stopId">): string =>
  `${agentSessionRefKey(stop.ref)}\u0000${stop.stopId}`;

/** A reset that is not later than the error would start a retry loop. */
const hasEligibleReset = (stop: MutableStop): boolean =>
  stop.resetsAtEpochMs !== undefined && stop.resetsAtEpochMs > stop.occurredAtEpochMs;

const dueAtOf = (stop: MutableStop): number =>
  (stop.resetsAtEpochMs ?? 0) + USAGE_LIMIT_RESUME_GRACE_MS;

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
  /** Counts new work of each session, so a history read can tell that the session moved on. */
  const workCounts = new Map<string, number>();
  /** Sessions whose latest observed live snapshot has an active foreground turn. */
  const activeForegroundKeys = new Set<string>();
  /** Counts transitions to idle so an in-flight due check can tell that a wake already ended. */
  const idleCounts = new Map<string, number>();
  /** Tool call IDs already observed per session, so later progress updates do not count as new work. */
  const knownToolCallIds = new Map<string, Set<string>>();

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
    workCounts.set(key, (workCounts.get(key) ?? 0) + 1);
  };

  /** New work in the session ends its stop. */
  const newWork = (key: string): void => {
    countWork(key);
    end(key);
  };

  const recordToolCallId = (key: string, callId: string): void => {
    let calls = knownToolCallIds.get(key);
    if (!calls) {
      calls = new Set();
      knownToolCallIds.set(key, calls);
    }
    calls.add(callId);
  };

  const noteIdle = (key: string): void => {
    activeForegroundKeys.delete(key);
    idleCounts.set(key, (idleCounts.get(key) ?? 0) + 1);
    const stop = stops.get(key);
    if (stop?.phase === "waiting_for_idle") setPhase(stop, "scheduled");
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
    if (session.ref.runtimeKind === "claude") return;
    newWork(key);
  };

  return {
    /** Applies one live change. Returns the stop that needs a root check before its plan. */
    observe: (envelope: AgentSessionLiveEnvelope): TrackedUsageLimitStop | null => {
      switch (envelope.type) {
        case "transcript_event": {
          const { event } = envelope;
          const key = agentSessionRefKey(event.sessionRef);
          if (event.type === "turn_error") {
            if (event.usageLimit && event.messageId) return observeLimitError(key, event);
            const stop = stops.get(key);
            if (stop?.phase !== "resuming" && stop?.turnEnded !== false) newWork(key);
            return null;
          }
          if (isAcceptedUserMessage(event)) {
            newWork(key);
          } else {
            const isNewWork = isNewTurnWorkEvent(event, knownToolCallIds.get(key));
            if (event.type === "assistant_part" && event.part.kind === "tool") {
              recordToolCallId(key, event.part.callId);
            }
            if (isNewWork) {
              const stop = stops.get(key);
              if (stop?.phase !== "resuming") {
                if (stop?.turnEnded === false) countWork(key);
                else newWork(key);
              }
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
          const key = agentSessionRefKey(envelope.ref);
          knownToolCallIds.delete(key);
          noteIdle(key);
          return null;
        }
        case "snapshot":
          for (const session of envelope.sessions) observeSession(session);
          return null;
        case "session_operation_updated": {
          const { observation } = envelope;
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
      if (check.blockedOnInput || !hasEligibleReset(current)) {
        end(key);
        return false;
      }
      const becameIdleDuringCheck =
        check.hasActiveTurn === true &&
        check.idleCountBefore !== undefined &&
        (idleCounts.get(key) ?? 0) !== check.idleCountBefore;
      const stillActive =
        activeForegroundKeys.has(key) || (check.hasActiveTurn === true && !becameIdleDuringCheck);
      if (stillActive) {
        if (current.ref.runtimeKind !== "claude") {
          end(key);
          return false;
        }
        setPhase(current, "waiting_for_idle");
        return false;
      }
      if (becameIdleDuringCheck) {
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
    /** The work count before a history read, to compare after it. */
    workCount: (ref: AgentSessionLiveRef): number => workCounts.get(agentSessionRefKey(ref)) ?? 0,
    /** The idle count before a due check, to detect a wake that finished while the check ran. */
    idleCount: (ref: AgentSessionLiveRef): number => idleCounts.get(agentSessionRefKey(ref)) ?? 0,
    /**
     * Adds a stop that runtime history reports after a host start. A passed reset waits for a
     * manual Resume. New work or a live stop during the read is newer than the history.
     */
    restore: (
      ref: AgentSessionLiveRef,
      found: UsageLimitStop | null,
      workCountBefore: number,
      now: number,
    ): TrackedUsageLimitStop | null => {
      const key = agentSessionRefKey(ref);
      if (
        !found ||
        found.resetsAtEpochMs === undefined ||
        found.resetsAtEpochMs <= now ||
        stops.has(key) ||
        (workCounts.get(key) ?? 0) !== workCountBefore
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
      };
      if (ended.has(stopKey(stop))) return null;
      stops.set(key, stop);
      return toPlan(stop);
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
      workCounts.clear();
      activeForegroundKeys.clear();
      idleCounts.clear();
      knownToolCallIds.clear();
    },
  };
};
