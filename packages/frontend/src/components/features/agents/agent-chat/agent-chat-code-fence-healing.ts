type OpenCodeFence = {
  marker: string;
  char: "`" | "~";
  size: number;
  closePattern: RegExp;
};

const FENCE_START_PATTERN = /^[\t ]{0,3}(`{3,}|~{3,})(.*)$/;

const createFenceClosePattern = (fence: Pick<OpenCodeFence, "char" | "size">): RegExp => {
  return new RegExp(`^[\\t ]{0,3}${fence.char}{${fence.size},}[\\t ]*$`);
};

const readFenceStart = (line: string): OpenCodeFence | null => {
  const match = FENCE_START_PATTERN.exec(line);
  const marker = match?.[1];
  const infoString = match?.[2] ?? "";
  if (!marker) {
    return null;
  }

  const char = marker[0];
  if (char !== "`" && char !== "~") {
    return null;
  }
  if (char === "`" && infoString.includes("`")) {
    return null;
  }

  return {
    marker,
    char,
    size: marker.length,
    closePattern: createFenceClosePattern({ char, size: marker.length }),
  };
};

const isFenceClose = (line: string, fence: OpenCodeFence): boolean => {
  return fence.closePattern.test(line);
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

  if (markdown.trim().length === 0) {
    return markdown;
  }

  const openFence = findUnclosedCodeFence(markdown);
  if (!openFence) {
    return markdown;
  }

  const separator = markdown.endsWith("\n") ? "" : "\n";
  return `${markdown}${separator}${openFence.marker}`;
};
