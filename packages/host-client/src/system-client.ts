import {
  type AppPlatform,
  appPlatformSchema,
  type SystemOpenDirectoryInToolRequest,
  type SystemOpenInToolId,
  type SystemOpenInToolInfo,
  systemListOpenInToolsRequestSchema,
  systemOpenDirectoryInToolRequestSchema,
  systemOpenInToolInfoSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { arrayResultSchema, okResultSchema } from "./invoke-utils";

const systemListOpenInTools = async (
  invokeFn: InvokeFn,
  forceRefresh = false,
): Promise<SystemOpenInToolInfo[]> => {
  const request = systemListOpenInToolsRequestSchema.parse({ forceRefresh });
  return invokeFn(
    "system_list_open_in_tools",
    request,
    arrayResultSchema(systemOpenInToolInfoSchema, "system_list_open_in_tools"),
  );
};

const systemOpenDirectoryInTool = async (
  invokeFn: InvokeFn,
  directoryPath: string,
  toolId: SystemOpenInToolId,
): Promise<void> => {
  const request: SystemOpenDirectoryInToolRequest = systemOpenDirectoryInToolRequestSchema.parse({
    directoryPath,
    toolId,
  });
  await invokeFn(
    "system_open_directory_in_tool",
    request,
    okResultSchema("system_open_directory_in_tool"),
  );
};

const systemGetPlatform = async (invokeFn: InvokeFn): Promise<AppPlatform> => {
  return invokeFn("system_get_platform", undefined, appPlatformSchema);
};

export class HostSystemClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async systemGetPlatform(): Promise<AppPlatform> {
    return systemGetPlatform(this.invokeFn);
  }

  async systemListOpenInTools(forceRefresh = false): Promise<SystemOpenInToolInfo[]> {
    return systemListOpenInTools(this.invokeFn, forceRefresh);
  }

  async systemOpenDirectoryInTool(
    directoryPath: string,
    toolId: SystemOpenInToolId,
  ): Promise<void> {
    return systemOpenDirectoryInTool(this.invokeFn, directoryPath, toolId);
  }
}
