import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import type { ReactElement } from "react";
import { useSettingsModal } from "@/components/features/settings/settings-modal";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TerminalPanelModel } from "@/features/terminals/use-terminals";
import { errorMessage } from "@/lib/errors";
import { repoConfigQueryOptions } from "@/state/queries/workspace";
import type { ActiveWorkspace } from "@/types/state-slices";
import { RepoActionsSplitButton } from "./repo-actions-split-button";

type Props = {
  workspace: Pick<ActiveWorkspace, "workspaceId" | "repoPath">;
  terminal: Pick<TerminalPanelModel, "startBlockedReason" | "onRunAction">;
};

/** The session top bar control that runs repository actions in new terminals. */
export function SessionRepoActions({ workspace, terminal }: Props): ReactElement | null {
  // A settings save invalidates this query, so new actions show without a reload.
  const { data: repoConfig, error } = useQuery(repoConfigQueryOptions(workspace.workspaceId));
  const { openSettings } = useSettingsModal();
  const manageActions = (): void =>
    openSettings({ deepLink: { kind: "repository-actions", repositoryPath: workspace.repoPath } });
  if (!repoConfig) return error ? <ActionsLoadFailure message={errorMessage(error)} /> : null;
  return (
    <RepoActionsSplitButton
      actions={repoConfig.actions}
      disabledReason={terminal.startBlockedReason}
      onRunAction={terminal.onRunAction}
      onManageActions={manageActions}
    />
  );
}

function ActionsLoadFailure({ message }: { message: string }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-7 px-0 shadow-none"
            aria-label="Repository actions unavailable"
            disabled
          >
            <Play className="size-3.5" aria-hidden="true" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">
        Could not load repository actions: {message}
      </TooltipContent>
    </Tooltip>
  );
}
