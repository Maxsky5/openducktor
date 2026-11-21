import type { WorkspaceRecord } from "@openducktor/contracts";
import { cva } from "class-variance-authority";
import { Check, ChevronDown, ChevronsUpDown, Layers } from "lucide-react";
import { type ComponentProps, type ReactElement, type ReactNode, useMemo, useState } from "react";
import { WorkspaceTile } from "@/components/layout/workspace-tile";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** A workspace that the picker shows, with the parts of its tile. */
export type WorkspacePickerWorkspace = Pick<
  WorkspaceRecord,
  "workspaceId" | "workspaceName" | "repoPath" | "abbreviation" | "tileColor"
> &
  Partial<Pick<WorkspaceRecord, "iconDataUrl">>;

const ALL_WORKSPACES_VALUE = "workspace-picker:all";

/** Each word of the search must be in the name or in a folder of the path. */
const filterWorkspace = (_value: string, search: string, keywords: string[] = []): number => {
  const words = keywords.map((keyword) => keyword.toLowerCase());
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => words.some((word) => word.includes(term))) ? 1 : 0;
};

type WorkspacePickerListProps = {
  workspaces: readonly WorkspacePickerWorkspace[];
  /** The chosen workspace ID, or null for All workspaces or for no choice. */
  value: string | null;
  /** Adds the All workspaces row, which chooses null. */
  allowAll?: boolean;
  /** A red count after a workspace, such as its settings errors. */
  errorCountByWorkspaceId?: Partial<Record<string, number>>;
  onSelect: (workspaceId: string | null) => void;
};

/**
 * The searchable list of the workspace picker. A workspace shows its repository only when another
 * workspace has the same name, so the two stay apart.
 */
