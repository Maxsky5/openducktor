import { normalizePathForComparison } from "./path-comparison";

export type RuntimeWorkspaceKeyInput = {
  runtimeKind: string;
  repoPath: string;
};

export const runtimeWorkspaceKey = ({ runtimeKind, repoPath }: RuntimeWorkspaceKeyInput): string =>
  `${runtimeKind}::${normalizePathForComparison(repoPath)}`;
