import type { AgentSessionLiveRef, AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import { Effect } from "effect";
import { sessionTreeSnapshots } from "../../domain/agent-sessions/live-session-tree";
import type { HostError } from "../../effect/host-errors";
import type { AgentSessionLiveAdapterRegistryPort } from "../../ports/agent-session-live-adapter-port";
import type { createLiveProjectionAttachmentOwner } from "./live-projection-attachment-owner";
import type { createAgentSessionPublicationCursor } from "./agent-session-live-envelope";
import type { createAgentSessionLiveRuntimeLifecycle } from "./agent-session-live-runtime-lifecycle";

export const createSetSessionOwnership =
  ({
    adapterRegistry,
    attachmentOwner,
    publication,
    publishEnvelope,
    lifecycle,
  }: {
    adapterRegistry: AgentSessionLiveAdapterRegistryPort;
    attachmentOwner: ReturnType<typeof createLiveProjectionAttachmentOwner>;
    publication: ReturnType<typeof createAgentSessionPublicationCursor>;
    publishEnvelope: (envelope: AgentSessionLiveEnvelope) => Effect.Effect<void, HostError>;
    lifecycle: Pick<ReturnType<typeof createAgentSessionLiveRuntimeLifecycle>, "requireAttached">;
  }): ((ref: AgentSessionLiveRef, active: boolean) => Effect.Effect<void, HostError>) =>
  (ref, active) =>
    Effect.gen(function* () {
      const adapter = yield* adapterRegistry
        .resolveControlForScope(ref)
        .pipe(Effect.catchTag("HostResourceError", () => Effect.succeed(null)));
      if (!adapter) return;
      yield* attachmentOwner.run(
        adapter,
        `${active}:${agentSessionRefKey(ref)}`,
        Effect.gen(function* () {
          const startedAt = publication.beginRecovery();
          const before = sessionTreeSnapshots(
            [...(yield* adapter.listSnapshots(ref.repoPath))],
            ref,
          );
          yield* active ? adapter.restoreSessionTree(ref) : adapter.releaseSession(ref);
          const after = sessionTreeSnapshots(
            [...(yield* adapter.listSnapshots(ref.repoPath))],
            ref,
          );
          publication.completeRecovery(ref.repoPath, startedAt, [
            ref,
            ...before.map((session) => session.ref),
            ...after.map((session) => session.ref),
          ]);
        }).pipe(
          Effect.tapError((cause) =>
            publishEnvelope({
              type: "fault",
              repoPath: ref.repoPath,
              ref,
              operation: "agent-session-live.reconcile-ownership",
              message: cause.message,
            }),
          ),
        ),
      );
      yield* lifecycle.requireAttached(adapter.binding);
    });
