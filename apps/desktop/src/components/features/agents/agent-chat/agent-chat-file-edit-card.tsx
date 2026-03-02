import { ChevronDown, ChevronRight, FilePlus, FileText, FileX } from "lucide-react";
import { memo, type ReactElement, useState } from "react";
import {
  PierreDiffPreloader,
  PierreDiffViewer,
} from "@/components/features/agents/pierre-diff-viewer";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { FileEditData } from "./agent-chat-message-card-model";

// ─── Config ────────────────────────────────────────────────────────────

type AgentChatFileEditCardProps = {
  data: FileEditData;
};

const STATUS_CONFIG: Record<string, { icon: typeof FileText; color: string; badge: string }> = {
  modified: { icon: FileText, color: "text-blue-400", badge: "M" },
  added: { icon: FilePlus, color: "text-green-400", badge: "A" },
  deleted: { icon: FileX, color: "text-red-400", badge: "D" },
};

function inferStatus(data: FileEditData): string {
  if (data.deletions === 0 && data.additions > 0) return "added";
  if (data.additions === 0 && data.deletions > 0) return "deleted";
  return "modified";
}

const DEFAULT_CONFIG = {
  icon: FileText,
  color: "text-blue-400",
  badge: "M",
} as const;

// ─── Component ─────────────────────────────────────────────────────────

export const AgentChatFileEditCard = memo(function AgentChatFileEditCard({
  data,
}: AgentChatFileEditCardProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState(false);

  const status = inferStatus(data);
  const config = STATUS_CONFIG[status] ?? DEFAULT_CONFIG;
  const Icon = config.icon;

  const fileName = data.filePath.split("/").pop() ?? data.filePath;
  const dirName = data.filePath.includes("/")
    ? data.filePath.slice(0, data.filePath.lastIndexOf("/"))
    : "";

  const hasDiff = Boolean(data.diff);

  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-border bg-card text-xs">
      {data.diff ? <PierreDiffPreloader patch={data.diff} /> : null}

      {/* Header */}
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left cursor-pointer",
          isExpanded && "border-b border-border",
        )}
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        {hasDiff ? (
          isExpanded ? (
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          )
        ) : null}
        <Icon className={cn("size-3.5 shrink-0", config.color)} />
        <span className="flex-1 truncate font-mono text-[11px]">
          {dirName ? <span className="text-muted-foreground">{dirName}/</span> : null}
          <span className="font-semibold">{fileName}</span>
        </span>
        <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-mono", config.color)}>
          {config.badge}
        </Badge>
        {data.additions > 0 || data.deletions > 0 ? (
          <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums">
            {data.additions > 0 ? <span className="text-green-400">+{data.additions}</span> : null}
            {data.deletions > 0 ? <span className="text-red-400">-{data.deletions}</span> : null}
          </span>
        ) : null}
      </button>

      {/* Diff — uses shared PierreDiffViewer, split view for inline chat */}
      {isExpanded && data.diff ? (
        <div className="overflow-auto max-h-[60vh]">
          <PierreDiffViewer patch={data.diff} diffStyle="split" />
        </div>
      ) : null}
    </div>
  );
});
