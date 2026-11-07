// The Kanban board with the Autopilot rules on. The markup holds the last frame.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Stock } from "../../frame/Stock";
import { Badge } from "../../replicas/board/Badge";
import { Board } from "../../replicas/board/Board";
import { BoardHead } from "../../replicas/board/BoardHead";
import { CardActions } from "../../replicas/board/CardActions";
import { PrBadge } from "../../replicas/board/PrBadge";
import { Replica } from "../../replicas/Replica";
import { Pointer } from "../../replicas/shell/Pointer";
import { Toast } from "../../replicas/shell/Toast";
import { ToastStack } from "../../replicas/shell/ToastStack";
import { type AutopilotTemplate, BOARD, CARD_ACTIONS, TOASTS } from "./sample";
import "./view.css";

function AutopilotStock(): ReactElement {
  return (
    <>
      {Object.entries(CARD_ACTIONS).map(([name, actions]) => (
        <Stock name={name} key={name}>
          <CardActions {...actions} />
        </Stock>
      ))}
      <Stock name={"rejected" satisfies AutopilotTemplate}>
        <Badge tone="rejected" data-qa-badge>
          QA Rejected
        </Badge>
      </Stock>
      <Stock name={"pr" satisfies AutopilotTemplate}>
        <PrBadge number={58} />
      </Stock>
      {Object.entries(TOASTS).map(([name, toast]) => (
        <Stock name={name} key={name}>
          <Toast {...toast} />
        </Stock>
      ))}
    </>
  );
}

export function AutopilotView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="autopilot"
      alt="The Kanban board with the Autopilot rules on. The spec of a task is ready, and Autopilot starts the Planner. Then it starts the Builder and QA. A notification shows each new agent session. QA rejects the first build, and Autopilot resumes the Builder with the QA report. QA approves the fix, and the Builder opens pull request 58. The task waits in Human Review for your approval. The Builder of another task stops to ask you a question."
      stock={<AutopilotStock />}
    >
      <Replica className="auto-stage">
        <div className="auto-board">
          <BoardHead />
          <Board board={BOARD} />
          <ToastStack />
        </div>
        <Pointer />
      </Replica>
    </SceneFrame>
  );
}
