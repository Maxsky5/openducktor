import type { AppPlatform } from "@openducktor/contracts";
import { Search } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { platformKeyLabels } from "@/lib/keyboard-shortcuts";
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
  const { open, platform } = useCommandPalette();
  const modifier = platform ? platformKeyLabels(platform).modifier : null;
  const keyShortcuts = ariaKeyShortcuts(platform);
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
            {modifier ? <KeyCaps keys={[modifier, "K"]} /> : null}
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
        "h-8 shrink-0 gap-1.5 border-sidebar-border bg-transparent px-2 text-sidebar-muted-foreground shadow-none hover:text-sidebar-foreground",
        className,
      )}
      aria-label={LABEL}
      aria-keyshortcuts={keyShortcuts}
      title={LABEL}
      onClick={open}
    >
      <Search className="size-3.5" aria-hidden="true" />
      {modifier ? <KeyCaps keys={[modifier, "K"]} /> : null}
    </Button>
  );
}

/** The shortcut for `aria-keyshortcuts`, or undefined until the platform is known. */
const ariaKeyShortcuts = (platform: AppPlatform | null): string | undefined => {
  if (!platform) return undefined;
  return platform === "darwin" ? "Meta+K" : "Control+K";
};
