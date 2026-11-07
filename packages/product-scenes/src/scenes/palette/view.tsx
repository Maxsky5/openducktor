// The command palette over the Kanban board. The markup holds the search results of the query, the
// frame of the middle of the scene that shows the most. The templates hold the start dialog of the
// Planner, its notification, and the changes of the board.
import type { ReactElement } from "react";
import { designWidthStyle } from "../../frame/design-width";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Stock } from "../../frame/Stock";
import { Board } from "../../replicas/board/Board";
import { BoardHead } from "../../replicas/board/BoardHead";
import { CardActions } from "../../replicas/board/CardActions";
import { Palette } from "../../replicas/palette/Palette";
import { AppWindow } from "../../replicas/shell/AppWindow";
import type { NavGroupId } from "../../replicas/shell/nav";
import { Pointer } from "../../replicas/shell/Pointer";
import { Toast } from "../../replicas/shell/Toast";
import { ToastStack } from "../../replicas/shell/ToastStack";
import { StartDialog } from "../../replicas/studio/StartDialog";
import { LANES, type LaneId } from "../../replicas/vocabulary";
import { PLANNER_SESSION } from "../../sample/studio";
import { KeyHud } from "./KeyHud";
import { CARD_ACTIONS, PALETTE_BOARD, PALETTE_NAV, type PaletteTemplate, STARTED } from "./sample";
import "./view.css";

/**
 * The options of the palette scene. The options after `version` fit the view to a short stage,
 * such as the frame of the tour of the app. The website shows the full view.
 */
export type PaletteOptions = {
  /**
   * The version of the app under its name in the sidebar, such as the latest release. With null,
   * the sidebar shows no version, as the app does when it knows none.
   */
  version: string | null;
  /** The design width of the window. A wider design shows more of the board at a smaller scale. */
  designWidth?: number;
  /** The lanes of the board. */
  lanes?: readonly LaneId[];
  /** The sidebar groups that show collapsed. */
  collapsed?: readonly NavGroupId[];
  /** The view shows its notifications. */
  toasts?: boolean;
  /** The task actions list Reset Task and Delete task. */
  destructive?: boolean;
  /** The keys of a shortcut show at the bottom right of the stage, not under the palette. */
  keysAtEnd?: boolean;
};

function PaletteStock(): ReactElement {
  return (
    <>
      {Object.entries(CARD_ACTIONS).map(([name, actions]) => (
        <Stock name={name} key={name}>
          <CardActions {...actions} />
        </Stock>
      ))}
      <Stock name={"planner-dialog" satisfies PaletteTemplate}>
        <StartDialog
          role="Planner"
          description="Start a fresh session for Planner."
          session={PLANNER_SESSION}
          background
        />
      </Stock>
      <Stock name={"toast-started" satisfies PaletteTemplate}>
        <Toast {...STARTED} />
      </Stock>
    </>
  );
}

export function PaletteView({
  options: {
    version,
    designWidth,
    lanes = LANES,
    collapsed = [],
    toasts = true,
    destructive = true,
    keysAtEnd = false,
  },
  ...frame
}: SceneViewProps & { options: PaletteOptions }): ReactElement {
  return (
    <SceneFrame
      {...frame}
      name="palette"
      alt="The command palette over the Kanban board. The visitor presses Command K and types srch. The palette finds tasks and a session in three workspaces and marks the letters that match. The visitor opens the actions of a task with Tab and starts its Planner in the background. Then the visitor opens the palette again, picks the task that waits for an answer, and answers the question of its Builder in the palette."
      stock={<PaletteStock />}
    >
      <AppWindow
        chrome={{ sidebar: "full", nav: { ...PALETTE_NAV, collapsed }, kanban: true, version }}
        keys={frame.keys}
        className="palette-window"
        style={designWidthStyle(designWidth)}
        data-modifier={frame.keys.modifier}
        overlay={
          <>
            <Palette keys={frame.keys} destructive={destructive} />
            <Pointer />
          </>
        }
      >
        <BoardHead />
        <Board board={PALETTE_BOARD} lanes={lanes} />
        <ToastStack hidden={!toasts} />
      </AppWindow>
      <KeyHud end={keysAtEnd} />
    </SceneFrame>
  );
}
