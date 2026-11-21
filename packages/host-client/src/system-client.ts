import {
  type AppPlatform,
  appPlatformSchema,
  type SystemOpenDirectoryInToolRequest,
  type SystemOpenInToolId,
  type SystemOpenInToolInfo,
  systemListOpenInToolsRequestSchema,
  systemOpenDirectoryInToolRequestSchema,
  systemOpenInToolInfoSchema,
  type WorkspaceProcessList,
  workspaceProcessListSchema,
  type WorkspaceProcessStopRequest,
  workspaceProcessStopRequestSchema,
  type WorkspaceProcessStopResponse,
  workspaceProcessStopResponseSchema,
} from "@openducktor/contracts";
import type { InvokeFn, InvokeOptions } from "./invoke-utils";
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

  /** Opens a URL in the system browser of the host machine. Only a local shell may send it. */
  async openExternalUrl(url: string): Promise<void> {
    await this.invokeFn("open_external_url", { url }, okResultSchema("open_external_url"));
  }

  /** Lists the processes of the open workspaces. Only a local shell may send it. */
  async workspaceProcessesList(options?: InvokeOptions): Promise<WorkspaceProcessList> {
    return this.invokeFn("workspace_processes_list", {}, workspaceProcessListSchema, options);
  }

  /** Stops processes after the host checks them again. Only a local shell may send it. */
  async workspaceProcessStop(
    request: WorkspaceProcessStopRequest,
  ): Promise<WorkspaceProcessStopResponse> {
    return this.invokeFn(
      "workspace_process_stop",
      workspaceProcessStopRequestSchema.parse(request),
      workspaceProcessStopResponseSchema,
    );
  }
}
