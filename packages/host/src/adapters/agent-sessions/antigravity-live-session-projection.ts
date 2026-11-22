import type {
  AgentSessionLiveRef,
  AgentSessionLiveSnapshot,
  SlashCommandCatalog,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { baselineLiveSessionChanges } from "../../application/agent-sessions/baseline-live-session-changes";
import { toHostOperationError } from "../../effect/host-errors";
import type {
  AgentSessionLiveAdapterChange,
  AgentSessionLiveRegistration,
} from "../../ports/agent-session-live-adapter-port";
import type { AntigravityLiveChange } from "../antigravity/antigravity-live-change";
import { liveSessionRefKey } from "./live-session-ref";
import { createOrderedLiveChangeQueue } from "./ordered-live-change-queue";

/**
 * The ordered live projection of one Antigravity runtime: the snapshot of each live session, and
 * the command list of each session for the runtime catalog of its directory.
 */
export const createAntigravityLiveSessionProjection = ({
  runtimeId,
  binding,
}: {
  readonly runtimeId: string;
  readonly binding: AgentSessionLiveRegistration;
}) => {
  const snapshotsByRef = new Map<string, AgentSessionLiveSnapshot>();
  // The command list of each live session, in update order. The runtime catalog of a directory is
  // the newest list of a live session in it, so a released session leaves no list behind.
  const slashCommandsBySession = new Map<
    string,
    { readonly ref: AgentSessionLiveRef; readonly catalog: SlashCommandCatalog }
  >();

  const directorySlashCommands = (workingDirectory: string): SlashCommandCatalog => {
    let latest: SlashCommandCatalog = { commands: [] };
    for (const entry of slashCommandsBySession.values()) {
      if (entry.ref.workingDirectory === workingDirectory) latest = entry.catalog;
    }
    return latest;
  };

  const catalogUpdated = (ref: AgentSessionLiveRef): AgentSessionLiveAdapterChange => ({
    type: "slash_command_catalog_updated",
    repoPath: ref.repoPath,
    runtimeKind: "antigravity",
    workingDirectory: ref.workingDirectory,
    catalog: directorySlashCommands(ref.workingDirectory),
  });

  const applyChange = (change: AntigravityLiveChange) =>
    binding.runMutation(
      Effect.sync(() => {
        if (queue.released) return { value: undefined, changes: [] };
        const changes: AgentSessionLiveAdapterChange[] = [];
        // A settling snapshot goes after the transcript events, so a client never shows a settled
        // turn without its final reply.
        const settling: AgentSessionLiveAdapterChange[] = [];
        for (const snapshot of change.snapshots) {
          const key = liveSessionRefKey(snapshot.ref);
          const previous = snapshotsByRef.get(key);
          snapshotsByRef.set(key, snapshot);
          if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) continue;
          (previous && snapshot.activity === "idle" ? settling : changes).push({
            type: "session_upsert",
            snapshot,
          });
        }
        for (const ref of change.removedRefs) {
          const key = liveSessionRefKey(ref);
          if (snapshotsByRef.delete(key)) changes.push({ type: "session_removed", ref });
          if (slashCommandsBySession.delete(key)) changes.push(catalogUpdated(ref));
        }
        for (const event of change.events) changes.push({ type: "transcript_event", event });
        changes.push(...settling);
        if (change.slashCommands) {
          const { ref, catalog } = change.slashCommands;
          const key = liveSessionRefKey(ref);
          slashCommandsBySession.delete(key);
          slashCommandsBySession.set(key, { ref, catalog });
          changes.push(catalogUpdated(ref));
        }
        return {
          value: undefined,
          admittedRoot: change.admittedRoot,
          changes: change.provenance === "baseline" ? baselineLiveSessionChanges(changes) : changes,
        };
      }),
    );

  // The live state of the sessions in a failed change is now stale, so each one shows the failure.
  const reportFault = (change: AntigravityLiveChange, cause: unknown) => {
    const failure = toHostOperationError(cause, "antigravity-live-session.publish", { runtimeId });
    const refs = [...change.snapshots.map((snapshot) => snapshot.ref), ...change.removedRefs];
    return binding
      .runMutation(
        Effect.succeed({
          value: undefined,
          changes: refs.map((ref): AgentSessionLiveAdapterChange => ({
            type: "fault",
            repoPath: ref.repoPath,
            ref,
            operation: failure.operation,
            message: failure.message,
          })),
        }),
      )
      .pipe(Effect.ignore);
  };

  const queue = createOrderedLiveChangeQueue<AntigravityLiveChange>({
    runtimeLabel: "Antigravity",
    runtimeId,
    operationPrefix: "antigravity-live-session",
    apply: applyChange,
    onApplyFailure: reportFault,
  });

  return {
    get released(): boolean {
      return queue.released;
    },
    publish: queue.enqueue,
    startForwarding: queue.startForwarding,
    directorySlashCommands,
    listSnapshots: (): AgentSessionLiveSnapshot[] => [...snapshotsByRef.values()],
    readSnapshot: (ref: AgentSessionLiveRef) => {
      const snapshot = snapshotsByRef.get(liveSessionRefKey(ref));
      return snapshot
        ? ({ type: "live", session: snapshot } as const)
        : ({ type: "missing", ref } as const);
    },
    /** Rejects the waiting changes and clears the projection. Returns the refs that were live. */
    release: (): AgentSessionLiveRef[] => {
      if (!queue.release()) return [];
      const refs = [...snapshotsByRef.values()].map((snapshot) => snapshot.ref);
      snapshotsByRef.clear();
      slashCommandsBySession.clear();
      return refs;
    },
  };
};
