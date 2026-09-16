import { prepareMarkdownRenderContent } from "@/components/ui/markdown-render-content";

export const TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS = 480;

const IMAGE_TOKEN_START = "![";

const isHighSurrogate = (codeUnit: number): boolean => codeUnit >= 0xd800 && codeUnit <= 0xdbff;

const completeImageToken = (body: string, end: number): string => {
  const bounded = body.slice(0, end);
  const imageStart = bounded.lastIndexOf(IMAGE_TOKEN_START);
  if (imageStart === -1 || bounded.includes(")", imageStart)) {
    return bounded;
  }
  const closeIndex = body.indexOf(")", end);
  if (closeIndex === -1) {
    return bounded.slice(0, imageStart);
  }
  return body.slice(0, closeIndex + 1);
};

export const buildTaskDescriptionPreviewMarkdown = (description: string): string => {
  const body = prepareMarkdownRenderContent(description, true);
  const limit = TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS;
  const end = isHighSurrogate(body.charCodeAt(limit - 1)) ? limit - 1 : limit;
  return completeImageToken(body, end);
};
