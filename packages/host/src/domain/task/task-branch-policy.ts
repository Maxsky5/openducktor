import { DEFAULT_BRANCH_PREFIX, type GitTargetBranch } from "@openducktor/contracts";

export const normalizeApprovalTargetBranch = (targetBranch: GitTargetBranch): GitTargetBranch => {
  const remote = targetBranch.remote?.trim();
  const branch = targetBranch.branch.trim();
  if (!branch) {
    throw new Error("Human approval requires a target branch.");
  }
  if (branch === "@{upstream}") {
    throw new Error(
      "Human approval requires an explicit target branch. '@{upstream}' is not supported for direct merge or pull requests.",
    );
  }

  return remote ? { remote, branch } : { branch };
};

export const publishTargetFromTargetBranch = (
  targetBranch: GitTargetBranch,
): GitTargetBranch | undefined => {
  const normalized = normalizeApprovalTargetBranch(targetBranch);
  return normalized.remote ? normalized : undefined;
};

export const slugifyTitle = (value: string): string => {
  let slug = "";
  for (const character of value) {
    if (/^[a-zA-Z0-9]$/.test(character)) {
      slug += character.toLowerCase();
      continue;
    }
    if ((/\s/.test(character) || character === "-" || character === "_") && !slug.endsWith("-")) {
      slug += "-";
    }
  }

  return slug.replace(/^-+|-+$/g, "").slice(0, 40);
};

export const buildBranchName = (prefix: string, taskId: string, title: string): string => {
  const cleanPrefix = prefix.trim().replace(/\/+$/g, "") || DEFAULT_BRANCH_PREFIX;
  const slug = slugifyTitle(title);
  return slug ? `${cleanPrefix}/${taskId}-${slug}` : `${cleanPrefix}/${taskId}`;
};

export const checkoutBranch = (targetBranch: GitTargetBranch): string => targetBranch.branch.trim();

export const canonicalTargetBranch = (targetBranch: GitTargetBranch): string => {
  const branch = checkoutBranch(targetBranch);
  const remote = targetBranch.remote?.trim();
  return remote ? `${remote}/${branch}` : branch;
};
