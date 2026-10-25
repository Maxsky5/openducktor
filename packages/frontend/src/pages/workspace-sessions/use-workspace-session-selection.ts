import type { WorkspaceSession } from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { scheduleTask } from "@openducktor/frontend-core/lib/scheduling";
import type { ClientStorage } from "@openducktor/frontend-core/platform/client-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type SessionNavigationRecovery,
  useSessionNavigationRecovery,
} from "@openducktor/frontend-core/sessions/navigation/use-session-navigation-recovery";

export function useWorkspaceSessionSelection({
  workspaceId,
  sessions,
  requestedSessionId,
  isActive,
}: {
  workspaceId: string;
  sessions: WorkspaceSession[] | undefined;
  requestedSessionId: string | null | undefined;
  isActive: boolean;
}): WorkspaceSessionSelection {
  const { storage } = useClientConnection();
  const storageKey = workspaceSessionSelectionStorageKey(workspaceId);
  const [lastSelection, setLastSelection] = useState(() => ({
    workspaceId,
    ...readSelection(storage, storageKey),
  }));
  const savedSelection = useRef({ workspaceId, sessionId: lastSelection.sessionId });
  const wasActive = useRef(isActive);
  const [failure, setFailure] = useState<{
    workspaceId: string;
    sessionId: string | null;
    error: Error;
  } | null>(null);
  let currentSelection = lastSelection;
  if (lastSelection.workspaceId !== workspaceId) {
    currentSelection = { workspaceId, ...readSelection(storage, storageKey) };
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
      writeSelection(storage, storageKey, selectedId);
      savedSelection.current = { workspaceId, sessionId: selectedId };
      setFailure((current) => (current?.workspaceId === workspaceId ? null : current));
    } catch (cause) {
      setFailure({
        workspaceId,
        sessionId: selectedId,
        error: cause instanceof Error ? cause : new Error(errorMessage(cause)),
      });
    }
  }, [selectedId, storage, storageKey, workspaceId]);
  const retryRead = useCallback((): void => {
    const selection = readSelection(storage, storageKey);
    if (selection.error === null) {
      savedSelection.current = { workspaceId, sessionId: selection.sessionId };
    }
    setLastSelection({ workspaceId, ...selection });
  }, [storage, storageKey, workspaceId]);
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

  // The old workspace flushes before these effects run. Track this read before checking for edits.
  useEffect(() => {
    if (currentSelection.error === null && savedSelection.current.workspaceId !== workspaceId) {
      savedSelection.current = { workspaceId, sessionId: currentSelection.sessionId };
    }
  }, [currentSelection.error, currentSelection.sessionId, workspaceId]);

  useEffect(() => {
    const activeAgain = isActive && !wasActive.current;
    wasActive.current = isActive;
    if (
      !isActive ||
      currentSelection.error !== null ||
      !hasLoadedSessions ||
      missingSessionId !== null ||
      (!activeAgain &&
        workspaceId === savedSelection.current.workspaceId &&
        selectedId === savedSelection.current.sessionId)
    )
      return;
    // An equal selection keeps its state, so a view that turns active again does not render again.
    setLastSelection((current) =>
      current.workspaceId === workspaceId && current.sessionId === selectedId && !current.error
        ? current
        : { workspaceId, sessionId: selectedId, error: null },
    );
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
  }, [
    currentSelection.error,
    hasLoadedSessions,
    isActive,
    missingSessionId,
    save,
    selectedId,
    workspaceId,
  ]);

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

const readSelection = (storage: ClientStorage, storageKey: string): SelectionRead => {
  try {
    return { sessionId: storage.getItem(storageKey), error: null };
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

const writeSelection = (
  storage: ClientStorage,
  storageKey: string,
  sessionId: string | null,
): void => {
  try {
    if (sessionId === null) storage.removeItem(storageKey);
    else storage.setItem(storageKey, sessionId);
  } catch (cause) {
    throw new Error(
      `Failed to save workspace session selection "${storageKey}": ${errorMessage(cause)}`,
      { cause },
    );
  }
};
