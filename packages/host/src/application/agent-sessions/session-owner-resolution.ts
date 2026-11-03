import type {
  AgentSessionAuthorizedRoot,
  AgentSessionLiveRef,
  AgentSessionScope,
  AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { agentSessionScopesEqual, agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import { HostValidationError, type HostError } from "../../effect/host-errors";

/** Live snapshots contain only admitted roots and native-verified descendants. */
export const resolveOwnedSessionRoot = ({
  ref,
  roots,
  sessions,
}: {
  ref: AgentSessionLiveRef & { sessionScope?: AgentSessionScope | undefined };
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
      const selected = ref.sessionScope;
      const matching = selected
        ? owned.filter((root) => agentSessionScopesEqual(root.sessionScope, selected))
        : owned;
      if (matching.length === 1) return matching[0]!;
      if (owned.length > 0)
        return yield* invalid(
          owned.length === 1
            ? "This session belongs to another task, role, or workspace chat. Reload the chat before continuing."
            : "The session has conflicting saved owners. Select its saved task or workspace chat before continuing.",
        );
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
