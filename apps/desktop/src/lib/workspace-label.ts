type WorkspaceLabelOptions = {
  includeParent?: boolean;
  parentDepth?: number;
};

const DEFAULT_PARENT_DEPTH = 2;

const workspaceSegments = (path: string): string[] => path.split("/").filter(Boolean);

export const workspaceNameFromPath = (path: string): string => {
  const segments = workspaceSegments(path);
  return segments.at(-1) ?? path;
};

export const workspaceLabelFromPath = (
  path: string,
  options: WorkspaceLabelOptions = {},
): string => {
  const { includeParent = false, parentDepth = DEFAULT_PARENT_DEPTH } = options;
  const segments = workspaceSegments(path);
  const repoName = segments.at(-1) ?? path;

  if (!includeParent || segments.length <= 1) {
    return repoName;
  }

  const parent = segments.slice(Math.max(0, segments.length - (parentDepth + 1)), -1).join("/");
  return parent ? `${repoName} (${parent})` : repoName;
};
