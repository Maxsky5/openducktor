import { splitTaskDescriptionFrontMatter } from "@/components/features/task-description-editor/task-description-front-matter";

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
