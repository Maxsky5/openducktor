/**
 * Markdown views in the desktop `.markdown-body prose` style. `MarkdownView` renders a whole
 * text, and `MarkdownBlocks` renders a parsed text, both with the desktop space between blocks.
 * A long text can render its top-level blocks as list rows instead; the rows then set their own
 * space:
 *
 *   const document = useMarkdownBlocks(markdown, revision);
 *   <FlashList
 *     data={document.blocks}
 *     keyExtractor={(block) => block.key}
 *     renderItem={({ item }) => <MarkdownBlockView block={item} definitions={document.definitions} />}
 *   />
 *
 * Native views draw blocks without math or Mermaid. Math and Mermaid blocks render in the
 * isolated page view, which mounts only while `visibility` reports the row in view.
 */
import { memo, type ReactElement, useEffect, useMemo, useRef } from "react";
import { View, type ViewStyle } from "react-native";
import type { TaskImageContext } from "../images/image-source";
import { type FileLinkHandler, useLinkOpener } from "../links/use-link-opener";
import { IsolatedBlockView } from "./isolated-block-view";
import {
  DEFAULT_MARKDOWN_APPEARANCE,
  type MarkdownAppearance,
  MarkdownContext,
  type MarkdownRenderContext,
  type MarkdownVariant,
  type MarkdownVisibility,
} from "./markdown-context";
import {
  type MarkdownBlock,
  type MarkdownDefinitions,
  type MarkdownDocument,
  readMarkdownDocument,
} from "./markdown-document";
import { NativeBlock } from "./markdown-native-block";
import { markdownBlockGap } from "./markdown-spacing";

export type { MarkdownBlock, MarkdownDefinitions, MarkdownDocument } from "./markdown-document";
export type { FileLinkHandler } from "../links/use-link-opener";
export type { TaskImageContext } from "../images/image-source";

/**
 * The top-level blocks of `markdown`, parsed outside render and cached by `revision`. Pass the
 * message ID, or the message ID with its text revision. While text streams, only the end of the
 * text parses again.
 */
export const useMarkdownBlocks = (
  markdown: string,
  revision?: string | number,
): MarkdownDocument => {
  const previous = useRef<MarkdownDocument | null>(null);
  const document = useMemo(
    () => readMarkdownDocument(markdown, revision, previous.current),
    [markdown, revision],
  );
  useEffect(() => {
    previous.current = document;
  }, [document]);
  return document;
};

/** The look of a Markdown text. Every prop is optional and has the desktop document default. */
export type MarkdownAppearanceProps = {
  /** `document` (default) or the smaller `compact` desktop variant. */
  variant?: MarkdownVariant | undefined;
  /** Draws all text in the muted foreground, as the desktop reasoning and previews. */
  muted?: boolean | undefined;
  /** Slants the prose but not the code, as the desktop reasoning. */
  italic?: boolean | undefined;
  /** Colors fenced code. The desktop chat shows plain code. Defaults to true. */
  highlightCode?: boolean | undefined;
};

const useAppearance = ({
  variant = DEFAULT_MARKDOWN_APPEARANCE.variant,
  muted = DEFAULT_MARKDOWN_APPEARANCE.muted,
  italic = DEFAULT_MARKDOWN_APPEARANCE.italic,
  highlightCode = DEFAULT_MARKDOWN_APPEARANCE.highlightCode,
}: MarkdownAppearanceProps): MarkdownAppearance =>
  useMemo(
    () => ({ variant, muted, italic, highlightCode }),
    [highlightCode, italic, muted, variant],
  );

export type MarkdownBlockViewProps = MarkdownAppearanceProps & {
  block: MarkdownBlock;
  definitions: MarkdownDefinitions;
  onFileLinkPress?: FileLinkHandler | undefined;
  /** The task of `odt-asset:` images. Without it, task images show a notice. */
  imageContext?: TaskImageContext | null | undefined;
  /** Staged task images that are not saved on the host yet: asset ID to device file URI. */
  stagedImages?: ReadonlyMap<string, string> | null | undefined;
  selectable?: boolean | undefined;
  /**
   * The visibility of the list row. Images and isolated pages wait while the row is out of view.
   * Only they read it, so the text does not render again when the row scrolls in or out.
   */
  visibility?: MarkdownVisibility | null | undefined;
};

