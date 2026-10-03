import type {
  RuntimeKind,
  AgentSessionLiveBaseline,
  AgentSessionLiveCursor,
  AgentSessionLiveEnvelope,
} from "@openducktor/contracts";

type AgentSessionLiveAttachment = {
  accept: (envelope: AgentSessionLiveEnvelope) => void;
  restart: () => void;
  install: (baseline: AgentSessionLiveBaseline) => void;
};

export const envelopeRepoPath = (envelope: AgentSessionLiveEnvelope): string => {
  switch (envelope.type) {
    case "connection_state":
    case "snapshot":
    case "transcript_gap":
    case "fault":
      return envelope.repoPath;
    case "session_upsert":
      return envelope.session.ref.repoPath;
    case "session_removed":
      return envelope.ref.repoPath;
    case "transcript_event":
      return envelope.event.sessionRef.repoPath;
    case "catalog_invalidated":
    case "runtime_changed":
    case "slash_command_catalog_updated":
      return envelope.scope.repoPath;
  }
};

export const createAgentSessionLiveAttachment = (
  repoPath: string,
  listener: (envelope: AgentSessionLiveEnvelope) => void,
): AgentSessionLiveAttachment => {
  let awaitingSnapshot = true;
  let pending: AgentSessionLiveEnvelope[] = [];
  let applied: AgentSessionLiveCursor | null = null;
  // A state baseline contains neither transcript content nor catalog changes.
  let appliedContent: AgentSessionLiveCursor | null = null;
  let generations: Map<RuntimeKind, string> | null = null;
  const rememberRuntime = (envelope: AgentSessionLiveEnvelope): void => {
    if (envelope.type !== "runtime_changed") return;
    generations ??= new Map();
    if (envelope.state === "stopped") generations.delete(envelope.scope.runtimeKind);
    else if (envelope.runtimeGeneration)
      generations.set(envelope.scope.runtimeKind, envelope.runtimeGeneration);
  };
  const deliver = (envelope: AgentSessionLiveEnvelope): void => {
    const cursor = envelope.cursor;
    if (cursor && applied && cursor.hostEpoch !== applied.hostEpoch) return;
    const content = isContentEvent(envelope);
    const covered = content ? appliedContent : applied;
    if (cursor && covered && cursor.sequence <= covered.sequence) return;
    listener(
      envelope.type === "transcript_event" &&
        cursor &&
        applied &&
        cursor.sequence <= applied.sequence
        ? { ...envelope, stateCovered: true }
        : envelope,
    );
    rememberRuntime(envelope);
    if (cursor) {
      if (content) appliedContent = cursor;
      if (!applied || cursor.sequence > applied.sequence) applied = cursor;
    }
  };

  return {
    install: (baseline) => {
      if (baseline.repoPath !== repoPath)
        throw new Error("Live baseline belongs to a different repository.");
      if (
        applied &&
        baseline.cursor.hostEpoch === applied.hostEpoch &&
        baseline.cursor.sequence < applied.sequence
      )
        throw new Error(
          "The live baseline is older than already applied events. Reconnect to the configured host to restore observation.",
        );
      const buffered = pending;
      const nextGenerations = new Map(
        baseline.runtimeGenerations.map((runtime) => [runtime.runtimeKind, runtime.generation]),
      );
      const changed = new Set<RuntimeKind>();
      if (generations)
        for (const kind of new Set([...generations.keys(), ...nextGenerations.keys()])) {
          if (generations.get(kind) !== nextGenerations.get(kind)) changed.add(kind);
        }
      for (const envelope of buffered)
        if (
          envelope.type === "runtime_changed" &&
          (!envelope.cursor ||
            (envelope.cursor.hostEpoch === baseline.cursor.hostEpoch &&
              envelope.cursor.sequence <= baseline.cursor.sequence))
        )
          changed.add(envelope.scope.runtimeKind);
      const snapshot: AgentSessionLiveEnvelope = {
        type: "snapshot",
        repoPath: baseline.repoPath,
        sessions: baseline.sessions,
        cursor: baseline.cursor,
        isConnectionSnapshot: true,
      };
      if (baseline.runtimeGenerations.length > 0)
        snapshot.runtimeGenerations = baseline.runtimeGenerations;
      listener(snapshot);
      const runtimeChanges: AgentSessionLiveEnvelope[] = [];
      for (const runtimeKind of changed) {
        const change: AgentSessionLiveEnvelope = {
          type: "runtime_changed",
          scope: {
            repoPath,
            runtimeKind,
          },
          state: nextGenerations.has(runtimeKind) ? "ready" : "stopped",
        };
        const generation = nextGenerations.get(runtimeKind);
        if (generation) change.runtimeGeneration = generation;
        runtimeChanges.push(change);
      }
      generations = nextGenerations;
      for (const failure of baseline.failures) listener({ type: "fault", repoPath, ...failure });
      pending = [];
      awaitingSnapshot = false;
      applied = baseline.cursor;
      if (appliedContent?.hostEpoch !== baseline.cursor.hostEpoch) appliedContent = null;
      const later: AgentSessionLiveEnvelope[] = [];
      for (const envelope of buffered) {
        if (envelope.type === "transcript_gap") continue;
        if (!envelope.cursor) {
          if (envelope.type === "runtime_changed" && changed.has(envelope.scope.runtimeKind))
            continue;
          listener(envelope);
          rememberRuntime(envelope);
          continue;
        }
        if (envelope.cursor.hostEpoch !== baseline.cursor.hostEpoch) continue;
        if (envelope.cursor.sequence <= baseline.cursor.sequence) {
          if (isContentEvent(envelope)) deliver(envelope);
        } else later.push(envelope);
      }
      for (const change of runtimeChanges) listener(change);
      for (const envelope of later) deliver(envelope);
      for (const envelope of buffered) if (envelope.type === "transcript_gap") listener(envelope);
    },
    accept: (envelope) => {
      if (envelopeRepoPath(envelope) !== repoPath) {
        return;
      }
      if (envelope.type === "connection_state" || (envelope.type === "fault" && !envelope.cursor)) {
        listener(envelope);
        return;
      }
      if (awaitingSnapshot) {
        pending.push(envelope);
        if (envelope.type === "transcript_gap") listener({ ...envelope, replayPending: true });
        return;
      }
      deliver(envelope);
    },
    restart: () => {
      if (!awaitingSnapshot) {
        pending = [];
      }
      awaitingSnapshot = true;
    },
  };
};

const isContentEvent = (envelope: AgentSessionLiveEnvelope): boolean =>
  envelope.type === "transcript_event" ||
  envelope.type === "catalog_invalidated" ||
  envelope.type === "slash_command_catalog_updated";
