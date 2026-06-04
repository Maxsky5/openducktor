import type { SystemOpenInToolId, SystemOpenInToolInfo } from "@openducktor/contracts";
import { AppWindowMac, FolderOpen, Terminal } from "lucide-react";
import type { ReactElement } from "react";
import { getOpenInToolFallbackKind } from "./open-in-tool-metadata-model";

function fallbackIconForTool(toolId: SystemOpenInToolId) {
  const fallbackKind = getOpenInToolFallbackKind(toolId);

  if (fallbackKind === "finder") {
    return FolderOpen;
  }

  if (fallbackKind === "terminal") {
    return Terminal;
  }

  return AppWindowMac;
}

function OpenInFallbackIcon({ toolId }: { toolId: SystemOpenInToolId }): ReactElement {
  const Icon = fallbackIconForTool(toolId);

  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground"
      data-testid={`agent-studio-git-open-in-icon-${toolId}`}
      aria-hidden="true"
    >
      <Icon className="size-3.5" />
    </span>
  );
}

export function OpenInToolIcon({ tool }: { tool: SystemOpenInToolInfo }): ReactElement {
  if (tool.iconDataUrl) {
    return (
      <img
        src={tool.iconDataUrl}
        alt=""
        className="size-6 shrink-0 rounded-md"
        data-testid={`agent-studio-git-open-in-icon-${tool.toolId}`}
        aria-hidden="true"
      />
    );
  }

  return <OpenInFallbackIcon toolId={tool.toolId} />;
}
