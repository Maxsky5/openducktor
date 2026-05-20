import type { SystemOpenInToolId } from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";

export type OpenInLaunchStrategy = "open-directory" | "editor" | "jetbrains";

export type MacOpenInToolMetadata = {
  id: SystemOpenInToolId;
  label: string;
  appNames: string[];
  launchStrategy: OpenInLaunchStrategy;
};

export type CommandOpenInToolMetadata = {
  id: SystemOpenInToolId;
  label: string;
  platforms: NodeJS.Platform[];
  commands: string[];
  args?: (directoryPath: string, command: string) => string[];
};

export const MAC_OPEN_IN_TOOL_CATALOG: MacOpenInToolMetadata[] = [
  { id: "finder", label: "Finder", appNames: ["Finder"], launchStrategy: "open-directory" },
  { id: "terminal", label: "Terminal", appNames: ["Terminal"], launchStrategy: "open-directory" },
  {
    id: "iterm2",
    label: "iTerm2",
    appNames: ["iTerm2", "iTerm"],
    launchStrategy: "open-directory",
  },
  { id: "ghostty", label: "Ghostty", appNames: ["Ghostty"], launchStrategy: "open-directory" },
  { id: "vscode", label: "VS Code", appNames: ["Visual Studio Code"], launchStrategy: "editor" },
  { id: "cursor", label: "Cursor", appNames: ["Cursor"], launchStrategy: "editor" },
  { id: "zed", label: "Zed", appNames: ["Zed"], launchStrategy: "editor" },
  {
    id: "intellij-idea",
    label: "IntelliJ IDEA",
    appNames: ["IntelliJ IDEA", "IntelliJ IDEA CE"],
    launchStrategy: "jetbrains",
  },
  { id: "webstorm", label: "WebStorm", appNames: ["WebStorm"], launchStrategy: "jetbrains" },
  {
    id: "pycharm",
    label: "PyCharm",
    appNames: ["PyCharm", "PyCharm CE"],
    launchStrategy: "jetbrains",
  },
  { id: "phpstorm", label: "PhpStorm", appNames: ["PhpStorm"], launchStrategy: "jetbrains" },
  { id: "rider", label: "Rider", appNames: ["Rider"], launchStrategy: "jetbrains" },
  { id: "rustrover", label: "RustRover", appNames: ["RustRover"], launchStrategy: "jetbrains" },
  {
    id: "android-studio",
    label: "Android Studio",
    appNames: ["Android Studio"],
    launchStrategy: "jetbrains",
  },
];

export const COMMAND_OPEN_IN_TOOL_CATALOG: CommandOpenInToolMetadata[] = [
  {
    id: "explorer",
    label: "File Explorer",
    platforms: ["win32"],
    commands: ["explorer.exe"],
  },
  {
    id: "xdg-open",
    label: "Files",
    platforms: ["linux"],
    commands: ["xdg-open"],
  },
  {
    id: "terminal",
    label: "Terminal",
    platforms: ["win32"],
    commands: ["wt.exe", "wt"],
    args: (directoryPath) => ["-d", directoryPath],
  },
  {
    id: "terminal",
    label: "Terminal",
    platforms: ["linux"],
    commands: ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal"],
    args: (directoryPath, command) => {
      if (command === "gnome-terminal") {
        return [`--working-directory=${directoryPath}`];
      }
      if (command === "konsole") {
        return ["--workdir", directoryPath];
      }
      if (command === "xfce4-terminal") {
        return ["--working-directory", directoryPath];
      }
      return [];
    },
  },
  {
    id: "vscode",
    label: "VS Code",
    platforms: ["win32", "linux"],
    commands: ["code"],
  },
  {
    id: "cursor",
    label: "Cursor",
    platforms: ["win32", "linux"],
    commands: ["cursor"],
  },
  {
    id: "zed",
    label: "Zed",
    platforms: ["win32", "linux"],
    commands: ["zed"],
  },
  {
    id: "intellij-idea",
    label: "IntelliJ IDEA",
    platforms: ["win32", "linux"],
    commands: ["idea"],
  },
  {
    id: "webstorm",
    label: "WebStorm",
    platforms: ["win32", "linux"],
    commands: ["webstorm"],
  },
  {
    id: "pycharm",
    label: "PyCharm",
    platforms: ["win32", "linux"],
    commands: ["pycharm"],
  },
  {
    id: "phpstorm",
    label: "PhpStorm",
    platforms: ["win32", "linux"],
    commands: ["phpstorm"],
  },
  {
    id: "rider",
    label: "Rider",
    platforms: ["win32", "linux"],
    commands: ["rider"],
  },
  {
    id: "rustrover",
    label: "RustRover",
    platforms: ["win32", "linux"],
    commands: ["rustrover"],
  },
  {
    id: "android-studio",
    label: "Android Studio",
    platforms: ["win32", "linux"],
    commands: ["studio"],
  },
];

export const macMetadataForTool = (toolId: SystemOpenInToolId): MacOpenInToolMetadata => {
  const metadata = MAC_OPEN_IN_TOOL_CATALOG.find((candidate) => candidate.id === toolId);
  if (!metadata) {
    throw new HostValidationError({
      field: "toolId",
      message: `Unsupported Open In tool: ${toolId}`,
      details: { toolId },
    });
  }
  return metadata;
};

export const commandMetadataForTool = (
  toolId: SystemOpenInToolId,
  platform: NodeJS.Platform,
): CommandOpenInToolMetadata => {
  const metadata = COMMAND_OPEN_IN_TOOL_CATALOG.find(
    (candidate) => candidate.id === toolId && candidate.platforms.includes(platform),
  );
  if (!metadata) {
    throw new HostValidationError({
      field: "toolId",
      message: `Unsupported Open In tool ${toolId} on ${platform}.`,
      details: { toolId, platform },
    });
  }

  return metadata;
};
