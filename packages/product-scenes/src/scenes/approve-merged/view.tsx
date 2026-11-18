// A task whose branch is already merged: the Kanban board and the Close task confirmation.
// Sources: kanban-task-card.tsx and task-workflow-action-group.tsx in
// packages/frontend/src/components/features/kanban, task-close-confirm-dialog.tsx and
// task-close-confirm-content.tsx in packages/frontend/src/components/features/task-details, and
// the merge status, the card actions, and the close of packages/frontend-core/src/tasks. The
// markup holds the first frame: the card shows Merged and Close Task. The card in Done and the
// toasts are templates.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Stock } from "../../frame/Stock";
import { Board } from "../../replicas/board/Board";
import { BoardHead } from "../../replicas/board/BoardHead";
import { TaskCard } from "../../replicas/board/TaskCard";
import { Replica } from "../../replicas/Replica";
import { Pointer } from "../../replicas/shell/Pointer";
import { SuccessToast, Toast } from "../../replicas/shell/Toast";
import { ToastStack } from "../../replicas/shell/ToastStack";
import { CloseTaskDialog } from "../../replicas/tasks/CloseTaskDialog";
import { Tooltip } from "../../replicas/ui/Tooltip";
import {
  type ApproveMergedTemplate,
  BOARD,
  CLOSED_FEEDBACK,
  CLOSED_NOTIFICATION,
  DONE_CARD,
  MERGED_TIP,
  TARGET,
  TASK_IDENTITY,
} from "./sample";
import "./view.css";

function ApproveMergedStock(): ReactElement {
  return (
    <>
      <Stock name={"done-card" satisfies ApproveMergedTemplate}>
        <TaskCard {...DONE_CARD} />
      </Stock>
      <Stock name={"toast-feedback" satisfies ApproveMergedTemplate}>
        <SuccessToast {...CLOSED_FEEDBACK} />
      </Stock>
      <Stock name={"toast-closed" satisfies ApproveMergedTemplate}>
        <Toast {...CLOSED_NOTIFICATION} />
      </Stock>
    </>
  );
}

export function ApproveMergedView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="approve-merged"
      alt={`The Kanban board. The task ${TASK_IDENTITY.title} waits in Human Review. Its branch is already merged into ${TARGET}, and the merge detection of OpenDucktor found it, so the card shows a Merged badge and the Close Task button. The pointer rests on the badge, and the tooltip shows ${MERGED_TIP}. The visitor selects Close Task. The Close task dialog loads, then shows Branch merged into ${TARGET}, Remove worktree and branch on, and what a close keeps. The visitor selects Close task. The task moves to Done, a toast says Task closed, the dialog closes, and a notification says that the task is closed.`}
      stock={<ApproveMergedStock />}
    >
      <Replica className="am-stage">
        <div className="am-window">
          <BoardHead />
          <Board board={BOARD} />
          <ToastStack />
          <CloseTaskDialog task={TASK_IDENTITY} target={TARGET} />
        </div>
        <Tooltip />
        <Pointer />
      </Replica>
    </SceneFrame>
  );
}
