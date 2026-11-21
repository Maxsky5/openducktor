import type { WorkspaceRecord } from "@openducktor/contracts";
import { type ReactElement, useMemo, useState } from "react";
import {
  AllWorkspacesIcon,
  WorkspacePickerList,
  WorkspacePickerTrigger,
} from "@/components/features/workspace-picker/workspace-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { KeyCaps } from "./command-palette-key-caps";

export type CommandPaletteScopeProps = {
  workspaces: readonly WorkspaceRecord[];
  /** The scope workspace, or null for all workspaces. */
  workspace: WorkspaceRecord | null;
  open: boolean;
  /** The key caps that open the scope list, or null until the platform is known. */
  shortcutKeys: readonly string[] | null;
  portalContainer: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onChange: (workspaceId: string | null) => void;
  onCloseAutoFocus: (event: Event) => void;
};

export type PaletteScope = {
  /** The scope workspace, or null for all open workspaces. */
  workspace: WorkspaceRecord | null;
  /** The workspaces that search covers. */
  scopedWorkspaces: readonly WorkspaceRecord[];
  open: boolean;
  setOpen: (open: boolean) => void;
  setWorkspaceId: (workspaceId: string | null) => void;
};

/** The workspace scope of search and of workspace actions. */
export function usePaletteScope(workspaces: readonly WorkspaceRecord[]): PaletteScope {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const workspace = workspaces.find((entry) => entry.workspaceId === workspaceId) ?? null;
  const scopedWorkspaces = useMemo(
    () => (workspace ? [workspace] : workspaces),
    [workspace, workspaces],
  );
  return { workspace, scopedWorkspaces, open, setOpen, setWorkspaceId };
}

export function CommandPaletteScope({
  workspaces,
  workspace,
  open,
  shortcutKeys,
  portalContainer,
  onOpenChange,
  onChange,
  onCloseAutoFocus,
}: CommandPaletteScopeProps): ReactElement {
  return (
    // Modal: the palette rows behind the list get no pointer events. A hover there would move
    // focus out of the list and close it.
    <Popover modal open={open} onOpenChange={onOpenChange}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <WorkspacePickerTrigger
                workspace={workspace}
                label="Workspace filter"
                placeholder="All workspaces"
                emptyIcon={<AllWorkspacesIcon />}
                variant="chip"
                // The palette input keeps focus; the scope opens from a click or its shortcut.
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
              />
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="flex items-center gap-2">
            Filter by workspace
            {shortcutKeys ? <KeyCaps keys={shortcutKeys} /> : null}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent
        align="end"
        // No motion: the list opens from a key, and a closing list would take the next Escape.
        className="w-64 p-0 animate-none!"
        portalContainer={portalContainer}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <WorkspacePickerList
          workspaces={workspaces}
          value={workspace?.workspaceId ?? null}
          allowAll
          onSelect={onChange}
        />
      </PopoverContent>
    </Popover>
  );
}
