import type { GitBranch } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { loadRepoBranches } from "@/state/operations";

type UseSettingsModalBranchesStateArgs = {
  open: boolean;
  selectedRepoPath: string | null;
};

export type SettingsModalBranchesState = {
  selectedRepoBranches: GitBranch[];
  isLoadingSelectedRepoBranches: boolean;
  selectedRepoBranchesError: string | null;
  retrySelectedRepoBranchesLoad: () => void;
};

export const useSettingsModalBranchesState = ({
  open,
  selectedRepoPath,
}: UseSettingsModalBranchesStateArgs): SettingsModalBranchesState => {
  const [repoBranchesByPath, setRepoBranchesByPath] = useState<Record<string, GitBranch[]>>({});
  const [isLoadingRepoBranchesByPath, setIsLoadingRepoBranchesByPath] = useState<
    Record<string, boolean>
  >({});
  const [repoBranchesErrorByPath, setRepoBranchesErrorByPath] = useState<
    Record<string, string | undefined>
  >({});

  useEffect(() => {
    if (open) {
      return;
    }
    setRepoBranchesByPath({});
    setIsLoadingRepoBranchesByPath({});
    setRepoBranchesErrorByPath({});
  }, [open]);

  const selectedRepoBranches = useMemo(
    () => (selectedRepoPath ? (repoBranchesByPath[selectedRepoPath] ?? []) : []),
    [repoBranchesByPath, selectedRepoPath],
  );
  const isLoadingSelectedRepoBranches = selectedRepoPath
    ? Boolean(isLoadingRepoBranchesByPath[selectedRepoPath])
    : false;
  const selectedRepoBranchesError = selectedRepoPath
    ? (repoBranchesErrorByPath[selectedRepoPath] ?? null)
    : null;

  useEffect(() => {
    if (!open || !selectedRepoPath) {
      return;
    }

    if (
      repoBranchesByPath[selectedRepoPath] ||
      isLoadingRepoBranchesByPath[selectedRepoPath] ||
      repoBranchesErrorByPath[selectedRepoPath]
    ) {
      return;
    }

    setIsLoadingRepoBranchesByPath((current) => ({ ...current, [selectedRepoPath]: true }));

    void loadRepoBranches(selectedRepoPath)
      .then((branches) => {
        setRepoBranchesByPath((current) => ({ ...current, [selectedRepoPath]: branches }));
        setRepoBranchesErrorByPath((current) => ({ ...current, [selectedRepoPath]: undefined }));
      })
      .catch((error: unknown) => {
        setRepoBranchesErrorByPath((current) => ({
          ...current,
          [selectedRepoPath]: errorMessage(error),
        }));
      })
      .finally(() => {
        setIsLoadingRepoBranchesByPath((current) => ({ ...current, [selectedRepoPath]: false }));
      });
  }, [
    isLoadingRepoBranchesByPath,
    open,
    repoBranchesByPath,
    repoBranchesErrorByPath,
    selectedRepoPath,
  ]);

  const retrySelectedRepoBranchesLoad = useCallback((): void => {
    if (!selectedRepoPath) {
      return;
    }

    setRepoBranchesErrorByPath((current) => ({ ...current, [selectedRepoPath]: undefined }));
    setRepoBranchesByPath((current) => {
      const { [selectedRepoPath]: _ignored, ...remaining } = current;
      return remaining;
    });
  }, [selectedRepoPath]);

  return {
    selectedRepoBranches,
    isLoadingSelectedRepoBranches,
    selectedRepoBranchesError,
    retrySelectedRepoBranchesLoad,
  };
};
