import { HTML_PREVIEW_MOBILE_MAX_INLINE_HEIGHT } from "@openducktor/contracts";
import { useSessionHtmlPreview } from "@openducktor/frontend-core/queries/session-html-previews";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import type { HtmlPreviewToolCall } from "@openducktor/frontend-core/sessions/messages/html-preview-tool";
import {
  memo,
  type ReactElement,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useInViewport } from "@/rich-content/viewport/use-in-viewport";
import { Button } from "@/ui/button";
import { Icon } from "@/ui/icon";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Text } from "@/ui/text";
import { useCellIndex, useFoldMotionList } from "../transcript-fold-motion";
import { useTranscriptRows } from "../transcript-rows-context";
import { useRowVisible } from "../transcript-visibility";
import { HtmlPreviewViewer } from "./html-preview-viewer";
import { ToolPartSessionProvider } from "./tool-details";

const INITIAL_INLINE_PREVIEW_HEIGHT = 240;
const MEASURED_HEIGHT_LIMIT = 200;
const measuredMobilePreviewHeights = new Map<string, number>();

const readMobilePreviewHeight = (previewId: string): number =>
  measuredMobilePreviewHeights.get(previewId) ?? INITIAL_INLINE_PREVIEW_HEIGHT;

const rememberMobilePreviewHeight = (previewId: string, height: number): void => {
  measuredMobilePreviewHeights.delete(previewId);
  measuredMobilePreviewHeights.set(previewId, height);
  if (measuredMobilePreviewHeights.size > MEASURED_HEIGHT_LIMIT) {
    const oldest = measuredMobilePreviewHeights.keys().next().value;
    if (oldest !== undefined) measuredMobilePreviewHeights.delete(oldest);
  }
};

/**
 * A published HTML page at the position of its `odt_publish_html` call. The row fits its content
 * height dynamically and remembers that height while scrolled out of view so the transcript does
 * not jump. Vertical swipes keep scrolling the transcript; the floating button opens full screen.
 */
export const HtmlPreviewRow = memo(function HtmlPreviewRow({
  meta,
  preview,
  rowKey,
}: {
  meta: ToolMeta;
  preview: HtmlPreviewToolCall;
  rowKey: string;
}): ReactElement {
  return (
    <ToolPartSessionProvider>
      <HtmlPreviewRowContent meta={meta} preview={preview} rowKey={rowKey} />
    </ToolPartSessionProvider>
  );
});

