import { useShortcutKeys } from "../shortcuts/use-shortcut-label";
import { Search } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCommandPalette } from "./command-palette-context";
import { KeyCaps } from "./command-palette-key-caps";

const LABEL = "Search and run commands";

/** Opens the command palette. The compact form is an icon with a tooltip. */
export function CommandPaletteTrigger({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}): ReactElement {
  const { open } = useCommandPalette();
  const shortcut = useShortcutKeys("palette");
  const keys = shortcut?.keys;
  const keyShortcuts = shortcut?.aria;
  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                "size-9 text-sidebar-muted-foreground hover:text-sidebar-foreground",
                className,
              )}
              aria-label={LABEL}
              aria-keyshortcuts={keyShortcuts}
              onClick={open}
            >
              <Search className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="flex items-center gap-2">
            {LABEL}
            {keys ? <KeyCaps keys={keys} /> : null}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn(
        "h-9 w-full justify-start gap-2 rounded-md border-sidebar-border bg-muted/40 px-3 text-sm font-normal text-sidebar-muted-foreground shadow-none hover:bg-muted hover:text-sidebar-foreground",
        className,
      )}
      aria-label={LABEL}
      aria-keyshortcuts={keyShortcuts}
      title={LABEL}
      onClick={open}
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-left">Search anything…</span>
      {keys ? <KeyCaps keys={keys} /> : null}
    </Button>
  );
}
