import { prepareMarkdownRenderContent } from "@/components/ui/markdown-render-content";

export const TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS = 480;

export const buildTaskDescriptionPreviewMarkdown = (description: string): string => {
  const body = prepareMarkdownRenderContent(description, true);
  return body.slice(0, TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS);
};
