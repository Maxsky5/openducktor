import { execFile } from "node:child_process";
import { access, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SystemOpenInToolId, SystemOpenInToolInfo } from "@openducktor/contracts";
import type { OpenInToolsPort } from "../ports/open-in-tools-port";

const execFileAsync = promisify(execFile);

type OpenInLaunchStrategy = "open-directory" | "editor" | "jetbrains";

type OpenInToolMetadata = {
  id: SystemOpenInToolId;
  label: string;
  appNames: string[];
  launchStrategy: OpenInLaunchStrategy;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

export type OpenInCommandRunner = (
  program: string,
  args: string[],
  options?: { cwd?: string },
) => Promise<CommandResult>;

export type CreateNodeOpenInToolsPortInput = {
  platform?: NodeJS.Platform;
  runner?: OpenInCommandRunner;
  pathExists?: (inputPath: string) => Promise<boolean>;
  pathIsDirectory?: (inputPath: string) => Promise<boolean>;
  homeDirectory?: () => string;
  realpathFn?: (inputPath: string) => Promise<string>;
};

const OPEN_IN_TOOL_CATALOG: OpenInToolMetadata[] = [
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

const defaultRunner: OpenInCommandRunner = async (program, args, options) => {
  const output = await execFileAsync(program, args, {
    cwd: options?.cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    stdout: output.stdout,
    stderr: output.stderr,
  };
};

const defaultPathExists = async (inputPath: string): Promise<boolean> => {
  try {
    await access(inputPath);
    return true;
  } catch {
    return false;
  }
};

const defaultPathIsDirectory = async (inputPath: string): Promise<boolean> => {
  const metadata = await stat(inputPath);
  return metadata.isDirectory();
};

const bundleNameForApp = (appName: string): string =>
  appName.endsWith(".app") ? appName : `${appName}.app`;

const candidateApplicationPaths = (appName: string, homeDirectory: () => string): string[] => {
  const bundleName = bundleNameForApp(appName);
  return [
    `/Applications/${bundleName}`,
    `/System/Applications/${bundleName}`,
    `/System/Applications/Utilities/${bundleName}`,
    `/System/Library/CoreServices/${bundleName}`,
    path.join(homeDirectory(), "Applications", bundleName),
  ];
};

const metadataForTool = (toolId: SystemOpenInToolId): OpenInToolMetadata => {
  const metadata = OPEN_IN_TOOL_CATALOG.find((candidate) => candidate.id === toolId);
  if (!metadata) {
    throw new Error(`Unsupported Open In tool: ${toolId}`);
  }
  return metadata;
};

const ensureMacOs = (platform: NodeJS.Platform, operation: string) => {
  if (platform !== "darwin") {
    throw new Error(`${operation} is only supported on macOS.`);
  }
};

const buildLaunchArgs = (
  metadata: OpenInToolMetadata,
  appPath: string,
  directoryPath: string,
): string[] => {
  if (metadata.launchStrategy === "jetbrains") {
    return ["-na", appPath, "--args", directoryPath];
  }

  return ["-a", appPath, directoryPath];
};

export const createNodeOpenInToolsPort = ({
  platform = process.platform,
  runner = defaultRunner,
  pathExists = defaultPathExists,
  pathIsDirectory = defaultPathIsDirectory,
  homeDirectory = homedir,
  realpathFn = realpath,
}: CreateNodeOpenInToolsPortInput = {}): OpenInToolsPort => {
  const resolveApplicationPathByName = async (appName: string): Promise<string | null> => {
    for (const candidate of candidateApplicationPaths(appName, homeDirectory)) {
      if (await pathExists(candidate)) {
        return candidate;
      }
    }

    const bundleName = bundleNameForApp(appName);
    const output = await runner("mdfind", ["-name", bundleName]).catch((error: unknown) => {
      throw new Error(`Failed to discover application path for ${bundleName}: ${String(error)}`, {
        cause: error,
      });
    });

    for (const line of output.stdout.split(/\r?\n/)) {
      const candidate = line.trim();
      if (
        candidate.length > 0 &&
        candidate.toLowerCase().endsWith(".app") &&
        (await pathIsDirectory(candidate))
      ) {
        return candidate;
      }
    }

    return null;
  };

  const resolveApplicationPath = async (metadata: OpenInToolMetadata): Promise<string | null> => {
    for (const appName of metadata.appNames) {
      const appPath = await resolveApplicationPathByName(appName);
      if (appPath) {
        return appPath;
      }
    }

    return null;
  };

  return {
    canonicalizeDirectory(directoryPath) {
      return realpathFn(directoryPath);
    },
    isDirectory(directoryPath) {
      return pathIsDirectory(directoryPath);
    },
    async discoverOpenInTools() {
      ensureMacOs(platform, "Open In tool discovery");

      const tools: SystemOpenInToolInfo[] = [];
      for (const metadata of OPEN_IN_TOOL_CATALOG) {
        if (await resolveApplicationPath(metadata)) {
          tools.push({ toolId: metadata.id, iconDataUrl: null });
        }
      }

      return tools;
    },
    async openDirectoryInTool(directoryPath, toolId) {
      ensureMacOs(platform, "Opening directories in external tools");

      const metadata = metadataForTool(toolId);
      const appPath = await resolveApplicationPath(metadata);
      if (!appPath) {
        throw new Error(
          `${metadata.label} is not installed or is no longer discoverable on this Mac.`,
        );
      }

      await runner("open", buildLaunchArgs(metadata, appPath, directoryPath)).catch(
        (error: unknown) => {
          throw new Error(
            `Failed to open ${directoryPath} in ${metadata.label}: ${String(error)}`,
            {
              cause: error,
            },
          );
        },
      );
    },
  };
};
