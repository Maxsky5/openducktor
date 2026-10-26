import { splitTaskDescriptionFrontMatter } from "@openducktor/frontend-core/tasks/description/task-description-front-matter";

export const prepareMarkdownRenderContent = (
  markdown: string,
  stripTaskDescriptionFrontMatter: boolean,
): string => {
  if (!stripTaskDescriptionFrontMatter) {
    return markdown.trim();
  }
  const frontMatter = splitTaskDescriptionFrontMatter(markdown);
  return (frontMatter.kind === "valid" ? frontMatter.body : markdown).trim();
};
