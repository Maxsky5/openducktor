// A workflow tool call such as set_spec, from agent-chat-workflow-tool-message.tsx.
import { Wrench } from "lucide-react";
import type { ReactElement } from "react";
import { RowTime } from "./RowTime";
import "./WorkflowCard.css";

type WorkflowCardProps = { name: string; duration: string; time: string; row?: string };

export function WorkflowCard({ name, duration, time, row }: WorkflowCardProps): ReactElement {
  return (
    <div className="st-card" data-row={row}>
      <div className="st-card-head">
        <Wrench className="i14" />
        <b>{name}</b>
        <span className="st-pill">Running</span>
        <RowTime duration={duration} time={time} />
      </div>
      <div className="st-card-io">
        <span>Input</span>
        <span className="st-output">Output</span>
      </div>
    </div>
  );
}