const sameImageContext = (left: TaskImageContext | null, right: TaskImageContext | null): boolean =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.workspaceId === right.workspaceId &&
    left.taskId === right.taskId &&
    left.issue?.repoPath === right.issue?.repoPath &&
    left.issue?.providerId === right.issue?.providerId);

/** One top-level block. Use it as a list row. */
export const MarkdownBlockView = memo(
  function MarkdownBlockView({
    block,
    definitions,
    onFileLinkPress,
    imageContext = null,
    stagedImages = null,
    selectable = false,
    visibility = null,
    ...appearanceProps
  }: MarkdownBlockViewProps): ReactElement {
    const openLink = useLinkOpener(onFileLinkPress);
    const appearance = useAppearance(appearanceProps);
    const context = useMemo<MarkdownRenderContext>(
      () => ({
        appearance,
        definitions,
        openLink,
        imageContext,
        stagedImages,
        selectable,
        visibility,
      }),
      [appearance, definitions, imageContext, openLink, selectable, stagedImages, visibility],
    );
    return (
      <MarkdownContext value={context}>
        {block.route === "native" ? (
          <NativeBlock node={block.node} streaming={block.streaming} />
        ) : (
          <IsolatedBlockView
            source={block.source}
            node={block.node}
            route={block.route}
            definitions={definitions}
            appearance={appearance}
            onLinkPress={openLink}
          />
        )}
      </MarkdownContext>
    );
  },
  (previous, next) =>
    previous.block === next.block &&
    previous.definitions === next.definitions &&
    previous.onFileLinkPress === next.onFileLinkPress &&
    previous.selectable === next.selectable &&
    previous.visibility === next.visibility &&
    previous.stagedImages === next.stagedImages &&
    previous.variant === next.variant &&
    previous.muted === next.muted &&
    previous.italic === next.italic &&
    previous.highlightCode === next.highlightCode &&
    sameImageContext(previous.imageContext ?? null, next.imageContext ?? null),
);

export type MarkdownBlocksProps = MarkdownAppearanceProps & {
  document: MarkdownDocument;
  onFileLinkPress?: FileLinkHandler | undefined;
  imageContext?: TaskImageContext | null | undefined;
  stagedImages?: ReadonlyMap<string, string> | null | undefined;
  selectable?: boolean | undefined;
  visibility?: MarkdownVisibility | null | undefined;
};

const gapStyles = new Map<number, ViewStyle>();
/** One style for each block gap, so a streamed text that renders again sends no new styles. */
const gapStyleOf = (gap: number): ViewStyle => {
  let style = gapStyles.get(gap);
  if (!style) {
    style = { marginTop: gap };
    gapStyles.set(gap, style);
  }
  return style;
};

/**
 * All blocks of a parsed text, with the desktop space between blocks: the larger of the bottom
 * margin of a block and the top margin of the next one, as CSS margins collapse.
 */
export const MarkdownBlocks = memo(function MarkdownBlocks({
  document,
  variant = DEFAULT_MARKDOWN_APPEARANCE.variant,
  ...props
}: MarkdownBlocksProps): ReactElement {
  return (
    <View>
      {document.blocks.map((block, index) => (
        <View
          key={block.key}
          style={gapStyleOf(markdownBlockGap(document.blocks[index - 1], block, variant))}
        >
          <MarkdownBlockView
            block={block}
            definitions={document.definitions}
            variant={variant}
            {...props}
          />
        </View>
      ))}
    </View>
  );
});

export type MarkdownViewProps = MarkdownAppearanceProps & {
  markdown: string;
  /** A message ID, or a message ID with its text revision. It keys the parse cache. */
  revision?: string | number | undefined;
  onFileLinkPress?: FileLinkHandler | undefined;
  imageContext?: TaskImageContext | null | undefined;
  stagedImages?: ReadonlyMap<string, string> | null | undefined;
  selectable?: boolean | undefined;
};

/** A whole Markdown text. For a long text, render `MarkdownBlockView` rows in a list. */
export const MarkdownView = memo(function MarkdownView({
  markdown,
  revision,
  ...props
}: MarkdownViewProps): ReactElement {
  const document = useMarkdownBlocks(markdown, revision);
  return <MarkdownBlocks document={document} {...props} />;
});
