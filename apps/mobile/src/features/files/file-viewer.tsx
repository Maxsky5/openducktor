import type { ChatFileScope } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { isMarkdownFile } from "@openducktor/frontend-core/lib/markdown-file";
import { workspaceFilePreviewQueryOptions } from "@openducktor/frontend-core/queries/filesystem";
import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useIsFocused } from "expo-router";
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCommandGate } from "@/host-session/active-session-context";
import { highlightLines, languageForFilePath } from "@/rich-content/code/highlight";
import { markdownBlockGap } from "@/rich-content/markdown/markdown-spacing";
import {
  type MarkdownBlock,
  MarkdownBlockView,
  useMarkdownBlocks,
} from "@/rich-content/markdown/markdown-view";
import { useListViewport, ViewportProvider } from "@/rich-content/viewport/use-in-viewport";
import { PIERRE_COLORS } from "@/rich-content/diff/pierre-colors";
import { useAppTheme } from "@/theme/app-theme-context";
import { SegmentedControl } from "@/ui/fields";
import { Icon } from "@/ui/icon";
import { IconButton } from "@/ui/icon-button";
import { useScreenEndSpace } from "@/ui/screen";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { CodeLineRow } from "./code-line-row";
import {
  fileContentView,
  HIGHLIGHT_LINE_LIMIT,
  lineNumberColumnChars,
  textLineCount,
} from "./file-content-model";

/**
 * A read-only view of one file, as the desktop file preview: the code view with line numbers and
 * the desktop syntax colors, a formatted Markdown document, or the image on a muted page.
 */
export function FileViewer({
  rootPath,
  relativePath,
  scope,
  showsPath = false,
  onClose,
}: {
  rootPath: string;
  relativePath: string;
  /** The chat that owns the file, so the host checks that the file is in its directory. */
  scope: ChatFileScope | undefined;
  /** True when no navigation bar names the file, such as the detail pane of a wide screen. */
  showsPath?: boolean | undefined;
  /** Closes the preview, such as in the detail pane of a wide screen. */
  onClose?: (() => void) | undefined;
}): ReactElement {
  const focused = useIsFocused();
  const gate = useCommandGate();
  const query = useQuery({
    ...workspaceFilePreviewQueryOptions(rootPath, relativePath, scope),
    enabled: focused,
  });
  const content = useMemo(() => (query.data ? fileContentView(query.data) : null), [query.data]);
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  let body: ReactElement;
  if (!content) {
    body = query.error ? (
      <ErrorState
        title="Could Not Read the File"
        message={errorMessage(query.error)}
        onRetry={gate.open ? retry : undefined}
      />
    ) : (
      <LoadingState label="Loading file" />
    );
  } else if (content.kind === "message") {
    body = <EmptyState icon="file-warning" title={content.title} message={content.message} />;
  } else if (content.kind === "image") {
    body = <ImagePreview uri={content.uri} path={relativePath} />;
  } else if (isMarkdownFile(relativePath)) {
    body = <MarkdownFile path={relativePath} contents={content.contents} />;
  } else {
    body = <CodeLines path={relativePath} contents={content.contents} />;
  }
  return (
    <View style={styles.fill}>
      {showsPath ? <PreviewHeader path={relativePath} onClose={onClose} /> : null}
      {content && query.error ? (
        // A failed read keeps the last content, so the view tells that it can be out of date.
        <View style={styles.notice}>
          <Callout
            tone="destructive"
            title="Refresh failed"
            message={`${errorMessage(query.error)} The view shows the last loaded content.`}
          />
        </View>
      ) : null}
      {body}
    </View>
  );
}

/** The desktop preview header: a code file icon and the path, with a close control. */
function PreviewHeader({
  path,
  onClose,
}: {
  path: string;
  onClose: (() => void) | undefined;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.header}>
      <Icon name="file-code-2" size={16} colorValue={theme.desktop.mutedForeground} />
      <Text
        variant="callout"
        weight="medium"
        numberOfLines={1}
        ellipsizeMode="middle"
        selectable
        accessibilityRole="header"
        style={styles.fill}
      >
        {path}
      </Text>
      {onClose ? (
        <IconButton
          icon="x"
          size={16}
          color="secondaryLabel"
          accessibilityLabel="Close file preview"
          onPress={onClose}
        />
      ) : null}
    </View>
  );
}

export function ImagePreview({ uri, path }: { uri: string; path: string }): ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <EmptyState
        icon="file-warning"
        title="Image Unavailable"
        message="The image could not be displayed. Check that the file is a supported image."
      />
    );
  }
  return (
    <View style={styles.image}>
      <Image
        source={{ uri }}
        contentFit="contain"
        style={styles.fill}
        accessibilityLabel={`Image ${path}`}
        onError={() => setFailed(true)}
      />
    </View>
  );
}

