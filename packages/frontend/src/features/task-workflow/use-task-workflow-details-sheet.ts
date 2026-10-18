import type { TaskCard } from "@openducktor/contracts";
import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router";
import type { TaskDetailsSheetControllerHandle } from "@/components/features/task-details/task-details-sheet-controller";
import {
  SESSIONS_PATH,
  SESSIONS_QUERY_KEYS,
} from "@/features/session-navigation/session-navigation-target";
import type { ActiveWorkspace } from "@/types/state-slices";

export type TaskWorkflowTaskDetailsSheetModel = {
  ref: RefObject<TaskDetailsSheetControllerHandle | null>;
  activeWorkspace: ActiveWorkspace | null;
  allTasks: TaskCard[];
};

type TaskWorkflowDetailsSheet = {
  onOpenTaskDetails: (taskId: string) => void;
  taskDetailsSheet: TaskWorkflowTaskDetailsSheetModel;
};

/**
 * The task details sheet that the task workflow actions open on any page. The sheet belongs to
 * the page that opened it, so it closes when an action leaves the page.
 */
export function useTaskWorkflowDetailsSheet({
  activeWorkspace,
  tasks,
}: {
  activeWorkspace: ActiveWorkspace | null;
  tasks: TaskCard[];
}): TaskWorkflowDetailsSheet {
  const ref = useRef<TaskDetailsSheetControllerHandle | null>(null);
  const onOpenTaskDetails = useCallback((taskId: string): void => {
    ref.current?.openTask(taskId);
  }, []);
  const page = usePageKey();
  const pageRef = useRef(page);
  // A layout effect runs before the effects of the new page, so that page can open the sheet.
  useLayoutEffect(() => {
    if (pageRef.current === page) return;
    pageRef.current = page;
    ref.current?.close();
  }, [page]);
  const taskDetailsSheet = useMemo(
    () => ({ ref, activeWorkspace, allTasks: tasks }),
    [activeWorkspace, tasks],
  );
  return { onOpenTaskDetails, taskDetailsSheet };
}

/**
 * The page that the location shows. `/sessions` shows Agent Studio or a workspace chat by its
 * session kind. Other query keys only select content in the page, such as the Kanban `task` key.
 */
function usePageKey(): string {
  const { pathname, search } = useLocation();
  if (pathname !== SESSIONS_PATH) return pathname;
  return `${pathname}?${new URLSearchParams(search).get(SESSIONS_QUERY_KEYS.kind) ?? ""}`;
}
