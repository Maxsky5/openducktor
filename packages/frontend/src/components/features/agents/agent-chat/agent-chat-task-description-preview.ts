import { prepareMarkdownRenderContent } from "@/components/ui/markdown-renderer-context";

export const TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS = 480;

const FENCE_LINE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

const dropOpenFence = (markdown: string): string => {
  const lines = markdown.split("\n");
  let openFence: string | null = null;
  let openFenceLine = -1;
  for (const [index, line] of lines.entries()) {
    const marker = FENCE_LINE_PATTERN.exec(line)?.[1];
    if (marker === undefined) {
      continue;
    }
    if (openFence === null) {
      openFence = marker;
      openFenceLine = index;
    } else if (marker.charAt(0) === openFence.charAt(0) && marker.length >= openFence.length) {
      openFence = null;
      openFenceLine = -1;
    }
  }
  if (openFenceLine < 0) {
    return markdown;
  }
  return lines.slice(0, openFenceLine).join("\n").trimEnd();
};

export const buildTaskDescriptionPreviewMarkdown = (description: string): string => {
  const body = prepareMarkdownRenderContent(description, true);
  if (body.length <= TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS) {
    return dropOpenFence(body);
  }
  return dropOpenFence(body.slice(0, TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS));
};
