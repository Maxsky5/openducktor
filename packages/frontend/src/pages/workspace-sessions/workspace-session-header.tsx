import type { WorkspaceSession } from "@openducktor/contracts";
import { Archive, EllipsisVertical, GitBranch, Pencil } from "lucide-react";
import { type ReactElement, type ReactNode, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDialogPresence } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { workspaceSessionTitle } from "@/state/operations/agent-orchestrator/session-read-model/workspace-session-records";
import { WorkspaceSessionRenameDialog } from "./workspace-session-rename-dialog";

type Props = {
  workspaceId: string;
  record: WorkspaceSession;
  viewControls: ReactNode;
  onArchive: (onCloseAutoFocus: (event: Event) => void) => void;
  isArchiving: boolean;
};

export function WorkspaceSessionHeader({
  workspaceId,
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
  return (
    <div className="electron-titlebar-safe-area border-b border-border px-4 py-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-lg font-semibold leading-6" title={title}>
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          {viewControls}
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                ref={actionsButton}
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Session actions"
                title="Session actions"
                disabled={isArchiving}
              >
                <EllipsisVertical aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
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
                onClick={() => {
                  setMenuOpen(false);
                  onArchive((event) => {
                    event.preventDefault();
                    actionsButton.current?.focus();
                  });
                }}
              >
                <Archive aria-hidden="true" />
                Archive chat
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <p
        className="flex items-center gap-1 truncate text-xs text-muted-foreground"
        title={record.executionTarget.workingDirectory}
      >
        <span className="shrink-0">Workspace session</span>
        <span aria-hidden="true">·</span>
        <GitBranch className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{record.executionTarget.workingDirectory}</span>
        {record.roleSnapshot ? (
          <span className="shrink-0">· {record.roleSnapshot.name}</span>
        ) : null}
      </p>
      {renameMounted && (
        <WorkspaceSessionRenameDialog
          open={renaming}
          workspaceId={workspaceId}
          record={record}
          onClose={() => setRenaming(false)}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            actionsButton.current?.focus();
          }}
        />
      )}
    </div>
  );
}
