import type { WorkspaceSession } from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type SessionNavigationRecovery,
  useSessionNavigationRecovery,
} from "@/features/session-navigation/use-session-navigation-recovery";
import { errorMessage } from "@/lib/errors";
import { scheduleTask } from "@/lib/scheduling";

export function useWorkspaceSessionSelection({
  workspaceId,
  sessions,
  requestedSessionId,
}: {
  workspaceId: string;
  sessions: WorkspaceSession[] | undefined;
  requestedSessionId: string | null | undefined;
}): WorkspaceSessionSelection {
  const storageKey = workspaceSessionSelectionStorageKey(workspaceId);
  const [lastSelection, setLastSelection] = useState(() => ({
    workspaceId,
    ...readSelection(storageKey),
  }));
  const savedSelection = useRef({ workspaceId, sessionId: lastSelection.sessionId });
  const [failure, setFailure] = useState<{
    workspaceId: string;
    sessionId: string | null;
    error: Error;
  } | null>(null);
  let currentSelection = lastSelection;
  if (lastSelection.workspaceId !== workspaceId) {
    currentSelection = { workspaceId, ...readSelection(storageKey) };
    setLastSelection(currentSelection);
  }
  const selected = currentSelection.error
    ? null
    : selectSession(sessions, requestedSessionId, currentSelection.sessionId);
  const selectedId = selected?.id ?? null;
  const hasLoadedSessions = sessions !== undefined;
  const missingSessionId =
    currentSelection.error === null &&
    hasLoadedSessions &&
    requestedSessionId != null &&
    selected === null
      ? requestedSessionId
      : null;

  const save = useCallback((): void => {
    try {
      writeSelection(storageKey, selectedId);
      savedSelection.current = { workspaceId, sessionId: selectedId };
      setFailure((current) => (current?.workspaceId === workspaceId ? null : current));
    } catch (cause) {
      setFailure({
        workspaceId,
        sessionId: selectedId,
        error: cause instanceof Error ? cause : new Error(errorMessage(cause)),
      });
    }
  }, [selectedId, storageKey, workspaceId]);
  const retryRead = useCallback((): void => {
    const selection = readSelection(storageKey);
    if (selection.error === null) {
      savedSelection.current = { workspaceId, sessionId: selection.sessionId };
    }
    setLastSelection({ workspaceId, ...selection });
  }, [storageKey, workspaceId]);
  const recovery = useSessionNavigationRecovery({
    scopeKey: `${workspaceId}:${selectedId ?? ""}`,
    readError: currentSelection.error,
    writeError:
      failure?.workspaceId === workspaceId && failure.sessionId === selectedId
        ? failure.error
        : null,
    retryRead,
    retryWrite: save,
  });

  useEffect(() => {
    if (
      currentSelection.error !== null ||
      !hasLoadedSessions ||
      missingSessionId !== null ||
      (workspaceId === savedSelection.current.workspaceId &&
        selectedId === savedSelection.current.sessionId)
    )
      return;
    setLastSelection({ workspaceId, sessionId: selectedId, error: null });
    let pending = true;
    let cancel = () => {};
    const flush = (): void => {
      if (!pending) return;
      pending = false;
      cancel();
      save();
    };
    // Defer storage I/O so tabs can switch first. Flush on exit to keep the final selection.
    cancel = scheduleTask(flush, 0);
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, [currentSelection.error, hasLoadedSessions, missingSessionId, save, selectedId, workspaceId]);

  return { selected, missingSessionId, ...recovery };
}

export type WorkspaceSessionSelection = {
  selected: WorkspaceSession | null;
  /** The requested chat ID when the loaded chats do not contain it. */
  missingSessionId: string | null;
} & SessionNavigationRecovery;

export const workspaceSessionSelectionStorageKey = (workspaceId: string): string =>
  `openducktor:workspace-sessions:selection:${workspaceId}`;

function selectSession(
  sessions: WorkspaceSession[] | undefined,
  requestedId: string | null | undefined,
  savedId: string | null,
): WorkspaceSession | null {
  const preferredId = requestedId === undefined ? savedId : requestedId;
  const selected = sessions?.find((session) => session.id === preferredId) ?? null;
  // Never show another chat in place of a missing requested chat.
  if (selected || requestedId !== undefined) return selected;
  return sessions?.[0] ?? null;
}

type SelectionRead = { sessionId: string | null; error: Error | null };

const readSelection = (storageKey: string): SelectionRead => {
  try {
    return { sessionId: globalThis.localStorage.getItem(storageKey), error: null };
  } catch (cause) {
    return {
      sessionId: null,
      error: new Error(
        `Failed to read workspace session selection "${storageKey}": ${errorMessage(cause)}`,
        { cause },
      ),
    };
  }
};

const writeSelection = (storageKey: string, sessionId: string | null): void => {
  try {
    if (sessionId === null) globalThis.localStorage.removeItem(storageKey);
    else globalThis.localStorage.setItem(storageKey, sessionId);
  } catch (cause) {
    throw new Error(
      `Failed to save workspace session selection "${storageKey}": ${errorMessage(cause)}`,
      { cause },
    );
  }
};
