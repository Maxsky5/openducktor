import { Image } from "expo-image";
import type { RootContent } from "mdast";
import { memo, type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, useWindowDimensions, View, type ViewStyle } from "react-native";
import Animated, { type CSSStyle } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { motion } from "@/theme/tokens";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/callout";
import { CodeBlock } from "../code/code-block";
import {
  BLOCK_PAGE_CHANNEL,
  type BlockPageOutboundMessage,
  type BlockRenderMessage,
  MAX_BLOCK_MARKDOWN_LENGTH,
} from "../isolated-page/block-page-messages";
import { RICH_BLOCK_PAGE, RICH_DIAGRAM_PAGE } from "../isolated-page/block-pages";
import { type IsolatedPageHandle, IsolatedPageView } from "../isolated-page/isolated-page-view";
import type { IsolatedPage } from "../isolated-page/page-asset";
import { contentHash, createHostContentCache } from "../lru-cache";
import { useInViewport } from "../viewport/use-in-viewport";
import { MARKDOWN_BODY, useMarkdownVisible } from "./markdown-context";
import { blockPageMarkdown } from "./block-page-markdown";
import type { MarkdownAppearance } from "./markdown-context";
import type { MarkdownDefinitions } from "./markdown-document";

/** Heights that block pages reported, so a remounted row keeps its height. */
const heights = createHostContentCache<string, number>(512);
type BlockSnapshot = Omit<Extract<BlockPageOutboundMessage, { type: "block_snapshot" }>, "type">;
/** A render message without its `id`, which each page view counts itself. */
type BlockRender = Omit<BlockRenderMessage, "id">;
/**
 * Pictures of rendered diagrams. A diagram that shows again, such as in a reopened document,
 * shows its picture at once instead of a page that runs Mermaid again.
 */
const snapshots = createHostContentCache<string, BlockSnapshot>(32);
const ESTIMATED_HEIGHTS = { math: 48, diagram: 240 } as const;
// The width of the last block that showed. A new block uses it until its own layout runs.
let lastWidth = 0;

export type IsolatedBlockViewProps = {
  source: string;
  node: RootContent;
  route: "math" | "diagram";
  /** The link targets of the whole text, which the page cannot see in the block alone. */
  definitions: MarkdownDefinitions;
  appearance: MarkdownAppearance;
  onLinkPress: (href: string) => void;
};

/**
 * A Markdown block that shows math or a Mermaid diagram in the isolated page view, in the look of
 * the native Markdown around it. It sizes itself from the page height. A render failure shows
 * the block text and the error.
 */
export const IsolatedBlockView = memo(function IsolatedBlockView({
  source,
  node,
  route,
  definitions,
  appearance,
  onLinkPress,
}: IsolatedBlockViewProps): ReactElement {
  const theme = useAppTheme();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(lastWidth);
  const [measured, setMeasured] = useState<{ key: string; height: number } | null>(null);
  const [failure, setFailure] = useState<{ source: string; message: string } | null>(null);
  // Each restart mounts a new page, because the page of an ended process is gone.
  const [pageGeneration, setPageGeneration] = useState(0);
  // A long message can hold many blocks. Each page mounts only while its row is in view and the
  // block is near the viewport.
  const viewport = useInViewport(useMarkdownVisible());
  const page = route === "diagram" ? RICH_DIAGRAM_PAGE : RICH_BLOCK_PAGE;
  const markdown = useMemo(
    () => blockPageMarkdown(source, node, definitions),
    [definitions, node, source],
  );
  const { variant, muted, italic } = appearance;
  const sizeKey = `${page.name}:${theme.scheme}:${fontScale}:${variant}:${italic}:${Math.round(width)}:${contentHash(markdown ?? source)}`;
  // While the page answers a new message, the frame keeps the last height that it reported.
  const height =
    measured?.key === sizeKey
      ? measured.height
      : (heights.get(sizeKey) ?? measured?.height ?? ESTIMATED_HEIGHTS[route]);

  const message = useMemo<BlockRender | null>(
    () =>
      markdown === null
        ? null
        : {
            type: "block_render",
            markdown,
            theme: theme.scheme,
            // The colors of the native Markdown views. Diagrams also use the tint and fill.
            colors: {
              background: theme.colors.background,
              label: muted ? theme.desktop.mutedForeground : theme.desktop.foreground,
              secondaryLabel: theme.desktop.mutedForeground,
              foreground: theme.desktop.foreground,
              code: theme.scheme === "dark" ? theme.palette.rose400 : theme.palette.rose600,
              separator: theme.desktop.input,
              listNumber: theme.palette.slate500,
              listBullet: theme.palette.slate300,
              tableRule: theme.palette.slate200,
              tableHeaderRule: theme.palette.slate300,
              tint: theme.colors.tint,
              fill: theme.colors.fill,
              codeBackground: theme.colors.insetFill,
              error: theme.desktop.destructiveMuted,
            },
            variant,
            fontSize: MARKDOWN_BODY[variant].fontSize,
            lineHeight: MARKDOWN_BODY[variant].lineHeight,
            italic,
            // The message schema limits the scale to the range that a page can lay out.
            fontScale: Math.min(4, Math.max(0.5, fontScale)),
          },
    [fontScale, italic, markdown, muted, theme, variant],
  );

  const { onLayout: onViewportLayout } = viewport;
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout.width;
      lastWidth = next;
      setWidth(next);
      onViewportLayout();
    },
    [onViewportLayout],
  );
  const onSize = useCallback(
    (next: number) => {
      heights.set(sizeKey, next);
      setMeasured({ key: sizeKey, height: next });
    },
    [sizeKey],
  );
  const onSnapshot = useCallback(
    (snapshot: BlockSnapshot) => snapshots.set(sizeKey, snapshot),
    [sizeKey],
  );
  const onFailure = useCallback(
    (reason: string) => setFailure({ source, message: reason }),
    [source],
  );
  const restartPage = useCallback(() => setPageGeneration((generation) => generation + 1), []);
  const snapshot = route === "diagram" ? snapshots.get(sizeKey) : undefined;

  if (message === null) {
    return (
      <BlockFailure
        source={source}
        message={`A block with math or a diagram renders up to ${MAX_BLOCK_MARKDOWN_LENGTH.toLocaleString("en-US")} characters. This block is longer.`}
      />
    );
  }
  if (failure?.source === source) {
    return (
      <BlockFailure source={source} message={failure.message} onRetry={() => setFailure(null)} />
    );
  }
  if (snapshot) {
    return (
      <View style={styles.frame(height)} onLayout={onLayout}>
        <Image
          source={{ uri: snapshot.image }}
          // A list reuses this view for other blocks, so the picture of the last block does not
          // show while the new one decodes.
          recyclingKey={sizeKey}
          cachePolicy="memory"
          accessibilityRole="image"
          accessibilityLabel="Diagram"
          style={{
            position: "absolute",
            left: snapshot.x,
            top: snapshot.y,
            width: snapshot.width,
            height: snapshot.height,
          }}
        />
      </View>
    );
  }
  return (
    <View ref={viewport.ref} style={styles.frame(height)} onLayout={onLayout}>
      {viewport.inView ? (
        // A new page or a restart mounts a new view, with its own load and ready state.
        <BlockPage
          key={`${page.name}:${pageGeneration}`}
          page={page}
          message={message}
          placeholder={route === "diagram"}
          onSize={onSize}
          onSnapshot={onSnapshot}
          onFailure={onFailure}
          onRestart={restartPage}
          onLinkPress={onLinkPress}
        />
      ) : null}
    </View>
  );
});

