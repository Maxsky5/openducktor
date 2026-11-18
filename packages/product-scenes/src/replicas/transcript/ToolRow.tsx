// A tool call on its own line, outside a tool run: RegularToolMessage and RegularToolSummary of
// agent-chat-regular-tool-message.tsx and agent-chat-regular-tool-summary.tsx. A question tool and
// a task tool, such as create_task, show this way, with their answers or their task under the line.
// A running line has `data-running`, as a call of a run.
import type { ReactElement, ReactNode } from "react";
import { flag } from "../flag";
import { FileTypeIcon } from "../ui/FileTypeIcon";
import { CallIcon, CallTiming } from "./CallParts";
import type { ToolType } from "./model";
import "./ToolRow.css";

type ToolRowProps = {
  tool: ToolType;
  /** The name of the call: `Question` for a question tool, or the name of the tool. */
  name: string;
  summary?: string;
  /** The summary is the path of a file, and the icon of its type shows before it. */
  file?: boolean;
  duration: string;
  time: string;
  row?: string;
  /** The call still runs in the static frame. */
  running?: boolean;
  children?: ReactNode;
};

export function ToolRow({
  tool,
  name,
  summary,
  file = false,
  duration,
  time,
  row,
  running = false,
  children,
}: ToolRowProps): ReactElement {
  return (
    <div className="st-tool-wrap" data-row={row}>
      <div className="st-tool" data-tool="" data-running={flag(running)}>
        <CallIcon tool={tool} />
        <span className="st-tool-name">{name}</span>
        {summary && (
          <span className="st-tool-summary" data-call-text="">
            {file && <FileTypeIcon path={summary} />}
            <span data-call-summary="">{summary}</span>
          </span>
        )}
        <CallTiming duration={duration} time={time} className="st-tool-time" />
      </div>
      {children}
    </div>
  );
}
