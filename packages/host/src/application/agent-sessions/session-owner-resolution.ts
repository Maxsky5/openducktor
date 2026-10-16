import type {
  AgentSessionAuthorizedRoot,
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError, type HostError } from "../../effect/host-errors";

/** Live snapshots contain only admitted roots and native-verified descendants. */
export const resolveOwnedSessionRoot = ({
  ref,
  roots,
  sessions,
}: {
  ref: AgentSessionLiveRef;
  roots: readonly AgentSessionAuthorizedRoot[];
  sessions: readonly AgentSessionLiveSnapshot[];
}): Effect.Effect<AgentSessionAuthorizedRoot, HostError> =>
  Effect.gen(function* () {
    let current = ref;
    const seen = new Set<string>();
    while (true) {
      const key = agentSessionRefKey(current);
      if (seen.has(key))
        return yield* invalid(
          "The runtime session ancestry contains a cycle. Reload the runtime before continuing.",
        );
      seen.add(key);
      const owned = roots.filter((root) => agentSessionRefKey(root) === key);
      if (owned.length > 1)
        return yield* invalid(
          "The session has conflicting saved owners. Review its task and workspace associations.",
        );
      if (owned[0]) return owned[0];
      const session = sessions.find((value) => agentSessionRefKey(value.ref) === key);
      if (!session?.parentExternalSessionId)
        return yield* invalid(
          `Session '${ref.externalSessionId}' has no verified saved owner. Reopen its task or workspace chat.`,
        );
      const parent = sessions.filter(
        (value) =>
          value.ref.repoPath === ref.repoPath &&
          value.ref.runtimeKind === ref.runtimeKind &&
          value.ref.workingDirectory === ref.workingDirectory &&
          value.ref.externalSessionId === session.parentExternalSessionId,
      );
      if (parent.length !== 1)
        return yield* invalid(
          "The runtime cannot verify the complete parent session chain in this workspace. Reload the runtime before continuing.",
        );
      current = parent[0]!.ref;
    }
  });
const invalid = (message: string) => new HostValidationError({ field: "sessionScope", message });
