import type { KanbanTaskCardView, SettingsSnapshot } from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { host } from "@/state/operations/host";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";

type MutationContext = {
  previousSnapshot: SettingsSnapshot;
};

type KanbanTaskCardViewState = {
  taskCardView: KanbanTaskCardView | null;
  isPending: boolean;
  changeTaskCardView: (taskCardView: KanbanTaskCardView) => void;
};

export function useKanbanTaskCardView(): KanbanTaskCardViewState {
  const queryClient = useQueryClient();
  const settingsOptions = settingsSnapshotQueryOptions();
  const settingsQuery = useQuery(settingsOptions);
  const mutation = useMutation<SettingsSnapshot, Error, KanbanTaskCardView, MutationContext>({
    mutationKey: ["settings", "kanban-task-card-view"],
    scope: { id: "kanban-task-card-view" },
    mutationFn: (taskCardView) => host.workspaceUpdateKanbanTaskCardView(taskCardView),
    onMutate: async (taskCardView) => {
      await queryClient.cancelQueries({ queryKey: settingsOptions.queryKey });
      const previousSnapshot = queryClient.getQueryData<SettingsSnapshot>(settingsOptions.queryKey);
      if (!previousSnapshot) {
        throw new Error("Cannot update the task card view before Kanban settings are available.");
      }
      queryClient.setQueryData<SettingsSnapshot>(settingsOptions.queryKey, {
        ...previousSnapshot,
        kanban: { ...previousSnapshot.kanban, taskCardView },
      });
      return { previousSnapshot };
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData(settingsOptions.queryKey, snapshot);
    },
    onError: (error, _taskCardView, context) => {
      if (context) {
        queryClient.setQueryData(settingsOptions.queryKey, context.previousSnapshot);
      }
      toast.error("Failed to save task card view", { description: errorMessage(error) });
    },
  });
  const { isPending, mutate } = mutation;

  const changeTaskCardView = useCallback(
    (taskCardView: KanbanTaskCardView): void => {
      if (!settingsQuery.data || settingsQuery.isError || isPending) {
        return;
      }
      mutate(taskCardView);
    },
    [isPending, mutate, settingsQuery.data, settingsQuery.isError],
  );

  return {
    taskCardView: settingsQuery.data?.kanban.taskCardView ?? null,
    isPending,
    changeTaskCardView,
  };
}
