import type { SystemOpenInToolId, SystemOpenInToolInfo } from "@openducktor/contracts";
import type { Effect } from "effect";
import type {
  HostOperationError,
  HostPathAccessError,
  HostPathNotFoundError,
  HostValidationError,
} from "../effect/host-errors";

export type OpenInToolsPortError =
  | HostOperationError
  | HostPathAccessError
  | HostPathNotFoundError
  | HostValidationError;

export type OpenInToolsPort = {
  canonicalizeDirectory(
    directoryPath: string,
  ): Effect.Effect<string, HostOperationError | HostPathAccessError | HostPathNotFoundError>;
  isDirectory(
    directoryPath: string,
  ): Effect.Effect<boolean, HostOperationError | HostPathAccessError>;
  discoverOpenInTools(): Effect.Effect<SystemOpenInToolInfo[], OpenInToolsPortError>;
  openDirectoryInTool(
    directoryPath: string,
    toolId: SystemOpenInToolId,
  ): Effect.Effect<void, OpenInToolsPortError>;
  openExternalUrl(url: string): Effect.Effect<void, OpenInToolsPortError>;
};