const MARKDOWN_MODES = [
  { value: "preview", label: "Preview" },
  { value: "source", label: "Source" },
] as const;

/**
 * A Markdown file as the desktop shows it: a formatted document. Source shows the raw text with
 * line numbers, since the phone has no editor.
 */
export function MarkdownFile({ path, contents }: { path: string; contents: string }): ReactElement {
  const [mode, setMode] = useState<(typeof MARKDOWN_MODES)[number]["value"]>("preview");
  return (
    <View style={styles.fill}>
      <View style={styles.modes}>
        <SegmentedControl
          label="Markdown view"
          options={MARKDOWN_MODES}
          value={mode}
          onChange={setMode}
        />
      </View>
      {mode === "preview" ? (
        <MarkdownPreview path={path} contents={contents} />
      ) : (
        <CodeLines path={path} contents={contents} />
      )}
    </View>
  );
}

/** One top-level block of a Markdown file, with the collapsed margin above it. */
type MarkdownRow = { block: MarkdownBlock; gap: number };

const markdownRowKey = (row: MarkdownRow): string => row.block.key;
const markdownRowType = (row: MarkdownRow): string => row.block.route;

/**
 * The formatted Markdown file as list rows, so a long file renders only its visible blocks.
 * Images and isolated pages, such as diagrams, load near the viewport.
 */
function MarkdownPreview({ path, contents }: { path: string; contents: string }): ReactElement {
  const theme = useAppTheme();
  const endSpace = useScreenEndSpace(theme.space.xxxl);
  const document = useMarkdownBlocks(contents, path);
  const rows = useMemo(
    () =>
      document.blocks.map((block, index): MarkdownRow => ({
        block,
        gap: markdownBlockGap(document.blocks[index - 1], block, "document"),
      })),
    [document.blocks],
  );
  const viewport = useListViewport();
  const renderItem = useCallback<ListRenderItem<MarkdownRow>>(
    ({ item }) => (
      <View style={styles.markdownBlock(item.gap)}>
        <MarkdownBlockView block={item.block} definitions={document.definitions} selectable />
      </View>
    ),
    [document.definitions],
  );
  return (
    <ViewportProvider value={viewport.store}>
      <View ref={viewport.frameRef} style={styles.fill} onLayout={viewport.onFrameLayout}>
        <FlashList
          data={rows}
          renderItem={renderItem}
          keyExtractor={markdownRowKey}
          getItemType={markdownRowType}
          extraData={renderItem}
          onScroll={viewport.onScroll}
          scrollEventThrottle={32}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[styles.document, { paddingBottom: endSpace }]}
        />
      </View>
    </ViewportProvider>
  );
}

export function CodeLines({ path, contents }: { path: string; contents: string }): ReactElement {
  const theme = useAppTheme();
  const endSpace = useScreenEndSpace(theme.space.xxxl);
  // Highlighting runs per chunk, only for the rows that the list renders. A file over the desktop
  // limit shows plain text.
  const highlighted = useMemo(() => {
    const language =
      textLineCount(contents) <= HIGHLIGHT_LINE_LIMIT ? languageForFilePath(path) : null;
    return highlightLines(contents, language);
  }, [contents, path]);
  const lines = useMemo(
    () => Array.from({ length: highlighted.lineCount }, (_, index) => index),
    [highlighted.lineCount],
  );
  const numberChars = lineNumberColumnChars(highlighted.lineCount);
  const renderItem = useCallback<ListRenderItem<number>>(
    ({ item }) => (
      <CodeLineRow
        tokens={highlighted.line(item)}
        lineNumber={item + 1}
        numberChars={numberChars}
      />
    ),
    [highlighted, numberChars],
  );
  return (
    <View style={styles.code}>
      <FlashList
        data={lines}
        renderItem={renderItem}
        keyExtractor={lineKey}
        extraData={renderItem}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[styles.codeContent, { paddingBottom: endSpace }]}
      />
    </View>
  );
}

const lineKey = (line: number): string => String(line);

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: theme.touchTarget,
    paddingLeft: theme.space.md,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
  },
  notice: { paddingHorizontal: theme.layout.screenPadding, paddingVertical: theme.space.sm },
  // The desktop code view draws on the Pierre page, with 8 points above and below the lines.
  code: { flex: 1, backgroundColor: PIERRE_COLORS[theme.scheme].background },
  codeContent: { paddingTop: theme.space.sm },
  modes: {
    paddingHorizontal: theme.layout.screenPadding,
    paddingVertical: theme.space.sm,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
  },
  document: { paddingTop: theme.space.lg },
  markdownBlock: (gap: number) => ({
    paddingTop: gap,
    paddingHorizontal: theme.layout.screenPadding,
  }),
  image: {
    flex: 1,
    padding: theme.space.lg,
    backgroundColor: theme.colors.insetFill,
  },
}));
