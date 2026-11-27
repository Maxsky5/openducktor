// The stop confirmation of process-stop-popover.tsx: a popover beside the Stop button of a
// command, with the command, the facts that identify what stops, and the destructive Stop
// button. It joins the surface of the list. A command of one process names its PID.
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { type ProcessCommand, PROCESSES_LABELS, stopFacts } from "./model";
import "./StopConfirm.css";

export function StopConfirm({ command }: { command: ProcessCommand }): ReactElement {
  return (
    <div className="pc" hidden data-stop-confirm="">
      <div className="pc-text">
        <p className="pc-title">
          {PROCESSES_LABELS.stop} <span className="pc-command">{command.command}</span>?
        </p>
        <p className="pc-facts">
          {stopFacts(command).map((fact, index) => (
            <span key={fact.text}>
              {index > 0 ? " · " : null}
              <span className={fact.code ? "pc-code" : undefined}>{fact.text}</span>
            </span>
          ))}
        </p>
      </div>
      <Button variant="destructive" size="sm" className="pc-button" data-stop-confirm-button="">
        {PROCESSES_LABELS.stop}
      </Button>
    </div>
  );
}