function BlockFailure({
  source,
  message,
  onRetry,
}: {
  source: string;
  message: string;
  onRetry?: (() => void) | undefined;
}): ReactElement {
  return (
    <View style={styles.fallback}>
      <Callout
        tone="warning"
        title="This block did not render."
        message={message}
        action={
          onRetry ? <Button label="Try Again" size="sm" variant="gray" onPress={onRetry} /> : null
        }
      />
      <CodeBlock code={source} language="markdown" />
    </View>
  );
}

type BlockPageProps = {
  page: IsolatedPage;
  message: BlockRender;
  /** Shows a wash until the page draws, for a diagram that takes a moment to lay out. */
  placeholder: boolean;
  onSize: (height: number) => void;
  onSnapshot: (snapshot: BlockSnapshot) => void;
  onFailure: (message: string) => void;
  /** Mounts a new page in place of this one. */
  onRestart: () => void;
  onLinkPress: (href: string) => void;
};

/**
 * One mounted page view. Its ready state resets when it unmounts. The page stays hidden until it
 * reports the size of its first render, then fades in over its placeholder. The page holds no
 * state, so a page process that ends in the background mounts a new page.
 */
function BlockPage({
  page,
  message,
  placeholder,
  onSize,
  onSnapshot,
  onFailure,
  onRestart,
  onLinkPress,
}: BlockPageProps): ReactElement {
  const handle = useRef<IsolatedPageHandle<BlockRenderMessage>>(null);
  const [ready, setReady] = useState(false);
  const [drawn, setDrawn] = useState(false);
  // The id of the last render message. An error of an older message is out of date.
  const renderId = useRef(0);
  useEffect(() => {
    if (!ready) return;
    renderId.current += 1;
    handle.current?.post({ ...message, id: renderId.current });
  }, [message, ready]);
  const onReady = useCallback(() => setReady(true), []);
  const onMessage = useCallback(
    (received: BlockPageOutboundMessage) => {
      switch (received.type) {
        case "block_size":
          onSize(received.height);
          setDrawn(true);
          return;
        case "block_snapshot": {
          const { type: _type, ...snapshot } = received;
          onSnapshot(snapshot);
          return;
        }
        case "block_error":
          if (received.id === undefined || received.id === renderId.current) {
            onFailure(received.message);
          }
          return;
        case "link":
          onLinkPress(received.url);
          return;
      }
    },
    [onFailure, onLinkPress, onSize, onSnapshot],
  );
  return (
    <>
      {placeholder ? (
        <Animated.View
          style={[styles.placeholder, drawn ? PLACEHOLDER_GONE : null]}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading diagram"
          accessibilityElementsHidden={drawn}
          importantForAccessibility={drawn ? "no-hide-descendants" : "auto"}
        />
      ) : null}
      <IsolatedPageView
        ref={handle}
        page={page}
        channel={BLOCK_PAGE_CHANNEL}
        onReady={onReady}
        onMessage={onMessage}
        onFailure={onFailure}
        onRestart={onRestart}
        revealed={drawn}
        style={styles.page}
      />
    </>
  );
}

const PLACEHOLDER_GONE: CSSStyle<ViewStyle> = {
  opacity: 0,
  transitionProperty: "opacity",
  transitionDuration: motion.base,
  transitionTimingFunction: motion.easeOut,
};

const styles = StyleSheet.create((theme) => ({
  frame: (height: number) => ({ height, alignSelf: "stretch" }),
  page: { flex: 1 },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    backgroundColor: theme.colors.fill,
  },
  fallback: { gap: theme.space.md },
}));
