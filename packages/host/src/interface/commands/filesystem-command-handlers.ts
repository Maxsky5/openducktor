import {
  type FilesystemListDirectoryInput,
  filesystemListDirectoryInputSchema,
} from "@openducktor/contracts";
import type { FilesystemService } from "../../application/filesystem/filesystem-service";
import { HostValidationError } from "../../effect/host-errors";
import { defineHostCommandHandlers } from "../router/host-command-router";

const parseFilesystemListDirectoryArgs = (
  args: Record<string, unknown> | undefined,
): FilesystemListDirectoryInput => {
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
  defineHostCommandHandlers({
    filesystem_list_directory: (args) =>
      filesystemService.listDirectory(parseFilesystemListDirectoryArgs(args)),
  });
