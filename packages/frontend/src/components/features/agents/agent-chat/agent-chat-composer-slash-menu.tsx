import type { AgentSlashCommand } from "@openducktor/core";
import { ChevronRight, LoaderCircle, Terminal } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  AgentChatComposerMenu,
  AgentChatComposerMenuEmptyState,
  AgentChatComposerMenuRow,
} from "./agent-chat-composer-menu";
import { getComposerPopupOptionId } from "./agent-chat-composer-menu-state";

type AgentChatComposerSlashMenuProps = {
  listboxId: string;
  commands: AgentSlashCommand[];
  activeIndex: number;
  slashCommandsError: string | null;
  isSlashCommandsLoading: boolean;
  onRetry: (() => void) | null;
  onSelectCommand: (command: AgentSlashCommand) => void;
};

export function AgentChatComposerSlashMenu({
  listboxId,
  commands,
  activeIndex,
  slashCommandsError,
  isSlashCommandsLoading,
  onRetry,
  onSelectCommand,
}: AgentChatComposerSlashMenuProps): ReactElement {
  return (
    <AgentChatComposerMenu
      listboxId={listboxId}
      label="Slash commands"
      activeIndex={activeIndex}
      items={commands}
      isBusy={isSlashCommandsLoading && commands.length === 0}
      feedback={
        <>
          {isSlashCommandsLoading ? (
            <div
              role="status"
              className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" />
              <span>Loading slash commands…</span>
            </div>
          ) : null}
          {slashCommandsError ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm text-destructive"
            >
              <span className="min-w-0">{slashCommandsError}</span>
              {onRetry ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 px-2"
                  onClick={onRetry}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : null}
          {commands.length === 0 && !isSlashCommandsLoading && !slashCommandsError ? (
            <AgentChatComposerMenuEmptyState title="No slash commands found." />
          ) : null}
        </>
      }
    >
      {commands.map((command, index) => (
        <AgentChatComposerMenuRow
          key={command.id}
          optionId={getComposerPopupOptionId(listboxId, index)}
          isActive={index === activeIndex}
          onSelect={() => onSelectCommand(command)}
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
        </AgentChatComposerMenuRow>
      ))}
    </AgentChatComposerMenu>
  );
}
