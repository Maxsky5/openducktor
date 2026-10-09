import {
  type FilesystemListDirectoryInput,
  filesystemListDirectoryInputSchema,
  filesystemResolvePathInputSchema,
} from "@openducktor/contracts";
import type { FilesystemService } from "../../application/filesystem/filesystem-service";
import { HostValidationError } from "../../effect/host-errors";
import type { HostCommandHandlerDefinitions } from "../router/host-command-router";
import { parseCommandInput, type HostCommandArgs } from "./command-inputs";

const parseFilesystemListDirectoryArgs = (args: HostCommandArgs): FilesystemListDirectoryInput => {
  const parsed = filesystemListDirectoryInputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    throw new HostValidationError({
      message: "filesystem_list_directory received invalid arguments.",
      details: parsed.error.flatten(),
    });
  }
  return parsed.data;
};

export const createFilesystemCommandHandlers = (filesystemService: FilesystemService) =>
  ({
    filesystem_resolve_path: (args) =>
      filesystemService.resolvePath(
        parseCommandInput(filesystemResolvePathInputSchema, args, "filesystem_resolve_path").path,
      ),
    filesystem_list_directory: (args) =>
      filesystemService.listDirectory(parseFilesystemListDirectoryArgs(args)),
  }) satisfies HostCommandHandlerDefinitions;
