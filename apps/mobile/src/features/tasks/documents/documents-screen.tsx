import { type NativeStackNavigationOptions, Stack, useLocalSearchParams } from "expo-router";
import { memo, type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { WorkOwner } from "@/features/work-owner/work-owner-context";
import { WorkOwnerScreen } from "@/features/work-owner/work-owner-screen";
import { useClipboardCopy } from "@/platform/use-clipboard-copy";
import { MarkdownBlockView } from "@/rich-content/markdown/markdown-view";
import { useListViewport, ViewportProvider } from "@/rich-content/viewport/use-in-viewport";
import { useAppTheme } from "@/theme/app-theme-context";
import { ActionMenu, type ActionMenuItem } from "@/ui/action-menu";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Icon } from "@/ui/icon";
import { IconButton } from "@/ui/icon-button";
import { useScreenEndSpace } from "@/ui/screen";
import { EmptyState } from "@/ui/states";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useAnnounce } from "@/ui/use-announce";
import type { DocumentSource, HostDocumentKey } from "./document-rows";
import {
  DOCUMENT_KINDS,
  DOCUMENT_PANEL_COPY,
  type DocumentBlockRow,
  type DocumentPanelState,
  documentPanelState,
  formatDocumentUpdatedAt,
} from "./documents-panel-model";
import { useTaskDocumentSources } from "./use-task-document-sources";

/** The blocks that render with the page, so the first screen shows at once. */
const FIRST_BLOCKS = 24;
/** The blocks that each later frame adds, until the whole document shows. */
const BLOCKS_PER_FRAME = 16;

/** The Documents work view of a task: Spec Document, Implementation Plan, and QA report. */
export function DocumentsScreen(): ReactElement {
  return (
    <WorkOwnerScreen title="Documents" diffs={false}>
      {(owner) => <DocumentsContent owner={owner} />}
    </WorkOwnerScreen>
  );
}

function DocumentsContent({ owner }: { owner: WorkOwner }): ReactElement {
  if (!owner.task) {
    return (
      <>
        <Stack.Screen options={{ title: "Documents" }} />
        <EmptyState
          icon="file-text"
          title="No Task Documents"
          message="Chats have no task documents. Open Documents from a task."
        />
      </>
    );
  }
  return <TaskDocuments owner={owner} task={owner.task} />;
}

/**
 * The document that the link names, such as the plan of a transcript tool card. Otherwise, the
 * first document that exists, in workflow order, so the screen opens on real content.
 */
const initialDocument = (
  requested: string | string[] | undefined,
  summary: NonNullable<WorkOwner["task"]>["artifactSummary"],
): HostDocumentKey => {
  const named = DOCUMENT_KINDS.find((kind) => kind === requested);
  if (named) return named;
  if (summary.spec?.present) return "spec";
  if (summary.plan?.present) return "plan";
  if (summary.qaReport?.present) return "qa";
  return "spec";
};

/**
 * The desktop document panel on a phone: a bar with the document picker and the date of the
 * last change, then the document. The navigation bar and the page share the desktop card color.
 */
