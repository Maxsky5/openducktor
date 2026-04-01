import type { AgentFileSearchResult } from "@openducktor/core";
import { ChevronRight } from "lucide-react";
import { type ReactElement, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { AgentChatFileReferenceIcon } from "./agent-chat-file-reference-icon";

type AgentChatComposerFileMenuProps = {
  results: AgentFileSearchResult[];
  activeIndex: number;
  fileSearchError: string | null;
  isFileSearchLoading: boolean;
  onSelectFile: (result: AgentFileSearchResult) => void;
};

export function AgentChatComposerFileMenu({
  results,
  activeIndex,
  fileSearchError,
  isFileSearchLoading,
  onSelectFile,
}: AgentChatComposerFileMenuProps): ReactElement {
  const resultButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  let content: ReactElement | null = null;

  useEffect(() => {
    const activeResult = results[activeIndex];
    if (!activeResult) {
      return;
    }

    resultButtonRefs.current[activeResult.id]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeIndex, results]);

  if (fileSearchError) {
    content = <div className="px-3 py-2 text-sm text-destructive">{fileSearchError}</div>;
  } else if (!isFileSearchLoading && results.length === 0) {
    content = <div className="px-3 py-2 text-sm text-muted-foreground">No files found.</div>;
  } else if (results.length > 0) {
    content = (
      <div className="hide-scrollbar flex max-h-64 flex-col overflow-y-auto rounded-xl">
        {results.map((result, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={result.id}
              ref={(element) => {
                resultButtonRefs.current[result.id] = element;
              }}
              type="button"
              className={cn(
                "flex w-full cursor-pointer gap-3 px-3 py-2 text-left transition-colors",
                isActive ? "bg-primary/20" : "hover:bg-muted/80",
              )}
              onPointerDown={(event) => {
                event.preventDefault();
                onSelectFile(result);
              }}
            >
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <AgentChatFileReferenceIcon kind={result.kind} className="text-muted-foreground" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {result.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{result.path}</span>
              </span>
              <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="absolute bottom-full z-20 mb-2 rounded-xl border border-border bg-popover shadow-lg">
      {content}
    </div>
  );
}
