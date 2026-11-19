// A tool run of agent-chat-tool-run.tsx: the consecutive tool calls of a turn under one header.
// The header shows the kind of the run, the calls of each kind, and the chevron that folds it. The
// calls show along a guide line, each with the icon of its tool, its name, its command or its
// summary, and its timing. A long run shows its latest five calls under the bar of its earlier
// calls. A run folds when its calls all ended and another row follows it. runs.ts moves the runs.
import {
  ChevronDown,
  ChevronsUp,
  FileSearch,
  Globe,
  type LucideIcon,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import { CallIcon, CallSummary, CallTiming } from "./CallParts";
import type { CallData } from "./model";
import {
  callKind,
  earlierCallCount,
  type RunTitle,
  runCounts,
  runTitle,
  showEarlierLabel,
} from "./tool-runs";
import "./ToolRun.css";

const TITLE_ICONS = {
  Shell: SquareTerminal,
  Files: FileSearch,
  Web: Globe,
  Tools: Wrench,
} as const satisfies Record<RunTitle, LucideIcon>;

type ToolRunProps = {
  calls: readonly CallData[];
  /** The calls all ended and another row follows the run, so it shows only its header. */
  folded?: boolean;
  /** The ids of the calls that still run in the static frame. */
  running?: readonly string[];
  /** The run comes after the static frame, so its calls are hidden. */
  hidden?: boolean;
};

/** One call of the run. The first line of a command shows in the font of code. */
function RunCall({
  call,
  running,
  earlier,
  hidden,
}: {
  call: CallData;
  running: boolean;
  earlier: boolean;
  hidden: boolean;
}): ReactElement {
  const { add = 0, del = 0 } = call;
  return (
    <li
      className="st-call"
      hidden={hidden}
      data-row={call.id}
      data-kind={callKind(call)}
      data-running={flag(running)}
      data-earlier={flag(earlier)}
    >
      <div className="st-call-row">
        <CallIcon tool={call.tool} />
        <span className="st-call-main">
          <span className="st-call-name">{call.name}</span>
          {call.command !== undefined ? (
            <span className="st-call-text" data-call-text="">
              <code>{call.command}</code>
            </span>
          ) : (
            call.summary && (
              <CallSummary
                summary={call.summary}
                file={call.file === true}
                className="st-call-summary"
              />
            )
          )}
        </span>
        {(add > 0 || del > 0) && (
          <span className="st-call-changes" data-call-text="">
            {add > 0 && <span className="st-call-add">+{add}</span>}
            {del > 0 && <span className="st-call-del">-{del}</span>}
          </span>
        )}
        <CallTiming duration={call.duration} time={call.time} className="st-call-time" />
      </div>
    </li>
  );
}

export function ToolRun({
  calls,
  folded = false,
  running = [],
  hidden = false,
}: ToolRunProps): ReactElement {
  const kinds = calls.map(callKind);
  const title = runTitle(kinds);
  const earlier = earlierCallCount(calls.length);
  return (
    <div
      className="st-run"
      hidden={hidden}
      data-tool-run=""
      data-title={title}
      data-folded={flag(folded)}
      data-long={flag(earlier > 0)}
    >
      <div className="st-run-head">
        {Object.entries(TITLE_ICONS).map(([name, Icon]) => (
          <Icon key={name} className="i14 st-run-icon" data-title-icon={name} />
        ))}
        <span className="st-run-title" data-run-title="">
          {title}
        </span>
        <span className="st-run-counts" data-run-counts="">
          {runCounts(kinds)}
        </span>
        <ChevronDown className="i14 st-run-chevron" />
      </div>
      <div className="st-run-body" hidden={folded} data-run-body="">
        <div className="st-run-calls">
          <div className="st-run-bar" hidden={earlier === 0} data-run-bar="">
            <span className="st-run-bar-button">
              <ChevronsUp className="i14" />
              <span data-run-earlier="">{showEarlierLabel(earlier)}</span>
            </span>
          </div>
          <div className="st-run-window">
            <ul className="st-run-list" data-run-list="">
              {calls.map((call, index) => (
                <RunCall
                  key={call.id}
                  call={call}
                  running={running.includes(call.id)}
                  earlier={index < earlier}
                  hidden={hidden}
                />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
