import type {
  GitChangeGroup,
  GitChangeSelectionRequest,
  GitLocalChanges,
} from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type AgentStudioPendingDiscard,
  type GitChangeIntent,
  type GitConflict,
  gitChangeIntentKey,
} from "@/features/agent-studio-git";
import { host } from "@/state/operations/shared/host";
import { refreshWorkspaceFileQueries } from "@/state/queries/filesystem";
import {
  CONFLICT_LOCK_REASON,
  type RefreshGitDiffData,
  toErrorMessage,
} from "./use-agent-studio-git-action-utils";

type PendingDiscard = AgentStudioPendingDiscard & {
  scopeKey: string;
  request: GitChangeSelectionRequest;
};

/**
 * A change in the queue. Stage and Unstage show their result before Git ends. `settledAt` is the
 * read time of the Git result, so the row stays until the panel shows that result.
 */
type QueuedChange = { id: number; intent: GitChangeIntent; settledAt?: number };

type UseAgentStudioGitChangeActionsArgs = {
  isCurrentContext: () => boolean;
  repoPath: string | null;
  workingDir: string | null;
  localChanges: GitLocalChanges | null;
  /** Why another Git action blocks a change now, such as a running commit or push. */
  otherActionReason: string | null;
  activeGitConflict: GitConflict | null;
  refreshDiffData: RefreshGitDiffData;
  /** Shows the local changes that a change returned. */
  applyLocalChanges: (changes: GitLocalChanges) => Promise<void>;
  clearActionErrors: () => void;
  setChangeError: (message: string | null) => void;
};

const UNAVAILABLE_REASON = "The changes are unavailable. Refresh and try again.";
const MOVED_CHUNK_REASON = "This file changed after you chose the chunk. Review the chunk again.";
const EMPTY_QUEUE: Promise<void> = Promise.resolve();

/** The newer of two reads of the same directory. A read of another directory replaces it. */
const newerChanges = (
  current: GitLocalChanges | null,
  next: GitLocalChanges | null,
): GitLocalChanges | null => {
  if (!current || !next) return next;
  if (current.snapshot.effectiveWorkingDir !== next.snapshot.effectiveWorkingDir) return next;
  return next.snapshot.observedAtMs >= current.snapshot.observedAtMs ? next : current;
};

const fileDiffText = (
  changes: GitLocalChanges | null,
  group: GitChangeGroup,
  filePath: string,
): string | undefined => changes?.[group].fileDiffs.find((diff) => diff.file === filePath)?.diff;

/** True until the shown local changes include the Git result of the change. */
const isShownAsPending = (entry: QueuedChange, shown: GitLocalChanges | null): boolean =>
  entry.settledAt === undefined || !shown || shown.snapshot.observedAtMs < entry.settledAt;

/**
 * Stage, Unstage, and Discard run one at a time in a queue, so a click never waits for a button
 * and never uses an old snapshot. Each change reads its snapshots from the newest local changes,
 * and Git returns the next ones with its result. Reads do not block changes.
 */
