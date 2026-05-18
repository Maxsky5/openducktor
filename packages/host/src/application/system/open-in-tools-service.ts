import {
  type SystemListOpenInToolsRequest,
  type SystemOpenDirectoryInToolRequest,
  type SystemOpenInToolInfo,
  systemOpenInToolListSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { OpenInToolsPort, OpenInToolsPortError } from "../../ports/open-in-tools-port";

const OPEN_IN_TOOL_CACHE_TTL_MS = 5 * 60 * 1000;
export type OpenInToolsServiceError =
  | HostOperationError
  | HostValidationError
  | OpenInToolsPortError;

export type OpenInToolsService = {
  listOpenInTools(
    input: SystemListOpenInToolsRequest,
  ): Effect.Effect<SystemOpenInToolInfo[], OpenInToolsServiceError>;
  openDirectoryInTool(
    input: SystemOpenDirectoryInToolRequest,
  ): Effect.Effect<void, OpenInToolsServiceError>;
  openExternalUrl(input: OpenExternalUrlInput): Effect.Effect<void, OpenInToolsServiceError>;
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
const resolveDirectory = (port: OpenInToolsPort, directoryPath: string) =>
  Effect.gen(function* () {
    const canonicalPath = yield* port.canonicalizeDirectory(directoryPath).pipe(
      Effect.mapError(
        (error) =>
          new HostValidationError({
            message: `Directory does not exist: ${directoryPath}`,
            field: "directoryPath",
            cause: error,
          }),
      ),
    );
    if (!(yield* port.isDirectory(canonicalPath))) {
      return yield* Effect.fail(
        new HostValidationError({
          message: `Path is not a directory: ${directoryPath}`,
          field: "directoryPath",
        }),
      );
    }
    return canonicalPath;
  });
const validateExternalUrl = (url: string): string => {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new HostValidationError({ field: "url", message: "Cannot open an empty URL." });
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HostValidationError({
      field: "url",
      message: "Only http and https URLs can be opened from OpenDucktor.",
    });
  }
  return parsed.href;
};
export const createOpenInToolsService = (
  port: OpenInToolsPort,
  { clock = Date.now }: CreateOpenInToolsServiceInput = {},
): OpenInToolsService => {
  let cache: CachedOpenInTools | null = null;
  return {
    listOpenInTools(input) {
      return Effect.gen(function* () {
        const now = clock();
        if (!input.forceRefresh && cache && now - cache.checkedAtMs <= OPEN_IN_TOOL_CACHE_TTL_MS) {
          return cache.tools;
        }
        const tools = yield* port.discoverOpenInTools().pipe(
          Effect.flatMap((value) =>
            Effect.try({
              try: () => systemOpenInToolListSchema.parse(value),
              catch: (cause) =>
                new HostValidationError({
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause,
                  details: {
                    operation: "open_in_tools.list.parse",
                  },
                }),
            }),
          ),
        );
        cache = {
          checkedAtMs: now,
          tools,
        };
        return tools;
      });
    },
    openDirectoryInTool(input) {
      return Effect.gen(function* () {
        const directoryPath = yield* resolveDirectory(port, input.directoryPath);
        yield* port.openDirectoryInTool(directoryPath, input.toolId);
      });
    },
    openExternalUrl(input) {
      return Effect.gen(function* () {
        const url = yield* Effect.try({
          try: () => validateExternalUrl(input.url),
          catch: (cause) =>
            new HostValidationError({
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
              details: {
                field: "url",
              },
            }),
        }).pipe(
          Effect.mapError(
            (error) =>
              new HostOperationError({
                operation: "open_in_tools.validate_external_url",
                message: error.message,
                cause: error,
              }),
          ),
        );
        yield* port.openExternalUrl(url);
      });
    },
  };
};
