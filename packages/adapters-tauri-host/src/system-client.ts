import {
  type SystemOpenDirectoryInToolRequest,
  type SystemOpenInToolId,
  type SystemOpenInToolInfo,
  systemListOpenInToolsRequestSchema,
  systemOpenDirectoryInToolRequestSchema,
  systemOpenInToolInfoSchema,
} from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";
import { parseArray, parseOkResult } from "./invoke-utils";

const systemListOpenInTools = async (
  invokeFn: InvokeFn,
  forceRefresh = false,
): Promise<SystemOpenInToolInfo[]> => {
  const request = systemListOpenInToolsRequestSchema.parse({ forceRefresh });
  const payload = await invokeFn("system_list_open_in_tools", request);
  return parseArray(systemOpenInToolInfoSchema, payload, "system_list_open_in_tools");
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
  const payload = await invokeFn("system_open_directory_in_tool", request);
  parseOkResult(payload, "system_open_directory_in_tool");
};

export class TauriSystemClient {
  constructor(private readonly invokeFn: InvokeFn) {}

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