function HtmlPreviewRowContent({
  meta,
  preview,
  rowKey,
}: {
  meta: ToolMeta;
  preview: HtmlPreviewToolCall;
  rowKey: string;
}): ReactElement {
  const { openFullView, visibleRows } = useTranscriptRows();
  const foldList = useFoldMotionList();
  const cellIndex = useCellIndex();
  const visible = useRowVisible(visibleRows, rowKey);
  const { title, previewId } = preview;
  // Mount the WebView lazily when the row first comes near the viewport, then keep it mounted
  // across short scrolls so scrolling slightly away and back does not reload the page or wipe
  // interactive state. FlashList still caps memory by recycling cells far off-screen, and tying
  // the latch to `previewId` resets it cleanly when a cell is recycled for another preview.
  const [mountedPreviewId, setMountedPreviewId] = useState<string | null>(null);
  const hasMounted = mountedPreviewId === previewId;
  const { ref: viewportRef, onLayout, inView } = useInViewport(visible && !hasMounted);
  const shouldMount = hasMounted || inView;
  if (inView && !hasMounted) {
    setMountedPreviewId(previewId);
  }
  // FlashList already virtualizes rows to its draw buffer around the viewport. Start reading the
  // immutable HTML immediately on mount so it is cached before the WebView mounts on viewport entry.
  const { html, loading, error, retry } = useSessionHtmlPreview(previewId);
  // Keep initialHeight stable per previewId so height updates never re-render the memoized
  // HtmlPreviewViewer (on Android, re-rendering WebView with an inline HTML source reloads it).
  const initialHeight = useMemo(() => readMobilePreviewHeight(previewId), [previewId]);
  const [measured, setMeasured] = useState<{ previewId: string; height: number } | null>(null);
  const height = measured?.previewId === previewId ? measured.height : initialHeight;
  const heightRef = useRef({ previewId, height });
  useLayoutEffect(() => {
    heightRef.current = { previewId, height };
  }, [height, previewId]);

  const handleHeightChange = useCallback(
    (nextHeight: number) => {
      const prevHeight =
        heightRef.current.previewId === previewId ? heightRef.current.height : initialHeight;
      const delta = nextHeight - prevHeight;
      if (delta === 0) return;
      heightRef.current = { previewId, height: nextHeight };
      rememberMobilePreviewHeight(previewId, nextHeight);
      setMeasured({ previewId, height: nextHeight });
      if (foldList && cellIndex !== null) {
        foldList.resizeRow(cellIndex.current, delta);
      }
    },
    [cellIndex, foldList, initialHeight, previewId],
  );

  let body: ReactElement;
  if (html !== null) {
    body = shouldMount ? (
      <HtmlPreviewViewer
        key={previewId}
        html={html}
        title={title}
        scroll="inline"
        initialHeight={initialHeight}
        onHeightChange={handleHeightChange}
      />
    ) : (
      <View />
    );
  } else if (!shouldMount) {
    body = <View />;
  } else if (loading) {
    body = (
      <View style={styles.state}>
        <LoaderSpinner size={14} />
        <Text style={styles.muted}>Loading preview…</Text>
      </View>
    );
  } else {
    body = (
      <View style={styles.state}>
        <Text style={styles.error}>
          Cannot read the HTML of {title}: {error ?? "the host did not return the stored preview."}
        </Text>
        <Button label="Try Again" size="sm" variant="gray" onPress={retry} />
      </View>
    );
  }

  return (
    <View style={styles.preview}>
      <View
        ref={viewportRef}
        onLayout={onLayout}
        style={[styles.frame, { height }]}
        accessibilityLabel={`${title} HTML preview`}
      >
        {body}
      </View>
      {html !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${title} full screen`}
          onPress={() => openFullView({ ...previewRoute(meta, title), mode: "preview" })}
          style={styles.open}
          hitSlop={8}
        >
          <Icon name="expand" size={14} color="label" />
        </Pressable>
      ) : null}
      {html !== null && height >= HTML_PREVIEW_MOBILE_MAX_INLINE_HEIGHT ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open full ${title} preview`}
          onPress={() => openFullView({ ...previewRoute(meta, title), mode: "preview" })}
          style={styles.more}
        >
          <Icon name="expand" size={13} color="secondaryLabel" />
          <Text style={styles.moreText}>Open full screen for full preview</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const previewRoute = (meta: ToolMeta, title: string) =>
  ({ kind: "html_preview", title, partId: meta.partId, callId: meta.callId }) as const;

const styles = StyleSheet.create((theme) => ({
  preview: {
    marginVertical: theme.space.sm,
  },
  frame: {
    overflow: "hidden",
    backgroundColor: theme.desktop.chatBackground,
  },
  more: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.xs,
    paddingVertical: theme.space.sm,
    paddingHorizontal: theme.space.md,
    borderTopWidth: 1,
    borderTopColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  moreText: {
    ...theme.type.footnote,
    color: theme.desktop.mutedForeground,
  },
  open: {
    position: "absolute",
    top: theme.space.sm,
    right: theme.space.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    boxShadow: theme.shadows.card,
  },
  state: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.sm,
    padding: theme.space.md,
  },
  muted: {
    ...theme.type.footnote,
    color: theme.desktop.mutedForeground,
  },
  error: {
    ...theme.type.footnote,
    color: theme.desktop.destructive,
    textAlign: "center",
  },
}));
