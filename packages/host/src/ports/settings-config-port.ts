import type { GlobalConfig } from "@openducktor/contracts";

export type SettingsConfigPort = {
  readConfig(): Promise<unknown | null>;
  writeConfig(config: GlobalConfig): Promise<void>;
  defaultWorktreeBasePath(workspaceId: string): string;
  defaultRepoWorktreeBasePath(repoPath: string): string;
  resolveConfiguredPath(rawPath: string): string;
  canonicalizePath(rawPath: string): Promise<string>;
  pathExists(path: string): Promise<boolean>;
  join(...paths: string[]): string;
};
