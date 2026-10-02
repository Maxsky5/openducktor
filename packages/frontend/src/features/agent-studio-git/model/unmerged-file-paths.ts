import type { FileStatus } from "@openducktor/contracts";

export const collectUnmergedFilePaths = (fileStatuses: readonly FileStatus[]): string[] => {
  const paths: string[] = [];
  for (const status of fileStatuses) {
    if (status.status === "unmerged") {
      paths.push(status.path);
    }
  }
  return paths;
};
