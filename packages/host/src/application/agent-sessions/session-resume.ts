import type { AgentSessionControlSummary, AgentSessionLiveRef } from "@openducktor/contracts";
import { Effect } from "effect";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import { TaskSessionOwnershipCommittedError } from "./task-session-ownership-error";
import { toControlSessionRef } from "./task-workflow-session-storage";

/** Keep a saved session attached. Release it only when ownership save fails. */
export const resumeAndSaveSession = <Saved, Failure extends Error>({
  ref,
  resume,
  save,
  release,
}: {
  ref: AgentSessionLiveRef;
  resume: Effect.Effect<AgentSessionControlSummary, HostError>;
  save: (session: AgentSessionControlSummary) => Effect.Effect<Saved, Failure>;
  release: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>;
}) =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      const session = yield* resume;
      const saved = yield* Effect.result(save(session));
      if (saved._tag === "Success") return { session, saved: saved.success };
      if (saved.failure instanceof TaskSessionOwnershipCommittedError)
        return yield* Effect.fail(saved.failure);
      const cleanup = yield* Effect.result(release(toControlSessionRef(ref.repoPath, session)));
      if (cleanup._tag === "Failure")
        return yield* new HostOperationError({
          operation: "agent-session.resume",
          message: `${saved.failure.message} Cleanup failed: ${cleanup.failure.message}`,
          cause: { storeFailure: saved.failure, cleanupFailure: cleanup.failure },
          details: { ref },
        });
      return yield* Effect.fail(saved.failure);
    }),
  );
