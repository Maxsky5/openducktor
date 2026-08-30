import type { SystemOpenInToolId, SystemOpenInToolInfo } from "@openducktor/contracts";
import { Context, type Effect } from "effect";
import type {
  HostOperationErrorAggregate,
  HostPathAccessErrorAggregate,
  HostPathNotFoundErrorAggregate,
  HostValidationErrorAggregate,
} from "../effect/host-errors";

export type OpenInToolsPortError =
  | HostOperationErrorAggregate
  | HostPathAccessErrorAggregate
  | HostPathNotFoundErrorAggregate
  | HostValidationErrorAggregate;

export type OpenInToolsPort = {
  canonicalizeDirectory(
    directoryPath: string,
  ): Effect.Effect<
    string,
    HostOperationErrorAggregate | HostPathAccessErrorAggregate | HostPathNotFoundErrorAggregate
  >;
  isDirectory(
    directoryPath: string,
  ): Effect.Effect<boolean, HostOperationErrorAggregate | HostPathAccessErrorAggregate>;
  discoverOpenInTools(): Effect.Effect<SystemOpenInToolInfo[], OpenInToolsPortError>;
  openDirectoryInTool(
    directoryPath: string,
    toolId: SystemOpenInToolId,
  ): Effect.Effect<void, OpenInToolsPortError>;
  openExternalUrl(url: string): Effect.Effect<void, OpenInToolsPortError>;
};

export class OpenInToolsPortTag extends Context.Tag("@openducktor/host/OpenInToolsPort")<
  OpenInToolsPortTag,
  OpenInToolsPort
>() {}
