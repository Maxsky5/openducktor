import { z } from "zod";

export const directoryEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  isDirectory: z.boolean(),
  isGitRepo: z.boolean(),
});
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>;

export const directoryListingSchema = z.object({
  currentPath: z.string().min(1),
  parentPath: z.string().nullable(),
  homePath: z.string().nullable(),
  entries: z.array(directoryEntrySchema),
});
export type DirectoryListing = z.infer<typeof directoryListingSchema>;
