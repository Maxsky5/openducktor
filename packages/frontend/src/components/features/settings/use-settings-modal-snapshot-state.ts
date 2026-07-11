import type { RepoConfig, SettingsSnapshot } from "@openducktor/contracts";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { errorMessage } from "@/lib/errors";
import {
  chooseInitialSettingsWorkspaceId,
  type SettingsWorkspaceSelectionPolicy,
} from "./settings-workspace-selection";

type UseSettingsModalSnapshotStateArgs = {
  open: boolean;
  workspaceSelectionPolicy: SettingsWorkspaceSelectionPolicy;
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>;
};

type SettingsModalSnapshotState = {
  loadedSnapshot: SettingsSnapshot | null;
  snapshotDraft: SettingsSnapshot | null;
  setSnapshotDraft: Dispatch<SetStateAction<SettingsSnapshot | null>>;
  selectedWorkspaceId: string | null;
  setSelectedWorkspaceId: (next: string) => void;
  workspaceIds: string[];
  selectedRepoConfig: RepoConfig | null;
  isLoadingSettings: boolean;
  settingsError: string | null;
  clearSettingsError: () => void;
  requiredWorkspaceSelectionUnresolved: boolean;
  requiredWorkspaceRepoPath: string | null;
};

type SettingsSnapshotState = {
  loadedSnapshot: SettingsSnapshot | null;
  snapshotDraft: SettingsSnapshot | null;
  selectedWorkspaceId: string | null;
  isLoadingSettings: boolean;
  settingsError: string | null;
};

type SettingsSnapshotAction =
  | { type: "closed" }
  | { type: "loadingStarted" }
  | {
      type: "loaded";
      snapshot: SettingsSnapshot;
      workspaceSelectionPolicy: SettingsWorkspaceSelectionPolicy;
    }
  | { type: "loadFailed"; error: string }
  | { type: "loadingFinished" }
  | { type: "draftChanged"; update: SetStateAction<SettingsSnapshot | null> }
  | { type: "workspaceSelected"; workspaceId: string | null }
  | { type: "errorCleared" };

const initialSettingsSnapshotState: SettingsSnapshotState = {
  loadedSnapshot: null,
  snapshotDraft: null,
  selectedWorkspaceId: null,
  isLoadingSettings: false,
  settingsError: null,
};

const settingsSnapshotReducer = (
  state: SettingsSnapshotState,
  action: SettingsSnapshotAction,
): SettingsSnapshotState => {
  switch (action.type) {
    case "closed":
      return initialSettingsSnapshotState;
    case "loadingStarted":
      return { ...state, isLoadingSettings: true, settingsError: null };
    case "loaded":
      return {
        ...state,
        loadedSnapshot: action.snapshot,
        snapshotDraft: action.snapshot,
        selectedWorkspaceId: chooseInitialSettingsWorkspaceId(
          action.snapshot,
          action.workspaceSelectionPolicy,
        ),
      };
    case "loadFailed":
      return {
        ...state,
        loadedSnapshot: null,
        snapshotDraft: null,
        selectedWorkspaceId: null,
        settingsError: action.error,
      };
    case "loadingFinished":
      return { ...state, isLoadingSettings: false };
    case "draftChanged": {
      const snapshotDraft =
        typeof action.update === "function" ? action.update(state.snapshotDraft) : action.update;
      return { ...state, snapshotDraft };
    }
    case "workspaceSelected":
      return { ...state, selectedWorkspaceId: action.workspaceId };
    case "errorCleared":
      return { ...state, settingsError: null };
  }
};

export const useSettingsModalSnapshotState = ({
  open,
  workspaceSelectionPolicy,
  loadSettingsSnapshot,
}: UseSettingsModalSnapshotStateArgs): SettingsModalSnapshotState => {
  const [state, dispatch] = useReducer(settingsSnapshotReducer, initialSettingsSnapshotState);
  const { loadedSnapshot, snapshotDraft, selectedWorkspaceId, isLoadingSettings, settingsError } =
    state;
  const setSnapshotDraft = useCallback<Dispatch<SetStateAction<SettingsSnapshot | null>>>(
    (update) => dispatch({ type: "draftChanged", update }),
    [],
  );
  const setSelectedWorkspaceId = useCallback((next: string): void => {
    dispatch({ type: "workspaceSelected", workspaceId: next });
  }, []);
  const clearSettingsError = useCallback((): void => {
    dispatch({ type: "errorCleared" });
  }, []);

  const workspaceIds = useMemo(() => {
    if (!snapshotDraft) {
      return [];
    }
    return Object.keys(snapshotDraft.workspaces).sort();
  }, [snapshotDraft]);

  const selectedRepoConfig = useMemo(() => {
    if (!snapshotDraft || !selectedWorkspaceId) {
      return null;
    }
    return snapshotDraft.workspaces[selectedWorkspaceId] ?? null;
  }, [selectedWorkspaceId, snapshotDraft]);

  useEffect(() => {
    if (!open) {
      dispatch({ type: "closed" });
      return;
    }

    let cancelled = false;
    dispatch({ type: "loadingStarted" });

    void loadSettingsSnapshot()
      .then((snapshot) => {
        if (cancelled) {
          return;
        }

        dispatch({ type: "loaded", snapshot, workspaceSelectionPolicy });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        dispatch({ type: "loadFailed", error: errorMessage(error) });
      })
      .finally(() => {
        if (!cancelled) {
          dispatch({ type: "loadingFinished" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadSettingsSnapshot, open, workspaceSelectionPolicy]);

  if (
    snapshotDraft &&
    (!selectedWorkspaceId || snapshotDraft.workspaces[selectedWorkspaceId] === undefined)
  ) {
    const fallbackWorkspaceId = chooseInitialSettingsWorkspaceId(
      snapshotDraft,
      workspaceSelectionPolicy,
    );
    if (fallbackWorkspaceId !== selectedWorkspaceId) {
      dispatch({ type: "workspaceSelected", workspaceId: fallbackWorkspaceId });
    }
  }

  return {
    loadedSnapshot,
    snapshotDraft,
    setSnapshotDraft,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    workspaceIds,
    selectedRepoConfig,
    isLoadingSettings,
    settingsError,
    clearSettingsError,
    requiredWorkspaceSelectionUnresolved:
      workspaceSelectionPolicy.kind === "required" &&
      snapshotDraft !== null &&
      selectedWorkspaceId === null,
    requiredWorkspaceRepoPath:
      workspaceSelectionPolicy.kind === "required" ? workspaceSelectionPolicy.repoPath : null,
  };
};
