import type { FilesystemService } from "../../application/filesystem/filesystem-service";
import type { HostCommandHandlers } from "../router/host-command-router";

type FilesystemListDirectoryArgs = {
  path?: unknown;
};

const parseFilesystemListDirectoryArgs = (
  args: Record<string, unknown> | undefined,
): { path?: string } => {
  const { path } = (args ?? {}) as FilesystemListDirectoryArgs;
  if (path === undefined) {
    return {};
  }

  if (typeof path !== "string") {
    throw new Error("filesystem_list_directory expects optional string argument 'path'.");
  }

  return { path };
};

export const createFilesystemCommandHandlers = (
  filesystemService: FilesystemService,
): HostCommandHandlers => ({
  filesystem_list_directory: (args) =>
    filesystemService.listDirectory(parseFilesystemListDirectoryArgs(args)),
});