function TaskDocuments({
  owner,
  task,
}: {
  owner: WorkOwner;
  task: NonNullable<WorkOwner["task"]>;
}): ReactElement {
  const theme = useAppTheme();
  const { copyText } = useClipboardCopy();
  const { sources, reload } = useTaskDocumentSources({ task, repoPath: owner.repoPath });
  const { document: requested } = useLocalSearchParams<{ document?: string }>();
  const [selected, setSelected] = useState<HostDocumentKey>(() =>
    initialDocument(requested, task.artifactSummary),
  );
  const source = sources[selected];
  const state = useMemo(() => documentPanelState(source), [source]);
  const { title } = DOCUMENT_PANEL_COPY[selected];
  const markdown = state.kind === "ready" ? state.markdown : null;
  // Selectable text tracks its place on each frame, so a document turns it on only on request.
  const [selecting, setSelecting] = useState(false);
  const toggleSelecting = useCallback(() => setSelecting((current) => !current), []);
  const copy = useCallback(() => {
    if (markdown === null) return;
    void copyText(markdown, { copied: `${title} copied.`, failed: "The document was not copied." });
  }, [copyText, markdown, title]);
  const options = useMemo(() => {
    const surface = { backgroundColor: theme.desktop.card };
    const next: NativeStackNavigationOptions = {
      title: "Documents",
      headerStyle: surface,
      contentStyle: surface,
    };
    if (markdown !== null) {
      next.headerRight = () => (
        <View style={styles.headerActions}>
          <IconButton
            icon="text-select"
            accessibilityLabel={selecting ? "Stop selecting text" : "Select text"}
            selected={selecting}
            onPress={toggleSelecting}
          />
          <IconButton icon="copy" accessibilityLabel={`Copy the ${title}`} onPress={copy} />
        </View>
      );
    }
    return next;
  }, [copy, markdown, selecting, theme.desktop.card, title, toggleSelecting]);

  return (
    <View style={styles.page}>
      <Stack.Screen options={options} />
      <DocumentBar
        selected={selected}
        onSelect={setSelected}
        sources={sources}
        badge={source.badge}
      />
      <View style={styles.fill}>
        <DocumentBody
          key={selected}
          state={state}
          document={selected}
          selectable={selecting}
          onRetry={reload}
        />
      </View>
    </View>
  );
}

