import type { AgentSessionLiveEnvelope, AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";

export const createAgentSessionExecutionEpisodes = () => {
  const episodes = new Map<string, { id: string; running: boolean; repoPath: string }>();

  const snapshotWithEpisode = (
    snapshot: AgentSessionLiveSnapshot,
    liveChange = false,
  ): AgentSessionLiveSnapshot => {
    const key = agentSessionRefKey(snapshot.ref);
    let episode = episodes.get(key);
    const running = snapshot.activity !== "idle";
    if (!episode || (liveChange && running && !episode.running)) {
      episode = { id: crypto.randomUUID(), running, repoPath: snapshot.ref.repoPath };
      episodes.set(key, episode);
    } else if (liveChange) {
      episode.running = running;
    }
    return { ...snapshot, executionEpisodeId: episode.id };
  };

  return {
    snapshotWithEpisode,
    replaceSnapshots(repoPath: string, snapshots: readonly AgentSessionLiveSnapshot[]) {
      const retained = new Set(snapshots.map((snapshot) => agentSessionRefKey(snapshot.ref)));
      for (const [key, episode] of episodes) {
        if (episode.repoPath === repoPath && !retained.has(key)) episodes.delete(key);
      }
      return snapshots.map((snapshot) => snapshotWithEpisode(snapshot));
    },
    accept(envelope: AgentSessionLiveEnvelope): AgentSessionLiveEnvelope {
      if (envelope.type === "session_upsert") {
        return { ...envelope, session: snapshotWithEpisode(envelope.session, true) };
      }
      if (envelope.type === "session_removed") {
        episodes.delete(agentSessionRefKey(envelope.ref));
      }
      if (envelope.type === "transcript_event") {
        const event = envelope.event;
        const ended =
          event.type === "session_idle" ||
          event.type === "session_finished" ||
          event.type === "turn_error" ||
          event.type === "session_error" ||
          (event.type === "session_status" && event.status.type === "idle");
        const episode = episodes.get(agentSessionRefKey(event.sessionRef));
        if (ended && episode) episode.running = false;
      }
      return envelope;
    },
  };
};
