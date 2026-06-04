import type { SystemOpenInToolId } from "@openducktor/contracts";

export type OpenInToolFallbackKind = "finder" | "terminal" | "generic";

type OpenInToolUiMetadata = {
  label: string;
  fallbackKind: OpenInToolFallbackKind;
};

const OPEN_IN_TOOL_METADATA: Record<SystemOpenInToolId, OpenInToolUiMetadata> = {
  finder: { label: "Finder", fallbackKind: "finder" },
  explorer: { label: "File Explorer", fallbackKind: "finder" },
  "xdg-open": { label: "Files", fallbackKind: "finder" },
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

export function getOpenInToolFallbackKind(toolId: SystemOpenInToolId): OpenInToolFallbackKind {
  return OPEN_IN_TOOL_METADATA[toolId].fallbackKind;
}