export function useAgentStudioGitChangeActions({
  isCurrentContext,
  repoPath,
  workingDir,
  localChanges,
  otherActionReason,
  activeGitConflict,
  refreshDiffData,
  applyLocalChanges,
  clearActionErrors,
  setChangeError,
}: UseAgentStudioGitChangeActionsArgs) {
  const queryClient = useQueryClient();
  const scopeKey = JSON.stringify([repoPath, workingDir]);
  const [queued, setQueued] = useState<QueuedChange[]>([]);
  const [changingKey, setChangingKey] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDiscard | null>(null);
  const pendingDiscard = pending?.scopeKey === scopeKey ? pending : null;
  const queue = useRef<Promise<void>>(EMPTY_QUEUE);
  const nextId = useRef(0);
  const latest = useRef<GitLocalChanges | null>(localChanges);
  /** The local changes that the panel shows, so a click reads the diff that the user saw. */
  const shown = useRef<GitLocalChanges | null>(localChanges);
  /** A failed change or another directory ends every change that waits behind it. */
  const generation = useRef(0);
  useLayoutEffect(() => {
    shown.current = localChanges;
    latest.current = newerChanges(latest.current, localChanges);
  }, [localChanges]);
  /** Ends the changes that wait in the queue, so none of them runs. */
  const endQueuedChanges = useCallback((): void => {
    generation.current += 1;
    // An empty queue keeps its state, so a new directory adds no render.
    setQueued((entries) => (entries.length === 0 ? entries : []));
  }, []);
  useLayoutEffect(() => {
    endQueuedChanges();
  }, [endQueuedChanges, scopeKey]);

  const changeDisabledReason = useMemo((): string | null => {
    if (!repoPath) return "Cannot change files because no repository is selected.";
    if (activeGitConflict != null) return CONFLICT_LOCK_REASON;
    if (otherActionReason !== null) return otherActionReason;
    if (!localChanges) return UNAVAILABLE_REASON;
    return null;
  }, [activeGitConflict, localChanges, otherActionReason, repoPath]);

  const buildRequest = useCallback(
    (intent: GitChangeIntent): GitChangeSelectionRequest | null => {
      const changes = latest.current;
      if (!repoPath || !changes) return null;
      const request: GitChangeSelectionRequest = {
        repoPath,
        expectedBranch: changes.currentBranch,
        snapshots: { unstaged: changes.unstaged.snapshot, staged: changes.staged.snapshot },
        ...intent,
      };
      if (workingDir) request.workingDir = workingDir;
      return request;
    },
    [repoPath, workingDir],
  );

  /**
   * A chunk number points into the diff that the user saw. An earlier change of the same file can
   * put another chunk at that number, so the chunk change stops when the diff is not the same.
   */
  const chunkMoved = useCallback((intent: GitChangeIntent, reviewedDiff: string | undefined) => {
    const { selection } = intent;
    if (selection.kind !== "hunk") return false;
    return fileDiffText(latest.current, intent.group, selection.filePath) !== reviewedDiff;
  }, []);

  /** Runs `task` after every earlier change, unless a failure or another directory ended it. */
  const enqueue = useCallback((task: () => Promise<void>): Promise<void> => {
    const queuedIn = generation.current;
    const run = queue.current.then(() => (generation.current === queuedIn ? task() : undefined));
    // The caller gets any failure. The next change still runs.
    queue.current = run.catch(() => undefined);
    return run;
  }, []);

  /** Writes one change and returns the local changes after it, or null when it failed. */
  const write = useCallback(
    async (request: GitChangeSelectionRequest): Promise<GitLocalChanges | null> => {
      const writtenIn = generation.current;
      setChangingKey(gitChangeIntentKey(request));
      try {
        const result = await host.gitChangeSelection(request);
        if (generation.current === writtenIn) {
          latest.current = newerChanges(latest.current, result.localChanges);
        }
        await applyLocalChanges(result.localChanges);
        // The index and the files changed, so the Files tab reads its Git markers again.
        // The file views show their own failed read.
        void refreshWorkspaceFileQueries(queryClient, workingDir ?? request.repoPath).catch(
          () => undefined,
        );
        if (isCurrentContext()) clearActionErrors();
        if (isCurrentContext() && request.action === "discard") {
          toast.success("Changes discarded", { description: result.affectedPaths.join(", ") });
        }
        return result.localChanges;
      } catch (error) {
        let failure = toErrorMessage(error, "The Git change failed.");
        if (isCurrentContext()) toast.error("Git change failed", { description: failure });
        // A failed write can still change content, so read the actual state.
        try {
          await refreshDiffData("soft");
        } catch (readError) {
          failure = `${failure} The panel could not update: ${toErrorMessage(readError, "The read failed.")}`;
        }
        if (isCurrentContext()) setChangeError(failure);
        // Later changes of this directory assumed this result, so they leave the queue.
        if (generation.current === writtenIn) endQueuedChanges();
        return null;
      } finally {
        setChangingKey(null);
      }
    },
    [
      applyLocalChanges,
      clearActionErrors,
      endQueuedChanges,
      isCurrentContext,
      queryClient,
      refreshDiffData,
      setChangeError,
      workingDir,
    ],
  );

  const stageOrUnstage = useCallback(
    (intent: GitChangeIntent, reviewedDiff: string | undefined): void => {
      const id = nextId.current++;
      setChangeError(null);
      // A shown result needs no row of its own any more.
      setQueued((entries) => [
        ...entries.filter((entry) => entry.settledAt === undefined),
        { id, intent },
      ]);
      void enqueue(async () => {
        if (chunkMoved(intent, reviewedDiff)) {
          setChangeError(MOVED_CHUNK_REASON);
          setQueued((entries) => entries.filter((entry) => entry.id !== id));
          return;
        }
        const request = buildRequest(intent);
        if (!request) {
          setChangeError(UNAVAILABLE_REASON);
          endQueuedChanges();
          return;
        }
        const changes = await write(request);
        if (!changes) return;
        const settledAt = changes.snapshot.observedAtMs;
        setQueued((entries) =>
          entries.map((entry) => (entry.id === id ? { ...entry, settledAt } : entry)),
        );
      });
    },
    [buildRequest, chunkMoved, endQueuedChanges, enqueue, setChangeError, write],
  );

  /** Stage and Unstage run at once. Discard asks for confirmation after the earlier changes. */
  const changeSelection = useCallback(
    async (intent: GitChangeIntent): Promise<void> => {
      if (changeDisabledReason !== null) {
        setChangeError(changeDisabledReason);
        return;
      }
      const { selection } = intent;
      const reviewedDiff =
        selection.kind === "hunk"
          ? fileDiffText(shown.current, intent.group, selection.filePath)
          : undefined;
      if (intent.action !== "discard" || selection.kind === "all") {
        stageOrUnstage(intent, reviewedDiff);
        return;
      }
      setChangeError(null);
      // The dialog keeps the content that Git shows after the earlier changes.
      await enqueue(async () => {
        if (chunkMoved(intent, reviewedDiff)) {
          setChangeError(MOVED_CHUNK_REASON);
          return;
        }
        const request = buildRequest(intent);
        if (!request) {
          setChangeError(UNAVAILABLE_REASON);
          return;
        }
        const status = latest.current?.[intent.group].fileStatuses.find(
          (entry) => entry.path === selection.filePath,
        );
        setPending({
          scopeKey,
          request,
          group: intent.group,
          selection,
          isUntrackedFile: selection.kind === "file" && status?.status === "untracked",
        });
      });
    },
    [
      buildRequest,
      changeDisabledReason,
      chunkMoved,
      enqueue,
      scopeKey,
      setChangeError,
      stageOrUnstage,
    ],
  );

  const confirmDiscard = useCallback(async (): Promise<void> => {
    if (!pendingDiscard) return;
    setPending(null);
    if (changeDisabledReason !== null) {
      setChangeError(changeDisabledReason);
      return;
    }
    // Send the snapshot that the user reviewed. The host rejects it when the content moved.
    await enqueue(async () => {
      await write(pendingDiscard.request);
    });
  }, [changeDisabledReason, enqueue, pendingDiscard, setChangeError, write]);

  const cancelDiscard = useCallback((): void => {
    setPending(null);
  }, []);

  const pendingChanges = useMemo(
    () =>
      queued.filter((entry) => isShownAsPending(entry, localChanges)).map((entry) => entry.intent),
    [localChanges, queued],
  );

  return {
    changingKey,
    isChanging: changingKey !== null || queued.some((entry) => entry.settledAt === undefined),
    pendingChanges,
    changeDisabledReason,
    pendingDiscard,
    changeSelection,
    confirmDiscard,
    cancelDiscard,
  };
}