/** The document picker and the date of the last change, as the desktop panel header. */
function DocumentBar({
  selected,
  onSelect,
  sources,
  badge,
}: {
  selected: HostDocumentKey;
  onSelect: (document: HostDocumentKey) => void;
  sources: Record<HostDocumentKey, DocumentSource>;
  badge: DocumentSource["badge"];
}): ReactElement {
  const theme = useAppTheme();
  const { title } = DOCUMENT_PANEL_COPY[selected];
  const items = useMemo<ActionMenuItem[]>(
    () =>
      DOCUMENT_KINDS.map((kind) => ({
        id: kind,
        title: DOCUMENT_PANEL_COPY[kind].title,
        detail: formatDocumentUpdatedAt(sources[kind].updatedAt) ?? "Not set",
        checked: kind === selected,
      })),
    [selected, sources],
  );
  const select = useCallback(
    (id: string) => {
      const kind = DOCUMENT_KINDS.find((candidate) => candidate === id);
      if (kind) onSelect(kind);
    },
    [onSelect],
  );
  const updated = formatDocumentUpdatedAt(sources[selected].updatedAt);
  return (
    <View style={styles.bar}>
      <View style={styles.picker}>
        <ActionMenu title="Documents" items={items} onSelect={select}>
          <Touchable
            feedback="highlight"
            radius={theme.radius.sm}
            accessibilityRole="button"
            accessibilityLabel={`${title}, change document`}
            accessibilityHint="Opens the list of task documents."
            style={styles.trigger}
          >
            <Text variant="title3" numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            <Icon name="chevron-down" size={16} colorValue={theme.desktop.mutedForeground} />
          </Touchable>
        </ActionMenu>
      </View>
      <View style={styles.meta}>
        {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
        <Text
          variant="footnote"
          tabular
          numberOfLines={1}
          style={styles.muted}
          accessibilityLabel={updated ? `Updated ${updated}` : "Not set"}
        >
          {updated ?? "Not set"}
        </Text>
      </View>
    </View>
  );
}

/** The selected document, or its loading, error, or empty text, as the desktop panel body. */
function DocumentBody({
  state,
  document,
  selectable,
  onRetry,
}: {
  state: DocumentPanelState;
  document: HostDocumentKey;
  selectable: boolean;
  onRetry: (document: HostDocumentKey) => void;
}): ReactElement {
  const copy = DOCUMENT_PANEL_COPY[document];
  useAnnounce(state.kind === "error" ? state.message : null);
  switch (state.kind) {
    case "loading":
      return (
        <View style={styles.message}>
          <Text variant="callout" style={styles.muted}>
            Loading document...
          </Text>
        </View>
      );
    case "error":
      return (
        <View style={styles.message} accessibilityLiveRegion="polite">
          <Text variant="callout" style={styles.error} selectable>
            {state.message}
          </Text>
          <Button
            label="Try Again"
            icon="refresh"
            size="sm"
            variant="outline"
            accessibilityLabel={`Read the ${copy.title} again`}
            onPress={() => onRetry(document)}
          />
        </View>
      );
    case "empty":
      return (
        <View style={styles.message}>
          <Text variant="callout" style={styles.muted}>
            {copy.empty}
          </Text>
        </View>
      );
    case "ready":
      // Another document mounts a new page, which renders from its first block again.
      return <DocumentPage key={document} rows={state.rows} selectable={selectable} />;
  }
}

/**
 * The number of blocks to render: the first screen at once, then more on each frame until the
 * document is complete.
 */
const useProgressiveCount = (total: number): number => {
  const [count, setCount] = useState(() => Math.min(total, FIRST_BLOCKS));
  useEffect(() => {
    if (count >= total) return;
    const frame = requestAnimationFrame(() =>
      setCount((current) => Math.min(total, current + BLOCKS_PER_FRAME)),
    );
    return () => cancelAnimationFrame(frame);
  }, [count, total]);
  return Math.min(count, total);
};

/**
 * The Markdown blocks of one document in a scroll view. Every block stays mounted while the
 * reader scrolls: a scroll then runs on the UI thread alone, with no block that renders or mounts
 * as it comes into view. The blocks render over the first frames. A task stream update of the
 * document gives the page new rows.
 *
 * On Android, each selectable text finds its place in the window on every frame. While the
 * reader selects text, the blocks out of view leave the native view tree, so only the blocks in
 * view pay that cost.
 */
function DocumentPage({
  rows,
  selectable,
}: {
  rows: DocumentBlockRow[];
  selectable: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const endSpace = useScreenEndSpace(theme.space.huge);
  // Document images and isolated pages load near this viewport.
  const viewport = useListViewport();
  const shown = useProgressiveCount(rows.length);
  return (
    <ViewportProvider value={viewport.store}>
      <View ref={viewport.frameRef} style={styles.fill} onLayout={viewport.onFrameLayout}>
        <ScrollView
          removeClippedSubviews={selectable}
          onScroll={viewport.onScroll}
          scrollEventThrottle={32}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[styles.content, { paddingBottom: endSpace }]}
        >
          {/* Every block stays mounted, so a scroll runs on the UI thread alone. */}
          {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
          {rows.slice(0, shown).map((row) => (
            <DocumentBlock key={row.key} row={row} selectable={selectable} />
          ))}
        </ScrollView>
      </View>
    </ViewportProvider>
  );
}

const DocumentBlock = memo(function DocumentBlock({
  row,
  selectable,
}: {
  row: DocumentBlockRow;
  selectable: boolean;
}) {
  return (
    <View style={styles.block(row.gap)}>
      <MarkdownBlockView
        block={row.block}
        definitions={row.definitions}
        imageContext={row.imageContext}
        selectable={selectable}
      />
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  page: { flex: 1, backgroundColor: theme.desktop.card },
  headerActions: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
  fill: { flex: 1 },
  // `border-b py-2 pr-3 pl-2`: the picker inset leaves the title on the page text edge.
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.md,
    paddingLeft: theme.layout.screenPadding - theme.space.sm,
    paddingRight: theme.layout.screenPadding,
    paddingVertical: theme.space.xs,
    borderBottomWidth: theme.hairline,
    borderBottomColor: theme.desktop.border,
  },
  picker: { flexShrink: 1, minWidth: 0 },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.space.sm,
  },
  title: { flexShrink: 1, color: theme.desktop.foreground },
  meta: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, flexShrink: 0 },
  muted: { color: theme.desktop.mutedForeground },
  error: { color: theme.desktop.destructive },
  // `p-4` around the body text.
  message: {
    width: "100%",
    maxWidth: theme.layout.readableWidth,
    alignSelf: "center",
    alignItems: "flex-start",
    gap: theme.space.md,
    padding: theme.layout.screenPadding,
  },
  content: { paddingTop: theme.layout.screenPadding },
  block: (gap: number) => ({
    width: "100%",
    maxWidth: theme.layout.readableWidth,
    alignSelf: "center",
    paddingTop: gap,
    paddingHorizontal: theme.layout.screenPadding,
  }),
}));
