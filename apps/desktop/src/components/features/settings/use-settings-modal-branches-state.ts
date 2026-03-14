import type { GitBranch } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { repoBranchesQueryOptions } from "@/state/queries/git";

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
  const queryClient = useQueryClient();
  const {
    data: selectedRepoBranches = [],
    error,
    isLoading,
    refetch,
  } = useQuery({
    ...(selectedRepoPath
      ? repoBranchesQueryOptions(selectedRepoPath)
      : repoBranchesQueryOptions("")),
    enabled: open && Boolean(selectedRepoPath),
  });

  const retrySelectedRepoBranchesLoad = (): void => {
    if (!selectedRepoPath) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: repoBranchesQueryOptions(selectedRepoPath).queryKey,
    });
    void refetch();
  };

  return {
    selectedRepoBranches: open && selectedRepoPath ? selectedRepoBranches : [],
    isLoadingSelectedRepoBranches: open && selectedRepoPath ? isLoading : false,
    selectedRepoBranchesError:
      open && selectedRepoPath && error instanceof Error ? error.message : null,
    retrySelectedRepoBranchesLoad,
  };
};
