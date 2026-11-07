// The opening view: the Kanban board and the session sidebar of all workspaces. The markup holds
// the first frame, because this view shows when the page opens.
import type { ReactElement } from "react";
import { designWidthStyle } from "../../frame/design-width";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Stock } from "../../frame/Stock";
import { Board } from "../../replicas/board/Board";
import { BoardHead } from "../../replicas/board/BoardHead";
import { CardActions } from "../../replicas/board/CardActions";
import { PrBadge } from "../../replicas/board/PrBadge";
import { TaskCard } from "../../replicas/board/TaskCard";
import { AppWindow } from "../../replicas/shell/AppWindow";
import type { NavGroupId } from "../../replicas/shell/nav";
import { Pointer } from "../../replicas/shell/Pointer";
import { SessionPreview } from "../../replicas/shell/SessionPreview";
import { Toast } from "../../replicas/shell/Toast";
import { ToastStack } from "../../replicas/shell/ToastStack";
import { BOARD, CARD_ACTIONS, HERO_NAV, type HeroTemplate, PREVIEW, TOASTS } from "./sample";
import "./view.css";

/** The options of the hero scene. The options after `version` fit the view to the app tour. */
export type HeroOptions = {
  /**
   * The version of the app under its name in the sidebar, such as the latest release. With null,
   * the sidebar shows no version, as the app does when it knows none.
   */
  version: string | null;
  /** The design width of the window. A wider design shows more of the board at a smaller scale. */
  designWidth?: number;
  /** The board scrolls only to places where no lane is cut. */
  wholeLanes?: boolean;
  /** The sidebar groups that the view leaves out, such as Recent in a short window. */
  omitted?: readonly NavGroupId[];
};

function HeroStock(): ReactElement {
  return (
    <>
      {Object.entries(CARD_ACTIONS).map(([name, actions]) => (
        <Stock name={name} key={name}>
          <CardActions {...actions} />
        </Stock>
      ))}
      <Stock name={"merged" satisfies HeroTemplate}>
        <PrBadge number={41} merged />
      </Stock>
      <Stock name={"new-task" satisfies HeroTemplate}>
        <TaskCard name="pin" task="w1j5" action="Start Spec" />
      </Stock>
      <Stock name={"preview" satisfies HeroTemplate}>
        <SessionPreview {...PREVIEW} />
      </Stock>
      {Object.entries(TOASTS).map(([name, toast]) => (
        <Stock name={name} key={name}>
          <Toast {...toast} />
        </Stock>
      ))}
    </>
  );
}

export function HeroView({
  options: { version, designWidth, wholeLanes = false, omitted = [] },
  ...frame
}: SceneViewProps & { options: HeroOptions }): ReactElement {
  return (
    <SceneFrame
      {...frame}
      name="hero"
      stageClass="wrap-wide"
      alt="The OpenDucktor Kanban board and the session sidebar of all workspaces. Agents plan, build, and review tasks in separate lanes, and each session moves between Running and Recent in the sidebar. A merged pull request closes a task. Then a Builder asks a question, and its session moves to Needs you. The visitor points at the session in the sidebar, and its preview opens with the question. The visitor answers in the preview, and the session goes back to Running."
      stock={<HeroStock />}
    >
      <AppWindow
        chrome={{ sidebar: "full", nav: { ...HERO_NAV, omitted }, kanban: true, version }}
        keys={frame.keys}
        className="hero-window"
        style={designWidthStyle(designWidth)}
        overlay={<Pointer />}
      >
        <BoardHead />
        <Board board={BOARD} wholeLanes={wholeLanes} />
        <ToastStack />
      </AppWindow>
    </SceneFrame>
  );
}
