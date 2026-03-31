import type { AgentSlashCommand } from "@openducktor/core";
import { ChevronRight, LoaderCircle, Terminal } from "lucide-react";
import { type ReactElement, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type AgentChatComposerSlashMenuProps = {
  commands: AgentSlashCommand[];
  activeIndex: number;
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  onSelectCommand: (command: AgentSlashCommand) => void;
};

export function AgentChatComposerSlashMenu({
  commands,
  activeIndex,
  slashCommandsError,
  isSlashCommandsLoading,
  onSelectCommand,
}: AgentChatComposerSlashMenuProps): ReactElement {
  const commandButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const activeCommand = commands[activeIndex];
    if (!activeCommand) {
      return;
    }

    commandButtonRefs.current[activeCommand.id]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeIndex, commands]);

  return (
    <div className="absolute bottom-full rounded-xl z-20 mb-2 border border-border bg-popover shadow-lg">
      {isSlashCommandsLoading ? (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          <span>Loading slash commands...</span>
        </div>
      ) : slashCommandsError ? (
        <div className="px-3 py-2 text-sm text-destructive">{slashCommandsError}</div>
      ) : commands.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">No slash commands found.</div>
      ) : (
        <div className="hide-scrollbar flex rounded-xl max-h-64 flex-col overflow-y-auto">
          {commands.map((command, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={command.id}
                ref={(element) => {
                  commandButtonRefs.current[command.id] = element;
                }}
                type="button"
                className={cn(
                  "flex w-full cursor-pointer gap-3 px-3 py-2 text-left transition-colors",
                  isActive ? "bg-primary/20" : "hover:bg-muted/80",
                )}
                onPointerDown={(event) => {
                  event.preventDefault();
                  onSelectCommand(command);
                }}
                onClick={() => onSelectCommand(command)}
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Terminal className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span className="truncate">/{command.trigger}</span>
                    {command.source ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {command.source}
                      </span>
                    ) : null}
                  </span>
                  {command.description ? (
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {command.description}
                    </span>
                  ) : null}
                </span>
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
