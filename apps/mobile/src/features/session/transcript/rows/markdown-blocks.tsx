import { memo, type ReactElement, useMemo } from "react";
import { View } from "react-native";
import { readMarkdownDocument } from "@/rich-content/markdown/markdown-document";
import { markdownBlockGap } from "@/rich-content/markdown/markdown-spacing";
import {
  type MarkdownAppearanceProps,
  MarkdownBlocks,
  useMarkdownBlocks,
} from "@/rich-content/markdown/markdown-view";
import { useTranscriptRows } from "../transcript-rows-context";
import { rowVisibility } from "../transcript-visibility";

/**
 * Markdown of one transcript message, as the desktop `AgentChatMarkdownRenderer`: the `document`
 * variant with plain code blocks unless the caller asks for another look. Images, math, and Mermaid
 * blocks load only while the row is in view, and only they render again when the row scrolls in or
 * out. While text streams, only the last block parses again. A part of a long message passes the
 * text before it, whose last block sets the space above the part.
 */
export const TranscriptMarkdown = memo(function TranscriptMarkdown({
  markdown,
  revision,
  rowKey,
  previousMarkdown,
  previousRevision,
  variant,
  muted,
  italic,
}: Omit<MarkdownAppearanceProps, "highlightCode"> & {
  markdown: string;
  /** The message ID. It keys the parse cache. */
  revision: string;
  rowKey: string;
  /** The text of the part before this one, and its parse cache key. */
  previousMarkdown?: string | undefined;
  previousRevision?: string | undefined;
}): ReactElement {
  const { visibleRows, onFileLinkPress, imageContext } = useTranscriptRows();
  const visibility = useMemo(() => rowVisibility(visibleRows, rowKey), [rowKey, visibleRows]);
  const document = useMarkdownBlocks(markdown, revision);
  const first = document.blocks[0];
  const space =
    previousMarkdown === undefined || first === undefined
      ? 0
      : markdownBlockGap(
          readMarkdownDocument(previousMarkdown, previousRevision, null).blocks.at(-1),
          first,
          variant ?? "document",
        );
  const blocks = (
    <MarkdownBlocks
      document={document}
      onFileLinkPress={onFileLinkPress}
      imageContext={imageContext}
      selectable
      visibility={visibility}
      variant={variant}
      muted={muted}
      italic={italic}
      highlightCode={false}
    />
  );
  return space === 0 ? blocks : <View style={{ paddingTop: space }}>{blocks}</View>;
});
