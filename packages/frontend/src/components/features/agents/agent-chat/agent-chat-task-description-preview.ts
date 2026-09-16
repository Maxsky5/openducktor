import { isFenceClose, readFenceStart, type OpenCodeFence } from "./agent-chat-code-fence-healing";
import { prepareMarkdownRenderContent } from "@/components/ui/markdown-render-content";

export const TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS = 480;

const CONTAINER_PREFIX_PATTERN = /^[\s>]*/;

const isMermaidFence = (fence: OpenCodeFence): boolean =>
  fence.infoString.trim().split(/\s+/)[0] === "mermaid";

const removeInfoString = (line: string, marker: string): string => {
  const markerIndex = line.indexOf(marker);
  return markerIndex < 0 ? line : line.slice(0, markerIndex + marker.length);
};

const renderDiagramFencesAsCode = (markdown: string): string => {
  let openFence: OpenCodeFence | null = null;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const scanLine = line.replace(CONTAINER_PREFIX_PATTERN, "");
      if (openFence !== null) {
        if (isFenceClose(scanLine, openFence)) {
          openFence = null;
        }
        return line;
      }
      const fence = readFenceStart(scanLine);
      if (fence === null) {
        return line;
      }
      openFence = fence;
      if (!isMermaidFence(fence)) {
        return line;
      }
      return removeInfoString(line, fence.marker);
    })
    .join("\n");
};

export const buildTaskDescriptionPreviewMarkdown = (description: string): string => {
  const body = prepareMarkdownRenderContent(description, true);
  const bounded = body.slice(0, TASK_DESCRIPTION_PREVIEW_MAX_CHARACTERS);
  return renderDiagramFencesAsCode(bounded);
};
