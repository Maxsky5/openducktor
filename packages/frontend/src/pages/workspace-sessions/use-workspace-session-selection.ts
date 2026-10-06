import type { WorkspaceSession } from "@openducktor/contracts";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { scheduleTask } from "@/lib/scheduling";

export const workspaceSessionSelectionStorageKey = (workspaceId: string): string =>
  `openducktor:workspace-sessions:selection:${workspaceId}`;

const readSelection = (storageKey: string): string | null => {
  try {
    return globalThis.localStorage.getItem(storageKey);
  } catch (cause) {
    throw new Error(
      `Failed to read workspace session selection "${storageKey}": ${errorMessage(cause)}`,
      { cause },
    );
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

export type WorkspaceSessionSelection = {
  selected: WorkspaceSession | null;
  /** The requested chat ID when the loaded chats do not contain it. */
  missingSessionId: string | null;
};

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
    sessionId: readSelection(storageKey),
  }));
  const persistedSelection = useRef(lastSelection);
  const [persistenceError, setPersistenceError] = useState<Error | null>(null);
  let currentSelection = lastSelection;
  if (lastSelection.workspaceId !== workspaceId) {
    currentSelection = { workspaceId, sessionId: readSelection(storageKey) };
    setLastSelection(currentSelection);
    setPersistenceError(null);
  }
  const preferredId =
    requestedSessionId === undefined ? currentSelection.sessionId : requestedSessionId;
  // Only a restored selection falls back to the first chat. A requested chat that is missing
  // stays unselected, so another conversation is never shown in its place.
  const selected =
    sessions?.find((session) => session.id === preferredId) ??
    (requestedSessionId === undefined ? (sessions?.[0] ?? null) : null);
  const selectedId = selected?.id ?? null;
  const hasLoadedSessions = sessions !== undefined;
  const missingSessionId =
    hasLoadedSessions && requestedSessionId != null && selected === null
      ? requestedSessionId
      : null;

  useEffect(() => {
    if (
      !hasLoadedSessions ||
      missingSessionId !== null ||
      (workspaceId === persistedSelection.current.workspaceId &&
        selectedId === persistedSelection.current.sessionId)
    )
      return;
    setLastSelection({ workspaceId, sessionId: selectedId });
    let pending = true;
    let cancel = () => {};
    const flush = (): void => {
      if (!pending) return;
      pending = false;
      cancel();
      try {
        writeSelection(storageKey, selectedId);
        persistedSelection.current = { workspaceId, sessionId: selectedId };
      } catch (cause) {
        setPersistenceError(cause instanceof Error ? cause : new Error(errorMessage(cause)));
      }
    };
    // Keep storage I/O out of tab selection, and retain the final selection on exit.
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
  }, [hasLoadedSessions, missingSessionId, selectedId, storageKey, workspaceId]);

  if (persistenceError && lastSelection.workspaceId === workspaceId) throw persistenceError;
  return { selected, missingSessionId };
}
