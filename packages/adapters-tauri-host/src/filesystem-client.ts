import { type DirectoryListing, directoryListingSchema } from "@openducktor/contracts";
import type { InvokeFn } from "./invoke-utils";

const filesystemListDirectory = async (
  invokeFn: InvokeFn,
  path?: string,
): Promise<DirectoryListing> => {
  const payload = await invokeFn("filesystem_list_directory", path ? { path } : undefined);
  return directoryListingSchema.parse(payload);
};

export class TauriFilesystemClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  async filesystemListDirectory(path?: string): Promise<DirectoryListing> {
    return filesystemListDirectory(this.invokeFn, path);
  }
}
