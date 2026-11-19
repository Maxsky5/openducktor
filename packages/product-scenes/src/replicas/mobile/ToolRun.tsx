// A tool run of the mobile transcript, as tool-run-rows.tsx in
// apps/mobile/src/features/session/transcript/rows: consecutive tool calls under one header line.
// The header names the run, counts its calls by kind, and folds the run. The calls show under it
// along a guide line, each with the icon of its tool (tool-icon.ts and tool-status.tsx), the common
// tool name, its command or its summary, and its timing. While a call runs, three moving bars take
// the place of its icon. A run whose calls all ended and that another row follows is folded, as the
// collapseFinishedToolCalls preference folds it by default. tool-runs.ts moves the runs. The icon
// and the timing are the parts of each tool line of the app, so the question row uses them too.
import {
  ChevronRight,
  FileSearch,
  FileText,
  Folder,
  Globe,
  type LucideIcon,
  PencilLine,
  Search,
  SquareTerminal,
  Terminal,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";
import { type CallKind, type RunTitle, runCounts, runTitle } from "../transcript/tool-runs";
import "./ToolRun.css";

/** The tool types that the runtime reports, which pick the icon of a call in tool-icon.ts. */
export type MobileToolType = "read" | "bash" | "list" | "search" | "file_edit" | "web" | "generic";

/** The icon of each tool type, as `toolIcon` gives it. */
export const TOOL_ICONS = {
  read: FileText,
  bash: Terminal,
  list: Folder,
  search: Search,
  file_edit: PencilLine,
  web: Globe,
  generic: Wrench,
} satisfies Record<MobileToolType, LucideIcon>;

const TITLE_ICONS = {
  Shell: SquareTerminal,
  Files: FileSearch,
  Web: Globe,
  Tools: Wrench,
} satisfies Record<RunTitle, LucideIcon>;

/** One call of a run. */
export type MobileCall = {
  /** The tool type that the runtime reports. Codex reports the read of a file as `read`. */
  type: MobileToolType;
  /** The kind that the header counts. Codex runs its file lookups as commands. */
  kind: CallKind;
  /** The common name of the tool, such as bash. */
  name: string;
  /**
   * The command, or the summary of the call. A command of more than one line shows its first line
   * and the count of the other lines.
   */
  text: string;
  /** The text is a command, a path, or a pattern, so it shows in the font of code. */
  code: boolean;
  /** The run time of the call, such as 40ms. */
  duration: string;
  /** The clock time of the call, such as 9:46:36 AM. */
  time: string;
};

/** Three bars that pulse one after the other while a call runs, as ToolRunningBars. */
export function RunningBars(): ReactElement {
  return (
    <span className="mob-bars">
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * ToolCallIcon of tool-status.tsx: the icon of the tool in a box as high as the first text line.
 * While the line or its row has `data-running`, the bars take the place of the icon, in the running
 * color.
 */
export function CallIcon({ icon: Icon }: { icon: LucideIcon }): ReactElement {
  return (
    <span className="mob-call-icon">
      <Icon className="mob-call-glyph" data-call-glyph />
      <RunningBars />
    </span>
  );
}

/** ToolTiming of row-parts.tsx: the run time and the clock time. A running line has no run time. */
export function CallTiming({ duration, time }: { duration: string; time: string }): ReactElement {
  return (
    <span className="mob-call-timing">
      <span className="mob-call-duration">{duration}</span>
      <span>{time}</span>
    </span>
  );
}

/** The count of the other lines of a command after its first line, as `+3 lines`. */
export function moreLinesText(count: number): string {
  return `+${count} ${count === 1 ? "line" : "lines"}`;
}

function CallLine({
  id,
  call,
  running,
}: {
  id: string;
  call: MobileCall;
  running: boolean;
}): ReactElement {
  const [first = "", ...rest] = call.text.split("\n");
  const more = rest.length;
  return (
    <div
      className="mob-call"
      data-call={id}
      data-call-kind={call.kind}
      data-running={running ? "" : undefined}
    >
      <CallIcon icon={TOOL_ICONS[call.type]} />
      <span className="mob-call-text">
        <span className="mob-call-name">{call.name}</span>
        <span className={call.code ? "mob-call-code" : "mob-call-summary"}>{first}</span>
        {more > 0 && <span className="mob-call-more">{moreLinesText(more)}</span>}
      </span>
      <CallTiming duration={call.duration} time={call.time} />
    </div>
  );
}

type ToolRunProps<Id extends string> = {
  /** The calls of the sample, by id. Each call line has its id as `data-call`. */
  tools: Readonly<Record<Id, MobileCall>>;
  /** The calls of the run, in order. */
  calls: readonly Id[];
  /** The row hook of the run. */
  row: string;
  /** The run is folded: its calls all ended and another row follows it. */
  folded?: boolean;
  /** The call that still runs. */
  running?: Id | undefined;
  hidden?: boolean | undefined;
};

export function ToolRun<Id extends string>({
  tools,
  calls,
  row,
  folded = false,
  running,
  hidden,
}: ToolRunProps<Id>): ReactElement {
  const kinds = calls.map((id) => tools[id].kind);
  const title = runTitle(kinds);
  const TitleIcon = TITLE_ICONS[title];
  return (
    <div
      className="mob-run"
      data-row={row}
      data-run=""
      data-fold={folded ? "folded" : "open"}
      hidden={hidden}
    >
      <div className="mob-run-head">
        <TitleIcon className="mob-run-icon" />
        <span className="mob-run-title">{title}</span>
        <span className="mob-run-counts" data-run-counts="">
          {runCounts(kinds)}
        </span>
        <ChevronRight className="mob-run-chevron" />
      </div>
      {/* The anchor of the calls. While the run folds, the calls lie over the rows under it. */}
      <div className="mob-run-fold">
        <div className="mob-run-calls" data-run-calls="">
          {calls.map((id) => (
            <CallLine key={id} id={id} call={tools[id]} running={id === running} />
          ))}
        </div>
      </div>
    </div>
  );
}
