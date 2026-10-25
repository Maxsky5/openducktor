import { ChevronDown, LoaderCircle, Shrink } from "lucide-react";
import type { ReactElement } from "react";
import { AgentChatMarkdownRenderer } from "./agent-chat-markdown-renderer";
import { AgentTranscriptSeparator } from "./agent-transcript-separator";

type AgentCompactionSeparatorProps = {
  status: "running" | "completed";
  label: string;
  context: string | null;
};

export function AgentCompactionSeparator({
  status,
  label,
  context,
}: AgentCompactionSeparatorProps): ReactElement {
  const isRunning = status === "running";
  const labelContent = (
    <span className="inline-flex items-center gap-1.5">
      {isRunning ? (
        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
      ) : (
        <Shrink aria-hidden="true" className="size-3.5" />
      )}
      {isRunning ? "Compacting…" : label}
      {context ? (
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 transition-transform group-open/compaction:rotate-180"
        />
      ) : null}
    </span>
  );

  if (!context) {
    return <AgentTranscriptSeparator label={labelContent} className="text-secondary-foreground" />;
  }

  return (
    <details className="group/compaction">
      <summary className="cursor-pointer list-none rounded-sm text-secondary-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <AgentTranscriptSeparator label={labelContent} className="text-inherit" />
      </summary>
      <div className="px-1 pb-2">
        <div className="rounded-md border border-border bg-card px-3 py-2">
          <AgentChatMarkdownRenderer markdown={context} variant="compact" />
        </div>
      </div>
    </details>
  );
}
