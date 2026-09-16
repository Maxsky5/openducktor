import { prepareMarkdownRenderContent } from "@/components/ui/markdown-render-content";

export const TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS = 480;

const isHighSurrogate = (codeUnit: number): boolean => codeUnit >= 0xd800 && codeUnit <= 0xdbff;

export const buildTaskDescriptionPreviewMarkdown = (description: string): string => {
  const body = prepareMarkdownRenderContent(description, true);
  const limit = TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS;
  const end = isHighSurrogate(body.charCodeAt(limit - 1)) ? limit - 1 : limit;
  return body.slice(0, end);
};
