// The transcript rows of a mobile session. A tool call is one compact line with the tool name as
// the runtime names it, its summary, and its timing. An assistant message shows its paragraphs,
// and a user message is a bubble on the right. Sources: tool-call-row.tsx, row-parts.tsx,
// tool-icon.ts, assistant-message-row.tsx, and user-message-row.tsx in
// apps/mobile/src/features/session/transcript/rows. The rows keep the hooks of
// replicas/transcript/rows.ts, so its steps show, run, and stream them.
import {
  FileText,
  Folder,
  LoaderCircle,
  type LucideIcon,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import type { ReactElement } from "react";
import { Paragraph } from "../ui/InlineCode";
import "./TranscriptRows.css";

/** The tool types of tool-icon.ts that the scenes show. */
export type MobileToolType = "read" | "bash" | "list" | "search" | "tool";

const TOOL_ICONS = {
  read: FileText,
  bash: Terminal,
  list: Folder,
  search: Search,
  tool: Wrench,
} satisfies Record<MobileToolType, LucideIcon>;

type ToolLineProps = {
  type: MobileToolType;
  /** The tool name as the runtime reports it, such as bash. */
  name: string;
  summary: string;
  duration: string;
  /** The clock time of the call, such as 9:48:51 AM. */
  time: string;
  row?: string;
  hidden?: boolean | undefined;
};

/** A tool call. While it runs, `data-running` on the line shows the spinner and hides the run time. */
export function ToolLine({
  type,
  name,
  summary,
  duration,
  time,
  row,
  hidden,
}: ToolLineProps): ReactElement {
  const Icon = TOOL_ICONS[type];
  return (
    <div className="mob-tool-row" hidden={hidden} data-row={row}>
      <div className="mob-tool" data-tool="">
        <Icon className="mob-tool-icon" />
        <span className="mob-tool-name">{name}</span>
        <span className="mob-tool-summary">{summary}</span>
        <span className="mob-tool-timing">
          <LoaderCircle className="mob-tool-spinner spin" />
          <span className="mob-tool-duration">{duration}</span>
          <span>{time}</span>
        </span>
      </div>
    </div>
  );
}

/** A tool call as the samples keep it: the props of ToolLine without the hooks. */
export type MobileTool = Omit<ToolLineProps, "row" | "hidden">;

/** The tool call `id` of `tools`. Its row hook is `id`. */
export function ToolRow<Id extends string>({
  tools,
  id,
  hidden,
}: {
  tools: Readonly<Record<Id, MobileTool>>;
  id: Id;
  hidden?: boolean;
}): ReactElement {
  return <ToolLine {...tools[id]} row={id} hidden={hidden} />;
}

/**
 * An assistant message. `paragraphs` take inline code in backticks, as the compact Markdown of the
 * app renders it.
 */
export function AgentMessage({
  paragraphs,
  row,
  hidden,
}: {
  paragraphs: readonly string[];
  row?: string;
  hidden?: boolean | undefined;
}): ReactElement {
  return (
    <div className="mob-agent" hidden={hidden} data-row={row}>
      <div className="mob-agent-text" data-text="">
        {paragraphs.map((paragraph) => (
          <Paragraph key={paragraph} text={paragraph} />
        ))}
      </div>
    </div>
  );
}

/** A message of the user that the agent has read. */
export function UserBubble({
  text,
  row,
  hidden,
}: {
  text: string;
  row?: string;
  hidden?: boolean | undefined;
}): ReactElement {
  return (
    <div className="mob-user" hidden={hidden} data-row={row}>
      <p className="mob-user-bubble">{text}</p>
    </div>
  );
}
