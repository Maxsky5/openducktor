import type { KanbanTaskCardView, SettingsSnapshot } from "@openducktor/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { KANBAN_TASK_CARD_VIEW_MUTATION_KEY } from "./kanban-task-card-view";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";

type KanbanTaskCardViewState = {
  taskCardView: KanbanTaskCardView | null;
  isPending: boolean;
  changeTaskCardView: (taskCardView: KanbanTaskCardView) => void;
};

export function useKanbanTaskCardView(): KanbanTaskCardViewState {
  const queryClient = useQueryClient();
  const hostClient = useHostClient();
  const settingsOptions = settingsSnapshotQueryOptions();
  const settingsQuery = useQuery(settingsOptions);
  const mutation = useMutation<SettingsSnapshot, Error, KanbanTaskCardView>({
    mutationKey: KANBAN_TASK_CARD_VIEW_MUTATION_KEY,
    scope: { id: KANBAN_TASK_CARD_VIEW_MUTATION_KEY[1] },
    mutationFn: (taskCardView) => hostClient.workspaceUpdateKanbanTaskCardView(taskCardView),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: settingsOptions.queryKey });
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData(settingsOptions.queryKey, snapshot);
    },
    onError: (error) => {
      toast.error("Failed to save task card view", { description: errorMessage(error) });
    },
  });
  const { isPending, mutate } = mutation;

  const changeTaskCardView = useCallback(
    (taskCardView: KanbanTaskCardView): void => {
      if (!settingsQuery.data || isPending) {
        return;
      }
      mutate(taskCardView);
    },
    [isPending, mutate, settingsQuery.data],
  );

  return {
    taskCardView:
      (isPending ? mutation.variables : null) ?? settingsQuery.data?.kanban.taskCardView ?? null,
    isPending,
    changeTaskCardView,
  };
}
