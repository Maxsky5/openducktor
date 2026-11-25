import { Ellipsis, Loader2, type LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type MenuCommand = {
  readonly label: string;
  readonly Icon: LucideIcon;
  readonly run: () => void;
  readonly disabled?: boolean;
  /** Why the command is disabled. It shows under the label. */
  readonly reason?: string;
  readonly destructive?: boolean;
  readonly busy?: boolean;
};

/**
 * The look of the task actions menu of the task details: compact rows with small icons, and a
 * destructive row in red, its icon too.
 */
const ITEM_CLASS =
  "h-8 gap-2 rounded-md border border-transparent px-3 text-xs font-medium [&_svg]:size-3.5";
const REGULAR_CLASS = "text-foreground focus:bg-accent/60";
const DESTRUCTIVE_CLASS =
  "text-destructive-muted focus:border-destructive-border/60 focus:bg-destructive-surface/70 focus:text-destructive-surface-foreground dark:focus:bg-destructive-surface/55";

function CommandItem({ command }: { command: MenuCommand }): ReactElement {
  const { label, Icon, run, disabled, reason, destructive, busy } = command;
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={run}
      className={cn(
        ITEM_CLASS,
        destructive ? DESTRUCTIVE_CLASS : REGULAR_CLASS,
        reason && "h-auto items-start py-1.5",
      )}
    >
      {busy ? (
        <Loader2 className="animate-spin text-current" />
      ) : (
        <Icon className={cn("text-current", reason && "mt-0.5")} />
      )}
      {reason ? (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span>{label}</span>
          <span className="font-normal text-muted-foreground">{reason}</span>
        </span>
      ) : (
        label
      )}
    </DropdownMenuItem>
  );
}

/** A "…" button that opens the commands of one item. Destructive commands come last. */
export function ActionMenu({
  label,
  commands,
  align = "end",
}: {
  /** The accessible name of the button, such as "Actions for Bug triage". */
  label: string;
  commands: readonly MenuCommand[];
  align?: "start" | "end";
}): ReactElement | null {
  if (commands.length === 0) return null;
  const regular = commands.filter(({ destructive }) => !destructive);
  const destructive = commands.filter(({ destructive: isDestructive }) => isDestructive);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          aria-label={label}
          title={label}
        >
          <Ellipsis className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-56 p-1.5">
        {regular.map((command) => (
          <CommandItem key={command.label} command={command} />
        ))}
        {regular.length > 0 && destructive.length > 0 ? <DropdownMenuSeparator /> : null}
        {destructive.map((command) => (
          <CommandItem key={command.label} command={command} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
