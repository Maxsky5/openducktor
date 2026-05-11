import type { SystemOpenInToolId, SystemOpenInToolInfo } from "@openducktor/contracts";

export type OpenInToolsPort = {
  canonicalizeDirectory(directoryPath: string): Promise<string>;
  isDirectory(directoryPath: string): Promise<boolean>;
  discoverOpenInTools(): Promise<SystemOpenInToolInfo[]>;
  openDirectoryInTool(directoryPath: string, toolId: SystemOpenInToolId): Promise<void>;
};
