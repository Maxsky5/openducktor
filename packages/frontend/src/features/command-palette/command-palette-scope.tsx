import type { WorkspaceRecord } from "@openducktor/contracts";
import { Check, ChevronDown, Layers } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { WorkspaceTile } from "@/components/layout/workspace-tile";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { KeyCaps } from "./command-palette-key-caps";

const ALL_WORKSPACES_VALUE = "scope:all";

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
  const label = workspace?.workspaceName ?? "All workspaces";
  return (
    // Modal: the palette rows behind the list get no pointer events. A hover there would move
    // focus out of the list and close it.
    <Popover modal open={open} onOpenChange={onOpenChange}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Workspace filter: ${label}`}
                className="flex h-7 max-w-48 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 text-xs font-medium text-foreground hover:bg-muted"
                onMouseDown={(event) => event.preventDefault()}
              >
                {workspace ? (
                  <WorkspaceTile workspace={workspace} size="xs" className="size-4 shadow-none" />
                ) : (
                  <Layers className="size-3.5 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="truncate">{label}</span>
                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </button>
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
        <Command loop label="Workspace filter">
          <CommandInput placeholder="Filter workspaces…" autoFocus />
          <CommandList className="max-h-72 p-1">
            <CommandGroup>
              <ScopeOption
                value={ALL_WORKSPACES_VALUE}
                label="All workspaces"
                checked={workspace === null}
                icon={<Layers className="size-4 text-muted-foreground" aria-hidden="true" />}
                onSelect={() => onChange(null)}
              />
              {workspaces.map((choice) => (
                <ScopeOption
                  key={choice.workspaceId}
                  value={`scope:${choice.workspaceId}`}
                  label={choice.workspaceName}
                  checked={workspace?.workspaceId === choice.workspaceId}
                  icon={<WorkspaceTile workspace={choice} size="xs" className="shadow-none" />}
                  onSelect={() => onChange(choice.workspaceId)}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ScopeOption({
  value,
  label,
  checked,
  icon,
  onSelect,
}: {
  value: string;
  label: string;
  checked: boolean;
  icon: ReactElement;
  onSelect: () => void;
}): ReactElement {
  return (
    <CommandItem value={value} keywords={[label]} onSelect={onSelect} className="gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Check
        className={cn(
          "size-4 shrink-0 text-selected-accent",
          checked ? "opacity-100" : "opacity-0",
        )}
        aria-hidden="true"
      />
    </CommandItem>
  );
}
