import type { RepoConfig, SettingsSnapshot } from "@openducktor/contracts";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { pickInitialWorkspaceId } from "./settings-modal-normalization";

type UseSettingsModalSnapshotStateArgs = {
  open: boolean;
  workspaceRepoPath: string | null;
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
};

export const useSettingsModalSnapshotState = ({
  open,
  workspaceRepoPath,
  loadSettingsSnapshot,
}: UseSettingsModalSnapshotStateArgs): SettingsModalSnapshotState => {
  const [loadedSnapshot, setLoadedSnapshot] = useState<SettingsSnapshot | null>(null);
  const [snapshotDraft, setSnapshotDraft] = useState<SettingsSnapshot | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

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
      setSettingsError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingSettings(true);
    setSettingsError(null);

    void loadSettingsSnapshot()
      .then((snapshot) => {
        if (cancelled) {
          return;
        }

        setLoadedSnapshot(snapshot);
        setSnapshotDraft(snapshot);
        setSelectedWorkspaceId(pickInitialWorkspaceId(snapshot, workspaceRepoPath));
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setLoadedSnapshot(null);
        setSnapshotDraft(null);
        setSelectedWorkspaceId(null);
        setSettingsError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSettings(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceRepoPath, loadSettingsSnapshot, open]);

  useEffect(() => {
    if (!snapshotDraft) {
      return;
    }

    if (selectedWorkspaceId && snapshotDraft.workspaces[selectedWorkspaceId]) {
      return;
    }

    const fallbackWorkspaceId = pickInitialWorkspaceId(snapshotDraft, workspaceRepoPath);
    if (fallbackWorkspaceId !== selectedWorkspaceId) {
      setSelectedWorkspaceId(fallbackWorkspaceId);
    }
  }, [workspaceRepoPath, selectedWorkspaceId, snapshotDraft]);

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
    clearSettingsError: () => setSettingsError(null),
  };
};
