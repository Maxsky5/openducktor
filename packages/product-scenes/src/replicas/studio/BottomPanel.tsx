// The bottom panel of a session page in session-panel-split.tsx: a terminal tab for each
// repository action that runs, under the main area. Each run opens a new interactive terminal,
// and the tab keeps the name of its action. The terminal body is near-black in both themes.
import { SquareTerminal } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { ACTION_OUTPUT, REPO_ACTIONS, type TerminalLine } from "../../sample/actions";
import { classes } from "../classes";
import { ResizeHandle } from "../ui/ResizeHandle";
import { PanelStrip } from "./PanelStrip";
import { PanelTab } from "./PanelTab";
import "./BottomPanel.css";

type TerminalId = keyof typeof ACTION_OUTPUT;

/** The output lines of a terminal, in the colors of their parts. */
export function TerminalLines({ lines }: { lines: readonly TerminalLine[] }): ReactNode {
  return lines.map((line, index) => (
    // The lines of a terminal never change order, so the index is a stable key.
    <p className="bp-line" data-term-line="" key={index}>
      {line.map((part, at) => (
        <span className={part.tone} key={at}>
          {part.text}
        </span>
      ))}
    </p>
  ));
}

type BottomPanelFrameProps = {
  className?: string;
  /** The tabs of the strip. */
  tabs: ReactNode;
  /** The controls after the New tab button, such as the restart button of a terminal. */
  end?: ReactNode;
  /** The views of the tabs. */
  children: ReactNode;
};

/** The separator and the bottom panel with its tab strip. The children hold the tab views. */
export function BottomPanelFrame({
  className,
  tabs,
  end,
  children,
}: BottomPanelFrameProps): ReactElement {
  return (
    <>
      {/* The separator sits between the main area and the panel, as in session-panel-split.tsx,
          so the panel does not clip its grip. It shows with the panel. */}
      <ResizeHandle orientation="horizontal" data-bottom-handle="" />
      <div className={classes("bp", className)} data-bottom-panel="">
        <div className="bp-content" data-bottom-content="">
          <PanelStrip panel="bottom" end={end}>
            {tabs}
          </PanelStrip>
          {children}
        </div>
      </div>
    </>
  );
}

type BottomPanelProps = {
  /** The actions whose terminals the panel shows, in tab order. */
  terminals: readonly TerminalId[];
  active: TerminalId;
};

export function BottomPanel({ terminals, active }: BottomPanelProps): ReactElement {
  return (
    <BottomPanelFrame
      tabs={terminals.map((id) => (
        <PanelTab id={id} label={REPO_ACTIONS[id].name} active={id === active} key={id}>
          <SquareTerminal />
        </PanelTab>
      ))}
    >
      {terminals.map((id) => (
        <div className="bp-term" hidden={id !== active} data-term={id} data-tab-view={id} key={id}>
          <div className="bp-rows">
            <TerminalLines lines={ACTION_OUTPUT[id]} />
          </div>
        </div>
      ))}
    </BottomPanelFrame>
  );
}