export function WorkspacePickerList({
  workspaces,
  value,
  allowAll = false,
  errorCountByWorkspaceId = {},
  onSelect,
}: WorkspacePickerListProps): ReactElement {
  const sharedNames = useMemo(() => {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const { workspaceName } of workspaces) {
      if (seen.has(workspaceName)) shared.add(workspaceName);
      seen.add(workspaceName);
    }
    return shared;
  }, [workspaces]);

  return (
    <Command loop label="Workspaces" filter={filterWorkspace}>
      <CommandInput placeholder="Filter workspaces…" autoFocus />
      <CommandList className="max-h-72 p-1">
        <CommandEmpty>No workspace matches.</CommandEmpty>
        <CommandGroup>
          {allowAll ? (
            <WorkspacePickerRow
              value={ALL_WORKSPACES_VALUE}
              keywords={["all", "workspaces"]}
              label="All workspaces"
              icon={<AllWorkspacesIcon />}
              checked={value === null}
              onSelect={() => onSelect(null)}
            />
          ) : null}
          {workspaces.map((workspace) => {
            const errorCount = errorCountByWorkspaceId[workspace.workspaceId] ?? 0;
            return (
              <WorkspacePickerRow
                key={workspace.workspaceId}
                value={workspace.workspaceId}
                keywords={[
                  workspace.workspaceName,
                  ...workspace.repoPath.split("/").filter(Boolean),
                ]}
                label={workspace.workspaceName}
                detail={sharedNames.has(workspace.workspaceName) ? workspace.repoPath : null}
                error={errorCount > 0 ? `${errorCount} error${errorCount > 1 ? "s" : ""}` : null}
                icon={<WorkspaceTile workspace={workspace} size="xs" className="shadow-none" />}
                checked={value === workspace.workspaceId}
                onSelect={() => onSelect(workspace.workspaceId)}
              />
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/** The icon of All workspaces. */
export function AllWorkspacesIcon(): ReactElement {
  return <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

function WorkspacePickerRow({
  value,
  keywords,
  label,
  detail = null,
  error = null,
  icon,
  checked,
  onSelect,
}: {
  value: string;
  keywords: string[];
  label: string;
  detail?: string | null;
  error?: string | null;
  icon: ReactNode;
  checked: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <CommandItem value={value} keywords={keywords} onSelect={onSelect} className="gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center self-start">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail ? (
          <span className="block break-all text-xs text-muted-foreground">{detail}</span>
        ) : null}
      </span>
      {error ? (
        <span className="shrink-0 text-xs font-medium text-destructive">{error}</span>
      ) : null}
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

const workspacePickerTriggerVariants = cva(
  "flex min-w-0 items-center gap-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60",
  {
    variants: {
      variant: {
        /** A small chip, such as the workspace filter of the command palette. */
        chip: "h-7 max-w-48 shrink-0 gap-1.5 rounded-md border border-border bg-muted/60 px-2 text-xs font-medium hover:bg-muted",
        /** A full-width form field. */
        field:
          "h-9 w-full justify-between rounded-md border border-input bg-card px-3 text-sm hover:bg-accent",
        /** Text in a title, such as "Create task in [workspace]". */
        inline: "h-8 rounded-md px-1.5 text-lg font-semibold hover:bg-accent/60",
      },
    },
  },
);

type WorkspacePickerVariant = "chip" | "field" | "inline";

/**
 * The button of the workspace picker. It passes its other props to the button, so it can be the
 * child of a popover trigger.
 */
export function WorkspacePickerTrigger({
  workspace,
  label,
  placeholder,
  emptyIcon = null,
  variant,
  className,
  ...buttonProps
}: Omit<ComponentProps<"button">, "children"> & {
  /** The chosen workspace, or null for All workspaces or for no choice. */
  workspace: WorkspacePickerWorkspace | null;
  /** What the picker chooses, such as "Workspace". It starts the accessible name. */
  label: string;
  /** The text without a workspace, such as "All workspaces". */
  placeholder: string;
  /** The icon without a workspace, such as the All workspaces icon. */
  emptyIcon?: ReactNode;
  variant: WorkspacePickerVariant;
}): ReactElement {
  const name = workspace?.workspaceName ?? placeholder;
  const Chevron = variant === "chip" ? ChevronDown : ChevronsUpDown;
  return (
    <button
      type="button"
      aria-label={`${label}: ${name}`}
      className={cn(workspacePickerTriggerVariants({ variant }), className)}
      {...buttonProps}
    >
      <span className="flex min-w-0 items-center gap-2">
        {workspace ? (
          <WorkspaceTile
            workspace={workspace}
            size="xs"
            className={variant === "chip" ? "size-4 shadow-none" : "shadow-none"}
          />
        ) : (
          emptyIcon
        )}
        <span className="truncate">{name}</span>
      </span>
      <Chevron className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

/** With All workspaces, the picker can choose null. Without it, it always chooses a workspace. */
type WorkspacePickerChoice =
  | { allowAll: true; onValueChange: (workspaceId: string | null) => void }
  | { allowAll?: false; onValueChange: (workspaceId: string) => void };

type WorkspacePickerProps = Omit<ComponentProps<"button">, "children" | "value" | "onChange"> &
  WorkspacePickerChoice & {
    workspaces: readonly WorkspacePickerWorkspace[];
    /** The chosen workspace ID, or null for All workspaces or for no choice. */
    value: string | null;
    errorCountByWorkspaceId?: Partial<Record<string, number>>;
    /** What the picker chooses, such as "Workspace". It starts the accessible name. */
    label: string;
    placeholder?: string;
    variant: WorkspacePickerVariant;
    align?: "start" | "center" | "end";
  };

/** The workspace picker: a trigger and a searchable list of the workspaces. */
export function WorkspacePicker({
  workspaces,
  value,
  allowAll,
  onValueChange,
  errorCountByWorkspaceId,
  label,
  placeholder = allowAll ? "All workspaces" : "Choose a workspace",
  variant,
  align = "start",
  disabled = false,
  className,
  ...triggerProps
}: WorkspacePickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const workspace = workspaces.find(({ workspaceId }) => workspaceId === value) ?? null;
  const choose = (workspaceId: string | null): void => {
    setOpen(false);
    if (allowAll) onValueChange(workspaceId);
    else if (workspaceId !== null) onValueChange(workspaceId);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <WorkspacePickerTrigger
          workspace={workspace}
          label={label}
          placeholder={placeholder}
          emptyIcon={allowAll ? <AllWorkspacesIcon /> : null}
          variant={variant}
          disabled={disabled}
          className={className}
          {...triggerProps}
        />
      </PopoverTrigger>
      {/* Inside a dialog the list opens in the dialog, which keeps its focus and pointer rules. */}
      <PopoverContent
        align={align}
        className="w-72 p-0"
        portalContainer={
          open && document.activeElement instanceof HTMLElement
            ? document.activeElement.closest<HTMLElement>("[data-slot='dialog-content']")
            : null
        }
      >
        <WorkspacePickerList
          workspaces={workspaces}
          value={value}
          allowAll={allowAll === true}
          {...(errorCountByWorkspaceId ? { errorCountByWorkspaceId } : {})}
          onSelect={choose}
        />
      </PopoverContent>
    </Popover>
  );
}
