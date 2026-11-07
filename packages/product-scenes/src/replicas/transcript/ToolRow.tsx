// A regular tool row of agent-chat-regular-tool-summary.tsx, with the icon of agent-chat-tool-icon.tsx.
import { FileText, type LucideIcon, Search, Terminal, Wrench } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { ToolKind } from "./model";
import { RowTime } from "./RowTime";
import "./ToolRow.css";

type ToolRowProps = {
  kind: ToolKind;
  name: string;
  args?: string;
  duration: string;
  time: string;
  row?: string;
  children?: ReactNode;
};

const ICONS = {
  read: FileText,
  search: Search,
  bash: Terminal,
  tool: Wrench,
} as const satisfies Record<ToolKind, LucideIcon>;

export function ToolRow({
  kind,
  name,
  args,
  duration,
  time,
  row,
  children,
}: ToolRowProps): ReactElement {
  const Icon = ICONS[kind];
  return (
    <div className="st-tool-wrap" data-row={row}>
      <div className="st-tool" data-tool="">
        <Icon className="i14" />
        <b>{name}</b>
        {args && (
          <span className="st-tool-args" data-tool-args="">
            {args}
          </span>
        )}
        <RowTime duration={duration} time={time} />
      </div>
      {children}
    </div>
  );
}
