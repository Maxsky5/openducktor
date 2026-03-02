import { memo, type ReactElement, useCallback, useEffect, useState } from "react";
import type { PierreDiffStyle } from "@/components/features/agents/pierre-diff-viewer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DiffScope } from "@/pages/agents/use-agent-studio-diff-data";
import { CommitComposer } from "./commit-composer";
import { EmptyDiffState } from "./empty-diff-state";
import { FileDiffList } from "./file-diff-list";
import { GitInfoHeader } from "./git-info-header";
import { ReviewActions } from "./review-actions";
import type { AgentStudioGitPanelModel } from "./types";

export const AgentStudioGitPanel = memo(function AgentStudioGitPanel({
  model,
}: {
  model: AgentStudioGitPanelModel;
}): ReactElement {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [diffStyle, setDiffStyle] = useState<PierreDiffStyle>("unified");
  const uncommittedFileCount = model.fileStatuses.length;
  const hasUncommittedFiles = uncommittedFileCount > 0;
  const hasFiles = model.fileDiffs.length > 0;

  const toggleFile = useCallback((filePath: string): void => {
    setExpandedFiles((previous) => {
      const next = new Set(previous);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const handleDiffScopeChange = useCallback(
    (scope: DiffScope): void => {
      setExpandedFiles((previous) => {
        if (previous.size === 0) {
          return previous;
        }
        return new Set<string>();
      });
      model.setDiffScope(scope);
    },
    [model.setDiffScope],
  );

  useEffect(() => {
    setExpandedFiles((previous) => {
      if (previous.size === 0) {
        return previous;
      }
      const availableFiles = new Set(model.fileDiffs.map((diff) => diff.file));
      const next = new Set<string>();
      let changed = false;

      for (const file of previous) {
        if (availableFiles.has(file)) {
          next.add(file);
          continue;
        }
        changed = true;
      }

      return changed ? next : previous;
    });
  }, [model.fileDiffs]);

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <GitInfoHeader
          branch={model.branch}
          targetBranch={model.targetBranch}
          diffScope={model.diffScope}
          uncommittedFileCount={uncommittedFileCount}
          commitsAheadBehind={model.commitsAheadBehind}
          upstreamAheadBehind={model.upstreamAheadBehind ?? null}
          isLoading={model.isLoading}
          isCommitting={model.isCommitting ?? false}
          isPushing={model.isPushing ?? false}
          isRebasing={model.isRebasing ?? false}
          pushError={model.pushError ?? null}
          rebaseError={model.rebaseError ?? null}
          pushBranch={model.pushBranch ?? null}
          rebaseOntoTarget={model.rebaseOntoTarget ?? null}
          pullFromUpstream={model.pullFromUpstream ?? null}
          setDiffScope={handleDiffScopeChange}
          onRefresh={model.refresh}
        />

        {model.error ? (
          <div className="border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {model.error}
          </div>
        ) : null}

        <ScrollArea className="min-h-0 flex-1">
          {hasFiles ? (
            <FileDiffList
              fileDiffs={model.fileDiffs}
              diffStyle={diffStyle}
              setDiffStyle={setDiffStyle}
              expandedFiles={expandedFiles}
              onToggleFile={toggleFile}
            />
          ) : (
            <EmptyDiffState isLoading={model.isLoading} />
          )}
        </ScrollArea>

        {model.onSendReview != null ? <ReviewActions onSendReview={model.onSendReview} /> : null}

        {model.diffScope === "uncommitted" ? (
          <CommitComposer
            hasUncommittedFiles={hasUncommittedFiles}
            uncommittedFileCount={uncommittedFileCount}
            isCommitting={model.isCommitting ?? false}
            isPushing={model.isPushing ?? false}
            isRebasing={model.isRebasing ?? false}
            commitError={model.commitError ?? null}
            commitAll={model.commitAll ?? null}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
});
