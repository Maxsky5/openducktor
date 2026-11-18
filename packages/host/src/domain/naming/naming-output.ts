import {
  WORKSPACE_SESSION_GENERATED_TITLE_LIMIT,
  workspaceSessionBranchNameSchema,
} from "@openducktor/contracts";
import { z } from "zod";

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

/** The fields that a naming request asks for, as the model returned them. */
export type NamingOutputFields = { title?: string; branch?: string };

/** The answer fields. A field that the request did not ask for can be missing. */
const namingAnswerSchema = z.object({
  title: z.string().optional(),
  branch: z.string().optional(),
});

/**
 * Reads the JSON object of a model answer. A model can wrap it in a Markdown code fence or add a
 * sentence, so the object is the text from the first `{` to the last `}`.
 */
const readAnswer = (text: string): z.infer<typeof namingAnswerSchema> => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start)
    throw new Error("The naming model did not return a JSON object.");
  let value: unknown;
  try {
    value = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The naming model returned JSON that does not parse.");
  }
  const parsed = namingAnswerSchema.safeParse(value);
  if (!parsed.success) throw new Error("The naming model returned fields that are not text.");
  return parsed.data;
};

const requireField = (value: string | undefined, key: "title" | "branch"): string => {
  if (value === undefined) throw new Error(`The naming model returned no "${key}" text.`);
  return value;
};

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

/** Reads the requested fields of a model answer, or throws an error that says what is wrong with it. */
export const parseNamingOutput = (
  text: string,
  outputs: { title: boolean; branch: boolean },
): NamingOutputFields => {
  const answer = readAnswer(text);
  const fields: NamingOutputFields = {};
  if (outputs.title) fields.title = cleanGeneratedTitle(requireField(answer.title, "title"));
  if (outputs.branch) fields.branch = cleanGeneratedBranch(requireField(answer.branch, "branch"));
  return fields;
};
