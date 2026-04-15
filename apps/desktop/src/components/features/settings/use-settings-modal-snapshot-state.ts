import type { RepoConfig, SettingsSnapshot } from "@openducktor/contracts";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { pickInitialRepoPath } from "./settings-modal-normalization";

type UseSettingsModalSnapshotStateArgs = {
  open: boolean;
  activeRepo: string | null;
  loadSettingsSnapshot: () => Promise<SettingsSnapshot>;
};

type SettingsModalSnapshotState = {
  loadedSnapshot: SettingsSnapshot | null;
  snapshotDraft: SettingsSnapshot | null;
  setSnapshotDraft: Dispatch<SetStateAction<SettingsSnapshot | null>>;
  selectedRepoPath: string | null;
  setSelectedRepoPath: (next: string) => void;
  repoPaths: string[];
  selectedRepoConfig: RepoConfig | null;
  isLoadingSettings: boolean;
  settingsError: string | null;
  clearSettingsError: () => void;
};

export const useSettingsModalSnapshotState = ({
  open,
  activeRepo,
  loadSettingsSnapshot,
}: UseSettingsModalSnapshotStateArgs): SettingsModalSnapshotState => {
  const [loadedSnapshot, setLoadedSnapshot] = useState<SettingsSnapshot | null>(null);
  const [snapshotDraft, setSnapshotDraft] = useState<SettingsSnapshot | null>(null);
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const repoPaths = useMemo(() => {
    if (!snapshotDraft) {
      return [];
    }
    return Object.keys(snapshotDraft.workspaces).sort();
  }, [snapshotDraft]);

  const selectedRepoConfig = useMemo(() => {
    if (!snapshotDraft || !selectedRepoPath) {
      return null;
    }
    return snapshotDraft.workspaces[selectedRepoPath] ?? null;
  }, [selectedRepoPath, snapshotDraft]);

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
        setSelectedRepoPath(pickInitialRepoPath(snapshot, activeRepo));
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setLoadedSnapshot(null);
        setSnapshotDraft(null);
        setSelectedRepoPath(null);
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
  }, [activeRepo, loadSettingsSnapshot, open]);

  useEffect(() => {
    if (!snapshotDraft) {
      return;
    }

    if (selectedRepoPath && snapshotDraft.workspaces[selectedRepoPath]) {
      return;
    }

    const fallbackRepo = pickInitialRepoPath(snapshotDraft, activeRepo);
    if (fallbackRepo !== selectedRepoPath) {
      setSelectedRepoPath(fallbackRepo);
    }
  }, [activeRepo, selectedRepoPath, snapshotDraft]);

  return {
    loadedSnapshot,
    snapshotDraft,
    setSnapshotDraft,
    selectedRepoPath,
    setSelectedRepoPath,
    repoPaths,
    selectedRepoConfig,
    isLoadingSettings,
    settingsError,
    clearSettingsError: () => setSettingsError(null),
  };
};
