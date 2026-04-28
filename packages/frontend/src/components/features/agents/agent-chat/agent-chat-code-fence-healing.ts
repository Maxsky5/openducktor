type OpenCodeFence = {
  marker: string;
  char: "`" | "~";
  size: number;
};

const FENCE_START_PATTERN = /^[\t ]{0,3}(`{3,}|~{3,})/;

const readFenceStart = (line: string): OpenCodeFence | null => {
  const match = FENCE_START_PATTERN.exec(line);
  const marker = match?.[1];
  if (!marker) {
    return null;
  }

  const char = marker[0];
  if (char !== "`" && char !== "~") {
    return null;
  }

  return {
    marker,
    char,
    size: marker.length,
  };
};

const isFenceClose = (line: string, fence: OpenCodeFence): boolean => {
  const closePattern = new RegExp(`^[\\t ]{0,3}${fence.char}{${fence.size},}[\\t ]*$`);
  return closePattern.test(line);
};

export const findUnclosedCodeFence = (markdown: string): OpenCodeFence | null => {
  let openFence: OpenCodeFence | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    if (openFence) {
      if (isFenceClose(line, openFence)) {
        openFence = null;
      }
      continue;
    }

    openFence = readFenceStart(line);
  }

  return openFence;
};

export const closeOpenStreamingCodeFence = (markdown: string, streaming: boolean): string => {
  if (!streaming || markdown.length === 0) {
    return markdown;
  }

  const content = markdown.trim();
  if (content.length === 0) {
    return markdown;
  }

  const openFence = findUnclosedCodeFence(content);
  if (!openFence) {
    return markdown;
  }

  const separator = content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${openFence.marker}`;
};
