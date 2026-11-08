// The xterm screen of one terminal tab: the lines that the shell wrote, then the prompt with the
// block cursor. A typed command shows before the output, at the prompt. The screen keeps its
// newest line at the bottom when the output is longer than the screen.
import type { ReactElement } from "react";
import type { TerminalLine } from "../../sample/actions";
import { TerminalLines } from "../../replicas/studio/BottomPanel";
import { PROMPT } from "../../sample/terminal";

type TerminalScreenProps = {
  id: string;
  lines: readonly TerminalLine[];
  /** The command that the visitor types at the prompt before the output. */
  typed?: string;
};

export function TerminalScreen({ id, lines, typed }: TerminalScreenProps): ReactElement {
  return (
    <div className="bp-term tv-term" data-term={id} data-tab-view={id}>
      <div className="tv-rows">
        {typed !== undefined && (
          <p className="bp-line" data-term-line="">
            {PROMPT}
            <span data-input="">{typed}</span>
          </p>
        )}
        <TerminalLines lines={lines} />
        <p className="bp-line" data-term-line="">
          {PROMPT}
          <span className="tv-caret" data-caret="" />
        </p>
      </div>
    </div>
  );
}
