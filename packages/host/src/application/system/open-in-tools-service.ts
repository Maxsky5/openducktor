import {
  type SystemListOpenInToolsRequest,
  type SystemOpenDirectoryInToolRequest,
  type SystemOpenInToolInfo,
  systemOpenInToolListSchema,
} from "@openducktor/contracts";
import type { OpenInToolsPort } from "../../ports/open-in-tools-port";

const OPEN_IN_TOOL_CACHE_TTL_MS = 5 * 60 * 1000;

export type OpenInToolsService = {
  listOpenInTools(input: SystemListOpenInToolsRequest): Promise<SystemOpenInToolInfo[]>;
  openDirectoryInTool(input: SystemOpenDirectoryInToolRequest): Promise<void>;
  openExternalUrl(input: OpenExternalUrlInput): Promise<void>;
};

export type OpenExternalUrlInput = {
  url: string;
};

type CachedOpenInTools = {
  checkedAtMs: number;
  tools: SystemOpenInToolInfo[];
};

export type CreateOpenInToolsServiceInput = {
  clock?: () => number;
};

const resolveDirectory = async (port: OpenInToolsPort, directoryPath: string): Promise<string> => {
  const canonicalPath = await port.canonicalizeDirectory(directoryPath).catch((error: unknown) => {
    throw new Error(`Directory does not exist: ${directoryPath}`, { cause: error });
  });

  if (!(await port.isDirectory(canonicalPath))) {
    throw new Error(`Path is not a directory: ${directoryPath}`);
  }

  return canonicalPath;
};

const validateExternalUrl = (url: string): string => {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Cannot open an empty URL.");
  }

  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs can be opened from OpenDucktor.");
  }

  return parsed.href;
};

export const createOpenInToolsService = (
  port: OpenInToolsPort,
  { clock = Date.now }: CreateOpenInToolsServiceInput = {},
): OpenInToolsService => {
  let cache: CachedOpenInTools | null = null;

  return {
    async listOpenInTools(input) {
      const now = clock();

      if (!input.forceRefresh && cache && now - cache.checkedAtMs <= OPEN_IN_TOOL_CACHE_TTL_MS) {
        return cache.tools;
      }

      const tools = systemOpenInToolListSchema.parse(await port.discoverOpenInTools());
      cache = {
        checkedAtMs: now,
        tools,
      };
      return tools;
    },
    async openDirectoryInTool(input) {
      const directoryPath = await resolveDirectory(port, input.directoryPath);
      await port.openDirectoryInTool(directoryPath, input.toolId);
    },
    async openExternalUrl(input) {
      await port.openExternalUrl(validateExternalUrl(input.url));
    },
  };
};
