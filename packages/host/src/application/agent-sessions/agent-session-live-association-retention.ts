import type {
  AgentSessionAssociation,
  AgentSessionLiveEnvelope,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import {
  agentSessionRefKey,
  describeAgentSessionScope,
  resolveAgentSessionAssociationTransition,
} from "@openducktor/core";
import { Effect } from "effect";
import { HostInvariantError } from "../../effect/host-errors";

export type AgentSessionLiveAssociationRetention = {
  readonly forget: (ref: AgentSessionLiveRef) => void;
  readonly retainEnvelope: (
    envelope: AgentSessionLiveEnvelope,
  ) => Effect.Effect<AgentSessionLiveEnvelope, HostInvariantError>;
  readonly retainSnapshot: (
    snapshot: AgentSessionLiveSnapshot,
  ) => Effect.Effect<AgentSessionLiveSnapshot, HostInvariantError>;
  readonly retainSnapshots: (
    snapshots: ReadonlyArray<AgentSessionLiveSnapshot>,
    authoritativeRepoPath?: string,
  ) => Effect.Effect<AgentSessionLiveSnapshot[], HostInvariantError>;
};

export const createAgentSessionLiveAssociationRetention =
  (): AgentSessionLiveAssociationRetention => {
    let retained = new Map<
      string,
      { association: AgentSessionAssociation; ref: AgentSessionLiveRef }
    >();

    const retainSnapshots: AgentSessionLiveAssociationRetention["retainSnapshots"] = (
      snapshots,
      authoritativeRepoPath,
    ) =>
      Effect.gen(function* () {
        const next = new Map(retained);
        const retainedKeys = new Set<string>();
        const normalizedSnapshots: AgentSessionLiveSnapshot[] = [];
        for (const snapshot of snapshots) {
          const key = agentSessionRefKey(snapshot.ref);
          const transition = resolveAgentSessionAssociationTransition(
            next.get(key)?.association,
            snapshot.sessionAssociation,
          );
          if (transition.kind === "conflict") {
            return yield* Effect.fail(
              new HostInvariantError({
                invariant: "agent_session_live_association_is_stable",
                message: `Live session '${snapshot.ref.externalSessionId}' changed from ${describeAgentSessionScope(transition.previous)} to ${describeAgentSessionScope(transition.incoming)}.`,
                details: {
                  ref: snapshot.ref,
                  previous: transition.previous,
                  incoming: transition.incoming,
                },
              }),
            );
          }
          retainedKeys.add(key);
          next.set(key, { ref: snapshot.ref, association: transition.association });
          normalizedSnapshots.push({
            ...snapshot,
            sessionAssociation: transition.association,
          });
        }
        if (authoritativeRepoPath) {
          for (const [key, value] of next) {
            if (value.ref.repoPath === authoritativeRepoPath && !retainedKeys.has(key)) {
              next.delete(key);
            }
          }
        }
        retained = next;
        return normalizedSnapshots;
      });

    const retainSnapshot: AgentSessionLiveAssociationRetention["retainSnapshot"] = (snapshot) =>
      Effect.gen(function* () {
        const sessions = yield* retainSnapshots([snapshot]);
        const session = sessions[0];
        if (!session) {
          return yield* Effect.fail(
            new HostInvariantError({
              invariant: "agent_session_live_association_is_retained",
              message: `Live session '${snapshot.ref.externalSessionId}' was not retained.`,
              details: { ref: snapshot.ref },
            }),
          );
        }
        return session;
      });

    const retainEnvelope: AgentSessionLiveAssociationRetention["retainEnvelope"] = (envelope) => {
      if (envelope.type === "session_upsert") {
        return retainSnapshot(envelope.session).pipe(
          Effect.map((session) => ({ ...envelope, session })),
        );
      }
      if (envelope.type === "session_removed") {
        retained.delete(agentSessionRefKey(envelope.ref));
        return Effect.succeed(envelope);
      }
      if (envelope.type === "snapshot") {
        return retainSnapshots(envelope.sessions, envelope.repoPath).pipe(
          Effect.map((sessions) => ({ ...envelope, sessions })),
        );
      }
      return Effect.succeed(envelope);
    };

    return {
      forget: (ref) => retained.delete(agentSessionRefKey(ref)),
      retainEnvelope,
      retainSnapshot,
      retainSnapshots,
    };
  };
