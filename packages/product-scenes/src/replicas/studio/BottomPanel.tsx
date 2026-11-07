// The bottom panel of a session page in session-panel-split.tsx: a terminal tab for each
// repository action that runs, under the main area. Each run opens a new interactive terminal,
// and the tab keeps the name of its action. The terminal body is near-black in both themes.
import { SquareTerminal } from "lucide-react";
import type { ReactElement } from "react";
import { ACTION_OUTPUT, REPO_ACTIONS } from "../../sample/actions";
import { ResizeHandle } from "../ui/ResizeHandle";
import { PanelStrip } from "./PanelStrip";
import { PanelTab } from "./PanelTab";
import "./BottomPanel.css";

type TerminalId = keyof typeof ACTION_OUTPUT;

type BottomPanelProps = {
  /** The actions whose terminals the panel shows, in tab order. */
  terminals: readonly TerminalId[];
  active: TerminalId;
};

export function BottomPanel({ terminals, active }: BottomPanelProps): ReactElement {
  return (
    <div className="bp" data-bottom-panel="">
      <ResizeHandle orientation="horizontal" className="bp-handle" />
      <div className="bp-content" data-bottom-content="">
        <PanelStrip panel="bottom">
          {terminals.map((id) => (
            <PanelTab id={id} label={REPO_ACTIONS[id].name} active={id === active} key={id}>
              <SquareTerminal />
            </PanelTab>
          ))}
        </PanelStrip>
        {terminals.map((id) => (
          <div className="bp-term" hidden={id !== active} data-term={id} key={id}>
            <div className="bp-rows">
              {ACTION_OUTPUT[id].map((line, index) => (
                <p className="bp-line" data-term-line="" key={index}>
                  {line.map((part, at) => (
                    <span className={part.tone} key={at}>
                      {part.text}
                    </span>
                  ))}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
