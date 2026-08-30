import type { GlobalConfig } from "@openducktor/contracts";
import { Context, type Effect } from "effect";
import type {
  HostOperationErrorAggregate,
  HostPathAccessErrorAggregate,
  HostValidationErrorAggregate,
} from "../effect/host-errors";

export type SettingsConfigError =
  | HostOperationErrorAggregate
  | HostPathAccessErrorAggregate
  | HostValidationErrorAggregate;

export type SettingsConfigPort = {
  readConfig(): Effect.Effect<GlobalConfig | null, SettingsConfigError>;
  writeConfig(config: GlobalConfig): Effect.Effect<void, HostOperationErrorAggregate>;
  defaultWorktreeBasePath(workspaceId: string): string;
  defaultRepoWorktreeBasePath(repoPath: string): string;
  resolveConfiguredPath(rawPath: string): string;
  canonicalizePath(rawPath: string): Effect.Effect<string, HostOperationErrorAggregate>;
  pathExists(path: string): Effect.Effect<boolean, HostPathAccessErrorAggregate>;
  join(...paths: string[]): string;
};

export class SettingsConfigPortTag extends Context.Tag("@openducktor/host/SettingsConfigPort")<
  SettingsConfigPortTag,
  SettingsConfigPort
>() {}
