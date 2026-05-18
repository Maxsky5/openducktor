import type { GlobalConfig } from "@openducktor/contracts";
import { Context, type Effect } from "effect";
import type {
  HostOperationError,
  HostPathAccessError,
  HostValidationError,
} from "../effect/host-errors";

export type SettingsConfigError = HostOperationError | HostPathAccessError | HostValidationError;

export type SettingsConfigPort = {
  readConfig(): Effect.Effect<GlobalConfig | null, SettingsConfigError>;
  writeConfig(config: GlobalConfig): Effect.Effect<void, HostOperationError>;
  defaultWorktreeBasePath(workspaceId: string): string;
  defaultRepoWorktreeBasePath(repoPath: string): string;
  resolveConfiguredPath(rawPath: string): string;
  canonicalizePath(rawPath: string): Effect.Effect<string, HostOperationError>;
  pathExists(path: string): Effect.Effect<boolean, HostPathAccessError>;
  join(...paths: string[]): string;
};

export class SettingsConfigPortTag extends Context.Tag("@openducktor/host/SettingsConfigPort")<
  SettingsConfigPortTag,
  SettingsConfigPort
>() {}
