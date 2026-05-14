import {
  type SystemOpenInToolInfo,
  systemListOpenInToolsRequestSchema,
  systemOpenDirectoryInToolRequestSchema,
  systemOpenInToolListSchema,
} from "@openducktor/contracts";
import type { OpenInToolsPort } from "../ports/open-in-tools-port";

const OPEN_IN_TOOL_CACHE_TTL_MS = 5 * 60 * 1000;

export type OpenInToolsService = {
  listOpenInTools(input: unknown): Promise<SystemOpenInToolInfo[]>;
  openDirectoryInTool(input: unknown): Promise<void>;
  openExternalUrl(input: unknown): Promise<void>;
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

const parseExternalUrl = (input: unknown): string => {
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : null;
  const rawUrl = record?.url;
  if (typeof rawUrl !== "string") {
    throw new Error("open_external_url input.url is required.");
  }

  const trimmed = rawUrl.trim();
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
      const request = systemListOpenInToolsRequestSchema.parse(input ?? {});
      const now = clock();

      if (!request.forceRefresh && cache && now - cache.checkedAtMs <= OPEN_IN_TOOL_CACHE_TTL_MS) {
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
      const request = systemOpenDirectoryInToolRequestSchema.parse(input);
      const directoryPath = await resolveDirectory(port, request.directoryPath);
      await port.openDirectoryInTool(directoryPath, request.toolId);
    },
    async openExternalUrl(input) {
      await port.openExternalUrl(parseExternalUrl(input));
    },
  };
};
