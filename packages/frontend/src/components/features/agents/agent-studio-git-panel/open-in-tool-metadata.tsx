import type { SystemOpenInToolId, SystemOpenInToolInfo } from "@openducktor/contracts";
import { AppWindowMac, FolderOpen, Terminal } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

type OpenInToolUiMetadata = {
  label: string;
  fallbackKind: "finder" | "terminal" | "generic";
};

const OPEN_IN_TOOL_METADATA: Record<SystemOpenInToolId, OpenInToolUiMetadata> = {
  finder: { label: "Finder", fallbackKind: "finder" },
  terminal: { label: "Terminal", fallbackKind: "terminal" },
  iterm2: { label: "iTerm2", fallbackKind: "terminal" },
  ghostty: { label: "Ghostty", fallbackKind: "terminal" },
  vscode: { label: "VS Code", fallbackKind: "generic" },
  cursor: { label: "Cursor", fallbackKind: "generic" },
  zed: { label: "Zed", fallbackKind: "generic" },
  "intellij-idea": { label: "IntelliJ IDEA", fallbackKind: "generic" },
  webstorm: { label: "WebStorm", fallbackKind: "generic" },
  pycharm: { label: "PyCharm", fallbackKind: "generic" },
  phpstorm: { label: "PhpStorm", fallbackKind: "generic" },
  rider: { label: "Rider", fallbackKind: "generic" },
  rustrover: { label: "RustRover", fallbackKind: "generic" },
  "android-studio": { label: "Android Studio", fallbackKind: "generic" },
};

export function getOpenInToolLabel(toolId: SystemOpenInToolId): string {
  return OPEN_IN_TOOL_METADATA[toolId].label;
}

function fallbackIconForTool(toolId: SystemOpenInToolId) {
  const { fallbackKind } = OPEN_IN_TOOL_METADATA[toolId];

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
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground",
      )}
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
