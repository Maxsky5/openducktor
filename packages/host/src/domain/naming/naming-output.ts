import {
  WORKSPACE_SESSION_GENERATED_TITLE_LIMIT,
  workspaceSessionBranchNameSchema,
} from "@openducktor/contracts";

/** The most words in a branch slug. */
const SLUG_WORD_LIMIT = 6;

/**
 * Lowercase words joined by hyphens, at most six. Marks are removed from letters, and every other
 * character separates words. Empty when the text has no letter or digit.
 */
export const toBranchSlug = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, SLUG_WORD_LIMIT)
    .join("-");

/**
 * The first line of a model title without wrapping quotes or a `Title:` label, at most
 * `WORKSPACE_SESSION_GENERATED_TITLE_LIMIT` characters.
 */
const cleanGeneratedTitle = (text: string): string => {
  let title = (text.trim().split(/\r\n|\r|\n/)[0] ?? "").trim();
  // A label can sit inside the quotes or outside them.
  for (let previous = ""; previous !== title;) {
    previous = title;
    title = title
      .replace(/^title\s*:\s*/i, "")
      .replace(/^(["'`“‘])(.*)(["'`”’])$/u, "$2")
      .trim();
  }
  if (!title) throw new Error("The naming model returned an empty title.");
  return Array.from(title).slice(0, WORKSPACE_SESSION_GENERATED_TITLE_LIMIT).join("").trim();
};

/**
 * A complete `type/slug` branch name. The type keeps its text, and the slug goes through the
 * branch slug rule. The full name must be a valid Git branch name.
 */
const cleanGeneratedBranch = (text: string): string => {
  const value = text.trim();
  const slash = value.lastIndexOf("/");
  const type = slash > 0 ? value.slice(0, slash).trim() : "";
  const slug = toBranchSlug(value.slice(slash + 1));
  if (!type || !slug)
    throw new Error(
      `The naming model returned "${value}", which is not a branch name in the form type/slug.`,
    );
  const branch = `${type}/${slug}`;
  if (!workspaceSessionBranchNameSchema.safeParse(branch).success)
    throw new Error(`The naming model returned "${value}", which is not a valid Git branch name.`);
  return branch;
};

/**
 * The answer of a naming model with a usable title and branch name: the first line of the title
 * without quotes or a label, and the branch slug through the branch slug rule. Throws an error that
 * says what is wrong with a field that cannot be used.
 */
export const cleanNamingAnswer = <A extends { title?: string; branch?: string }>(answer: A): A => {
  const cleaned = { ...answer };
  if (cleaned.title !== undefined) cleaned.title = cleanGeneratedTitle(cleaned.title);
  if (cleaned.branch !== undefined) cleaned.branch = cleanGeneratedBranch(cleaned.branch);
  return cleaned;
};
