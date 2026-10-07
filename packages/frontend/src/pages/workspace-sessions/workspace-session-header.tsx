import type { WorkspaceSession } from "@openducktor/contracts";
import { Archive, Bot, Check, Folder, Pencil } from "lucide-react";
import { type ReactElement, type ReactNode, useRef, useState } from "react";
import {
  SessionActionButton,
  SessionActionMenuTrigger,
} from "@/components/features/agents/session-action-button";
import { SessionOpenInAction } from "@/components/features/agents/session-open-in-action";
import { SessionPageHeader } from "@/components/features/agents/session-page-header";
import { Button } from "@/components/ui/button";
import { useDialogPresence } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import {
  workspaceSessionTitle,
  workspaceSessionWorkingDirectory,
} from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import type { ActiveWorkspace } from "@/types/state-slices";
import { WorkspaceSessionRenameDialog } from "./workspace-session-rename-dialog";

type Props = {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  viewControls: ReactNode;
  onArchive: (onCloseAutoFocus: (event: Event) => void) => void;
  isArchiving: boolean;
};

export function WorkspaceSessionHeader({
  workspace,
  record,
  viewControls,
  onArchive,
  isArchiving,
}: Props): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const renameMounted = useDialogPresence(renaming);
  const actionsButton = useRef<HTMLButtonElement>(null);
  const title = workspaceSessionTitle(record);
  const workingDirectory = workspaceSessionWorkingDirectory(workspace, record);
  const contextMode = record.executionTarget.kind === "local_repo_root" ? "repository" : "worktree";
  const archive = (trigger: HTMLButtonElement | null): void => {
    setMenuOpen(false);
    onArchive((event) => {
      event.preventDefault();
      trigger?.focus();
    });
  };
  return (
    <>
      <SessionPageHeader
        title={
          <Tooltip>
            <TooltipTrigger asChild>
              <h2 className="min-w-0 truncate text-sm font-semibold leading-5">{title}</h2>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="max-w-96">
              {title}
            </TooltipContent>
          </Tooltip>
        }
        actions={
          <>
            {record.roleSnapshot ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    role="img"
                    aria-label="Custom role"
                    tabIndex={0}
                    className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <Bot className="size-3.5" aria-hidden="true" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{record.roleSnapshot.name}</TooltipContent>
              </Tooltip>
            ) : null}
            <WorkingDirectoryButton key={workingDirectory} directory={workingDirectory} />
            <div className="flex items-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <SessionActionButton
                      aria-label="Archive chat"
                      disabled={isArchiving}
                      onClick={(event) => archive(event.currentTarget)}
                    >
                      <Archive className="size-3.5" aria-hidden="true" />
                      <span className="truncate @max-[640px]/session-header:hidden">Archive</span>
                    </SessionActionButton>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">Archive chat</TooltipContent>
              </Tooltip>
              <Popover open={menuOpen} onOpenChange={setMenuOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <SessionActionMenuTrigger
                        ref={actionsButton}
                        aria-label="Session actions"
                        disabled={isArchiving}
                      />
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Session actions</TooltipContent>
                </Tooltip>
                <PopoverContent
                  align="end"
                  aria-label="Session actions"
                  className="w-40 p-1.5"
                  onCloseAutoFocus={(event) => {
                    if (renaming) event.preventDefault();
                  }}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    disabled={isArchiving}
                    onClick={() => {
                      setMenuOpen(false);
                      setRenaming(true);
                    }}
                  >
                    <Pencil aria-hidden="true" />
                    Rename
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    disabled={isArchiving}
                    onClick={() => archive(actionsButton.current)}
                  >
                    <Archive aria-hidden="true" />
                    Archive chat
                  </Button>
                </PopoverContent>
              </Popover>
            </div>
          </>
        }
        openIn={
          <SessionOpenInAction
            contextMode={contextMode}
            targetPath={workingDirectory}
            targetLabel={contextMode === "repository" ? "repository root" : "workspace worktree"}
            disabledReason={
              workingDirectory ? null : "The selected working directory is unavailable."
            }
          />
        }
        viewControls={viewControls}
      />
      {renameMounted && (
        <WorkspaceSessionRenameDialog
          open={renaming}
          workspaceId={workspace.workspaceId}
          record={record}
          onClose={() => setRenaming(false)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            actionsButton.current?.focus();
          }}
        />
      )}
    </>
  );
}

function WorkingDirectoryButton({ directory }: { directory: string | null }): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Copy working directory"
            disabled={!directory}
            onClick={() => {
              if (directory) void copyToClipboard(directory);
            }}
          >
            {copied ? (
              <Check
                className="size-3.5 text-emerald-500 dark:text-emerald-400"
                aria-hidden="true"
              />
            ) : (
              <Folder className="size-3.5" aria-hidden="true" />
            )}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-96 break-all">
        <p>{copied ? "Copied" : "Copy working directory"}</p>
        <p className="mt-1 font-mono text-xs">{directory ?? "Working directory unavailable"}</p>
      </TooltipContent>
    </Tooltip>
  );
}
