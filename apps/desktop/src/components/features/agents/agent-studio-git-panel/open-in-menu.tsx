import type { SystemOpenInToolId } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/errors";
import { openInToolsQueryOptions, refreshOpenInToolsFromQuery } from "@/state/queries/system";
import { persistPreferredOpenInTool, readPreferredOpenInTool } from "./open-in-preferences";
import { getOpenInToolLabel, OpenInToolIcon } from "./open-in-tool-metadata";

function renderOpenInMenuTriggerButton({ disabled }: { disabled: boolean }): ReactElement {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 rounded-l-none border-l-0 px-1.5 text-[11px]"
      data-testid="agent-studio-git-open-in-trigger"
      aria-label="Choose a different tool"
      disabled={disabled}
    >
      <ChevronDown className="size-3" />
    </Button>
  );
}

function renderOpenInDefaultButton({
  targetLabel,
  defaultToolLabel,
  defaultToolIcon,
  onClick,
  disabled,
  isPending,
  hasMenuTrigger,
}: {
  targetLabel: string;
  defaultToolLabel: string;
  defaultToolIcon: ReactNode;
  onClick: (() => void) | null;
  disabled: boolean;
  isPending: boolean;
  hasMenuTrigger: boolean;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={
        hasMenuTrigger
          ? "h-7 gap-1.5 rounded-r-none px-2 text-[11px]"
          : "h-7 gap-1.5 px-2 text-[11px]"
      }
      data-testid="agent-studio-git-open-in-default-button"
      aria-label={`Open ${targetLabel} in ${defaultToolLabel}`}
      onClick={onClick ?? undefined}
      disabled={disabled}
    >
      {isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : defaultToolIcon}
      <span className="truncate">{defaultToolLabel}</span>
    </Button>
  );
}

