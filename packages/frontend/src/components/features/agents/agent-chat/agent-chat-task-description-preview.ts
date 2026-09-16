import { prepareMarkdownRenderContent } from "@/components/ui/markdown-render-content";

export const TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS = 480;

const IMAGE_TOKEN_START = "![";
const IMAGE_TOKEN_MAX_EXTENSION = 240;
const INDEX_NOT_FOUND = -1;

const isHighSurrogate = (codeUnit: number): boolean => codeUnit >= 0xd800 && codeUnit <= 0xdbff;

const findCharacterIndex = (
  body: string,
  character: string,
  from: number,
  limit: number,
): number => {
  const stop = Math.min(limit, body.length);
  for (let index = from; index < stop; index += 1) {
    if (body[index] === character) {
      return index;
    }
  }
  return INDEX_NOT_FOUND;
};

const findInlineImageEnd = (body: string, openIndex: number, limit: number): number => {
  let depth = 0;
  let inTitle = false;
  const stop = Math.min(limit, body.length);
  for (let index = openIndex; index < stop; index += 1) {
    const character = body[index];
    if (inTitle) {
      if (character === '"') {
        inTitle = false;
      }
    } else if (character === '"') {
      inTitle = true;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return INDEX_NOT_FOUND;
};

const findImageTokenEnd = (body: string, imageStart: number, limit: number): number => {
  const altEnd = findCharacterIndex(body, "]", imageStart + 2, limit);
  if (altEnd === INDEX_NOT_FOUND) {
    return INDEX_NOT_FOUND;
  }
  const delimiter = body[altEnd + 1];
  if (delimiter === "[") {
    const referenceEnd = findCharacterIndex(body, "]", altEnd + 2, limit);
    return referenceEnd === INDEX_NOT_FOUND ? INDEX_NOT_FOUND : referenceEnd + 1;
  }
  if (delimiter === "(") {
    return findInlineImageEnd(body, altEnd + 1, limit);
  }
  return altEnd + 1;
};

const completeImageToken = (body: string, end: number): string => {
  const bounded = body.slice(0, end);
  const imageStart = bounded.lastIndexOf(IMAGE_TOKEN_START);
  if (imageStart === INDEX_NOT_FOUND) {
    return bounded;
  }
  const tokenEnd = findImageTokenEnd(body, imageStart, end + IMAGE_TOKEN_MAX_EXTENSION);
  if (tokenEnd === INDEX_NOT_FOUND) {
    return bounded.slice(0, imageStart);
  }
  return tokenEnd > end ? body.slice(0, tokenEnd) : bounded;
};

export const buildTaskDescriptionPreviewMarkdown = (description: string): string => {
  const body = prepareMarkdownRenderContent(description, true);
  const limit = TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS;
  const end = isHighSurrogate(body.charCodeAt(limit - 1)) ? limit - 1 : limit;
  return completeImageToken(body, end);
};
