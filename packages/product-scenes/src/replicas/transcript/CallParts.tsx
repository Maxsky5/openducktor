// The parts of the line of a tool call: the icon of its tool in the color of its state, its
// summary, and its timing. Sources: ToolCallIcon of agent-chat-tool-status.tsx, toolIcon of
// agent-chat-tool-icon.tsx, and ToolMessageTiming of agent-chat-tool-message-timing.tsx. While a
// call runs, its line has `data-running`: moving bars take the place of the icon, and the duration
// shows when it ends.
import {
  CircleHelp,
  FileText,
  Folder,
  Globe,
  type LucideIcon,
  PencilLine,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";
import { FileTypeIcon } from "../ui/FileTypeIcon";
import type { ToolType } from "./model";
import { RunningBars } from "./RunningBars";
import "./CallParts.css";

const TOOL_ICONS = {
  read: FileText,
  bash: Terminal,
  list: Folder,
  search: Search,
  web: Globe,
  file_edit: PencilLine,
  question: CircleHelp,
  tool: Wrench,
} as const satisfies Record<ToolType, LucideIcon>;

/** The icon of a call, and the bars that take its place while the call runs. */
export function CallIcon({ tool }: { tool: ToolType }): ReactElement {
  const Icon = TOOL_ICONS[tool];
  return (
    <span className="st-call-icon" data-call-icon="">
      <Icon className="i14 st-call-glyph" />
      <RunningBars className="st-call-bars" />
    </span>
  );
}

/**
 * The summary of a call, such as a path or a task id. The path of a file shows the icon of its type
 * before it.
 */
export function CallSummary({
  summary,
  file,
  className,
}: {
  summary: string;
  file: boolean;
  className: string;
}): ReactElement {
  return (
    <span className={className} data-call-text="">
      {file && <FileTypeIcon path={summary} />}
      <span data-call-summary="">{summary}</span>
    </span>
  );
}

/** The duration of a call that ended, and the time of the call. */
export function CallTiming({
  duration,
  time,
  className,
}: {
  duration: string;
  time: string;
  className: string;
}): ReactElement {
  return (
    <span className={className}>
      <span className="st-call-duration">{duration}</span>
      <span>{time}</span>
    </span>
  );
}