function DisabledOpenInTrigger({
  disabledReason,
  trigger,
}: {
  disabledReason: string;
  trigger: ReactElement;
}): ReactElement {
  const descriptionId = useId();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex cursor-not-allowed"
          data-testid="agent-studio-git-open-in-disabled-trigger"
        >
          {trigger}
          <span id={descriptionId} className="sr-only">
            {disabledReason}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-80">
        <p>{disabledReason}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function OpenInMenuBody({ children }: { children: ReactNode }): ReactElement {
  return (
    <PopoverContent align="end" className="w-80 p-0">
      {children}
    </PopoverContent>
  );
}

function defaultUnavailableReason(contextMode: "repository" | "worktree"): string {
  if (contextMode === "repository") {
    return "Repository path is unavailable. Select a repository and try again.";
  }

  return "Builder worktree path is unavailable. Refresh the Git panel and try again.";
}

function resolveOpenInDisabledReason({
  contextMode,
  targetLabel,
  targetPath,
  disabledReason,
  onOpenInTool,
}: {
  contextMode: "repository" | "worktree";
  targetLabel: string;
  targetPath: string | null;
  disabledReason: string | null;
  onOpenInTool?: ((toolId: SystemOpenInToolId) => Promise<void>) | undefined;
}): string | null {
  if (disabledReason) {
    return disabledReason;
  }

  if (!targetPath) {
    return defaultUnavailableReason(contextMode);
  }

  if (!onOpenInTool) {
    return `Open ${targetLabel} is unavailable right now.`;
  }

  return null;
}

function OpenInActionGroup({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="flex items-center" data-testid="agent-studio-git-open-in-actions">
      {children}
    </div>
  );
}

export function OpenInMenu({
  contextMode,
  targetPath,
  disabledReason,
  onOpenInTool,
}: {
  contextMode: "repository" | "worktree";
  targetPath: string | null;
  disabledReason: string | null;
  onOpenInTool?: ((toolId: SystemOpenInToolId) => Promise<void>) | undefined;
}): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [pendingToolId, setPendingToolId] = useState<SystemOpenInToolId | null>(null);
  const [preferredToolId, setPreferredToolId] = useState<SystemOpenInToolId | null>(() =>
    readPreferredOpenInTool(),
  );
  const queryClient = useQueryClient();
  const toolsQuery = useQuery(openInToolsQueryOptions());
  const targetLabel = contextMode === "repository" ? "repository root" : "builder worktree";

  useEffect(() => {
    setPreferredToolId(readPreferredOpenInTool());
  }, []);

  const defaultTool = useMemo(() => {
    const tools = toolsQuery.data ?? [];
    if (tools.length === 0) {
      return null;
    }

    if (preferredToolId) {
      const preferredTool = tools.find((tool) => tool.toolId === preferredToolId);
      if (preferredTool) {
        return preferredTool;
      }
    }

    return tools[0] ?? null;
  }, [preferredToolId, toolsQuery.data]);
  const alternativeTools = useMemo(() => {
    const tools = toolsQuery.data ?? [];
    if (!defaultTool) {
      return tools;
    }

    return tools.filter((tool) => tool.toolId !== defaultTool.toolId);
  }, [defaultTool, toolsQuery.data]);
  const resolvedDisabledReason = resolveOpenInDisabledReason({
    contextMode,
    targetLabel,
    targetPath,
    disabledReason,
    onOpenInTool,
  });
  const isTriggerDisabled = resolvedDisabledReason != null;
  const hasMenuTrigger =
    alternativeTools.length > 0 ||
    toolsQuery.isPending ||
    toolsQuery.isError ||
    defaultTool == null;

  const handleOpenInTool = async (toolId: SystemOpenInToolId): Promise<void> => {
    if (!targetPath || !onOpenInTool) {
      return;
    }

    setPendingToolId(toolId);
    try {
      await onOpenInTool(toolId);
      persistPreferredOpenInTool(toolId);
      setPreferredToolId(toolId);
      setIsOpen(false);
    } catch (error) {
      toast.error(`Failed to open in ${getOpenInToolLabel(toolId)}`, {
        description: errorMessage(error),
      });
    } finally {
      setPendingToolId(null);
    }
  };

  const defaultToolLabel = defaultTool ? getOpenInToolLabel(defaultTool.toolId) : "Open In";
  const defaultToolIcon = defaultTool ? (
    <OpenInToolIcon tool={defaultTool} />
  ) : (
    <FolderOpen className="size-3.5" />
  );
  const defaultToolIsPending = defaultTool != null && pendingToolId === defaultTool.toolId;
  const defaultButton = renderOpenInDefaultButton({
    targetLabel,
    defaultToolLabel,
    defaultToolIcon,
    onClick: defaultTool ? () => void handleOpenInTool(defaultTool.toolId) : null,
    disabled: isTriggerDisabled,
    isPending: defaultToolIsPending,
    hasMenuTrigger,
  });
  const menuTrigger = renderOpenInMenuTriggerButton({ disabled: isTriggerDisabled });
  const trigger = hasMenuTrigger ? (
    <OpenInActionGroup>
      {defaultButton}
      {menuTrigger}
    </OpenInActionGroup>
  ) : (
    defaultButton
  );

  if (resolvedDisabledReason) {
    return <DisabledOpenInTrigger disabledReason={resolvedDisabledReason} trigger={trigger} />;
  }

  if (!hasMenuTrigger) {
    return defaultButton;
  }

  return (
    <OpenInActionGroup>
      {defaultButton}
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>{menuTrigger}</PopoverTrigger>
        <OpenInMenuBody>
          <div className="border-b border-border px-3 py-2">
            <p className="text-xs font-medium text-foreground">Other tools for {targetLabel}</p>
            <p
              className="mt-1 truncate text-[11px] text-muted-foreground"
              title={targetPath ?? undefined}
            >
              {targetPath ?? "Select a tool to continue."}
            </p>
          </div>

          {toolsQuery.isPending ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              <span>Looking for supported apps...</span>
            </div>
          ) : toolsQuery.isError ? (
            <div className="space-y-3 px-3 py-3" data-testid="agent-studio-git-open-in-error">
              <p className="text-sm text-foreground">Supported app discovery failed.</p>
              <p className="text-[11px] text-muted-foreground">{errorMessage(toolsQuery.error)}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => {
                  void refreshOpenInToolsFromQuery(queryClient);
                }}
              >
                <RefreshCw className="size-3.5" />
                Retry
              </Button>
            </div>
          ) : (
            <ScrollArea className="max-h-80">
              <div className="space-y-1 p-1">
                {alternativeTools.map((tool) => {
                  const isPending = pendingToolId === tool.toolId;

                  return (
                    <Button
                      key={tool.toolId}
                      type="button"
                      variant="ghost"
                      className="h-auto w-full justify-start px-2 py-2 text-left text-sm"
                      onClick={() => {
                        void handleOpenInTool(tool.toolId);
                      }}
                      disabled={pendingToolId !== null}
                      data-testid={`agent-studio-git-open-in-item-${tool.toolId}`}
                    >
                      <OpenInToolIcon tool={tool} />
                      <span className="min-w-0 flex-1 truncate">
                        {getOpenInToolLabel(tool.toolId)}
                      </span>
                      {isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                    </Button>
                  );
                })}
                {toolsQuery.data?.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">
                    No supported apps are currently available on this Mac.
                  </div>
                ) : null}
              </div>
            </ScrollArea>
          )}
        </OpenInMenuBody>
      </Popover>
    </OpenInActionGroup>
  );
}
