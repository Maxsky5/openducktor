import { DEFAULT_CHAT_SETTINGS } from "@openducktor/contracts";
import { ChevronDown, ChevronRight } from "lucide-react";
import { memo, type ReactElement, useState } from "react";
import {
  PierreFileViewer,
  PierrePreloadedDiffViewer,
} from "@/components/features/agents/pierre-diff-viewer";
import { PierreFilePairDiffViewer } from "@/components/features/agents/pierre-file-pair-diff-viewer";
import { Badge } from "@/components/ui/badge";
import { FileTypeIcon } from "@/components/ui/file-type-icon";
import { cn } from "@/lib/utils";
import type { FileEditData } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model";
import {
  inferFileEditStatus,
  splitFileEditPath,
} from "@openducktor/frontend-core/sessions/messages/file-edit-tool";
import { useAgentChatSettings } from "./agent-chat-settings-context";

type AgentChatFileEditCardProps = {
  data: FileEditData;
};

// The icon shows the type of the file, as the file tree does. The badge shows the change.
const STATUS_CONFIG = {
  modified: { color: "text-blue-400", badge: "M" },
  added: { color: "text-green-400", badge: "A" },
  deleted: { color: "text-red-400", badge: "D" },
};

const DEFAULT_CONFIG = { color: "text-blue-400", badge: "M" } as const;

const FileEditCardHeader = ({
  data,
  isExpanded,
  onToggle,
}: AgentChatFileEditCardProps & {
  isExpanded: boolean;
  onToggle: () => void;
}): ReactElement => {
  const hasContent = data.kind !== "path";
  const status = inferFileEditStatus(data);
  const config = STATUS_CONFIG[status] ?? DEFAULT_CONFIG;
  const ExpandIcon = isExpanded ? ChevronDown : ChevronRight;

  const { fileName, dirName } = splitFileEditPath(data.filePath);

  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left",
        isExpanded && "border-b border-border",
      )}
      onClick={onToggle}
      aria-expanded={hasContent ? isExpanded : undefined}
    >
      {hasContent ? <ExpandIcon className="size-3 shrink-0 text-muted-foreground" /> : null}
      <FileTypeIcon filePath={data.filePath} className="text-muted-foreground" />
      <span className="flex-1 truncate font-mono text-[11px]">
        {dirName ? <span className="text-muted-foreground">{dirName}/</span> : null}
        <span className="font-semibold">{fileName}</span>
      </span>
      {data.kind !== "write-input" ? (
        <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px] font-mono", config.color)}>
          {config.badge}
        </Badge>
      ) : null}
      {data.additions > 0 || data.deletions > 0 ? (
        <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums">
          {data.additions > 0 ? <span className="text-green-400">+{data.additions}</span> : null}
          {data.deletions > 0 ? <span className="text-red-400">-{data.deletions}</span> : null}
        </span>
      ) : null}
    </button>
  );
};

export const AgentChatFileEditCard = memo(function AgentChatFileEditCard({
  data,
  defaultExpanded,
}: AgentChatFileEditCardProps & {
  /** Opens the changes at first. The `expandFileDiffsByDefault` chat setting decides otherwise. */
  defaultExpanded?: boolean;
}): ReactElement {
  const chatSettings = useAgentChatSettings() ?? DEFAULT_CHAT_SETTINGS;
  const startsExpanded = defaultExpanded ?? chatSettings.expandFileDiffsByDefault;
  const hasContent = data.kind !== "path";
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const isExpanded = hasContent && (userExpanded ?? startsExpanded);

  const handleToggle = (): void => {
    if (!hasContent) {
      return;
    }

    setUserExpanded((prev) => !(prev ?? startsExpanded));
  };

  return (
    <div
      className="my-1.5 overflow-hidden rounded-lg border border-border bg-card text-xs"
      data-testid="agent-chat-file-edit-card"
    >
      <FileEditCardHeader data={data} isExpanded={isExpanded} onToggle={handleToggle} />

      {isExpanded && data.kind === "replacement" ? (
        <>
          <p className="px-3 py-1 text-[11px] text-muted-foreground">Edit fragment</p>
          <PierreFilePairDiffViewer
            filePath={data.filePath}
            oldContent={data.oldContent}
            newContent={data.newContent}
            diffStyle={chatSettings.diffStyle}
            diffIndicators={chatSettings.diffIndicators}
            heightMode={chatSettings.diffHeight}
            lineOverflow={chatSettings.lineOverflow}
            hunkSeparators={chatSettings.hunkSeparators}
          />
        </>
      ) : null}

      {isExpanded && data.kind === "diff" ? (
        <PierrePreloadedDiffViewer
          patch={data.diff}
          filePath={data.filePath}
          diffStyle={chatSettings.diffStyle}
          diffIndicators={chatSettings.diffIndicators}
          heightMode={chatSettings.diffHeight}
          lineOverflow={chatSettings.lineOverflow}
          hunkSeparators={chatSettings.hunkSeparators}
        />
      ) : null}
      {isExpanded && (data.kind === "content" || data.kind === "write-input") ? (
        <>
          {data.kind === "write-input" ? (
            <p className="px-3 py-1 text-[11px] text-muted-foreground">Write input</p>
          ) : null}
          <PierreFileViewer
            filePath={data.filePath}
            content={data.content}
            heightMode={chatSettings.diffHeight}
          />
        </>
      ) : null}
    </div>
  );
});
