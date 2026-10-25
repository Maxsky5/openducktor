import {
  type FileEditData,
  type FileEditStatus,
  inferFileEditStatus,
  splitFileEditPath,
} from "@openducktor/frontend-core/sessions/messages/file-edit-tool";
import { memo, type ReactElement, useCallback, useMemo } from "react";
import { Text as NativeText, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CodeBlock } from "@/rich-content/code/code-block";
import { languageForFilePath } from "@/rich-content/code/highlight";
import type { DiffRow } from "@/rich-content/diff/diff-row-model";
import { DiffRowView } from "@/rich-content/diff/diff-rows";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button } from "@/ui/button";
import { type AppTheme, monoWeight, sansWeight } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { inlineDiffPreview, previewLines, truncateForDisplay } from "../transcript-text";
import { useTranscriptRows } from "../transcript-rows-context";
import { useDisclosure } from "./disclosure";
import { fileEditBody } from "./file-edit-body";
import { DisclosureMarker, Reveal } from "./row-parts";

const STATUS_LABELS = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
} satisfies Record<FileEditStatus, string>;

/** The desktop status icon and badge letter of a file edit. */
const STATUS_MARKS = {
  modified: { icon: "file-text", badge: "M" },
  added: { icon: "file-plus", badge: "A" },
  deleted: { icon: "file-x", badge: "D" },
} as const satisfies Record<FileEditStatus, { icon: IconName; badge: string }>;

/**
 * The desktop status colors: `text-blue-400`, `text-green-400`, and `text-red-400`. The mobile
 * palette has no blue or red family, so modified uses sky 400 and deleted uses rose 400.
 */
const statusColor = (theme: AppTheme, status: FileEditStatus): string => {
  switch (status) {
    case "modified":
      return theme.palette.sky400;
    case "added":
      return theme.palette.green400;
    case "deleted":
      return theme.palette.rose400;
  }
};

const countLabel = (count: number, one: string, many: string): string =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** What a screen reader hears for the card: the change, the path, and the line counts. */
const fileEditLabel = (data: FileEditData, status: FileEditStatus): string => {
  // A write input is not an applied change yet.
  if (data.kind === "write-input") return `Write input for ${data.filePath}`;
  const counts = [
    data.additions > 0 ? countLabel(data.additions, "added line", "added lines") : null,
    data.deletions > 0 ? countLabel(data.deletions, "deleted line", "deleted lines") : null,
  ].filter((part): part is string => part !== null);
  const suffix = counts.length > 0 ? `, ${counts.join(", ")}` : "";
  return `${STATUS_LABELS[status]} file ${data.filePath}${suffix}`;
};

/**
 * The desktop `AgentChatFileEditCard`: an outlined card with a header of the status icon, the
 * path in monospace with a bold file name, the M, A, or D badge, and the added and deleted line
 * counts. A press opens a short preview of the diff, the edit fragment, or the new content.
 * "Show All Lines" opens the full text in a sheet.
 */
export const FileEditView = memo(function FileEditView({
  data,
  resetKey,
  defaultOpen,
}: {
  data: FileEditData;
  resetKey: string;
  defaultOpen: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const hasContent = data.kind !== "path";
  // The card follows the default until the reader presses it, so a running edit opens when its
  // diff arrives, as it does after a reload.
  const disclosure = useDisclosure(hasContent && defaultOpen, resetKey);
  const status = inferFileEditStatus(data);
  const mark = STATUS_MARKS[status];
  const color = statusColor(theme, status);
  const { dirName, fileName } = splitFileEditPath(data.filePath);
  // A write input is not an applied change yet, so it has no status badge, as on desktop.
  const writeInput = data.kind === "write-input";
  const open = hasContent && disclosure.open;
  // A transcript renders many file edits, so the header picks a plain style entry instead of a
  // stylesheet variant, which runs native code on each render.
  const headerStyle = [styles.header, open ? styles.openHeader : null];
  const header = (
    <>
      {hasContent ? (
        <DisclosureMarker
          open={disclosure.open}
          animated={disclosure.pressed}
          color={theme.desktop.mutedForeground}
          size={12}
        />
      ) : null}
      <Icon name={mark.icon} size={14} colorValue={color} />
      <Text numberOfLines={1} ellipsizeMode="middle" style={styles.path}>
        {dirName.length > 0 ? <NativeText style={styles.dir}>{`${dirName}/`}</NativeText> : null}
        <NativeText style={styles.fileName}>{fileName}</NativeText>
      </Text>
      {writeInput ? null : (
        <View style={[styles.badge, { borderColor: theme.desktop.input }]}>
          <Text style={[styles.badgeText, { color }]}>{mark.badge}</Text>
        </View>
      )}
      {data.additions > 0 || data.deletions > 0 ? (
        <LineCounts additions={data.additions} deletions={data.deletions} />
      ) : null}
    </>
  );
  const label = fileEditLabel(data, status);
  return (
    <View style={styles.block}>
      {hasContent ? (
        <Touchable
          feedback="highlight"
          onPress={disclosure.toggle}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={disclosure.open ? "Hides the changes." : "Shows the changes."}
          accessibilityState={{ expanded: disclosure.open }}
          style={headerStyle}
        >
          {header}
        </Touchable>
      ) : (
        <View style={headerStyle} accessible accessibilityRole="text" accessibilityLabel={label}>
          {header}
        </View>
      )}
      {open ? (
        <Reveal animate={disclosure.pressed}>
          <FileEditContent data={data} />
        </Reveal>
      ) : null}
    </View>
  );
});

/** The added and deleted line counts, in green and rose. */
function LineCounts({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.counts}>
      {additions > 0 ? (
        <Text style={[styles.count, { color: theme.palette.green400 }]}>{`+${additions}`}</Text>
      ) : null}
      {deletions > 0 ? (
        <Text style={[styles.count, { color: theme.palette.rose400 }]}>{`-${deletions}`}</Text>
      ) : null}
    </View>
  );
}

/** The open card: a diff or fragment preview, or the first lines of the new text. */
function FileEditContent({ data }: { data: FileEditData }): ReactElement | null {
  const body = useMemo(() => fileEditBody(data), [data]);
  if (!body) return null;
  return (
    <>
      {body.label ? <Text style={styles.bodyLabel}>{body.label}</Text> : null}
      {body.kind === "diff" ? (
        <DiffPreview rows={body.rows} filePath={data.filePath} />
      ) : (
        <ContentPreview content={body.content} filePath={data.filePath} />
      )}
    </>
  );
}

/** The first diff lines. The file header row repeats the block header, so the preview skips it. */
function DiffPreview({
  rows,
  filePath,
}: {
  rows: readonly DiffRow[];
  filePath: string;
}): ReactElement {
  const { openFullView } = useTranscriptRows();
  const bodyRows = useMemo(() => rows.filter((row) => row.kind !== "file"), [rows]);
  const lineCount = useMemo(() => rows.filter((row) => row.kind === "line").length, [rows]);
  const openFullDiff = useCallback(
    () => openFullView({ kind: "diff", title: filePath, rows }),
    [filePath, openFullView, rows],
  );
  const { previewRows, hidden } = inlineDiffPreview(bodyRows);
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.diff}
        contentContainerStyle={styles.diffContent}
      >
        <View style={styles.diffContent}>
          {previewRows.map((row) => (
            <DiffRowView key={row.key} row={row} wrap={false} />
          ))}
        </View>
      </ScrollView>
      {hidden > 0 ? (
        <View style={styles.more}>
          <Button
            label={`Show All ${lineCount.toLocaleString("en-US")} Lines`}
            accessibilityHint={`Opens the full diff. ${hidden.toLocaleString("en-US")} rows are not shown here.`}
            size="sm"
            variant="plain"
            onPress={openFullDiff}
          />
        </View>
      ) : null}
    </View>
  );
}

/** The first lines of a new file. "Show All Lines" opens the whole text in a sheet. */
function ContentPreview({
  content,
  filePath,
}: {
  content: string;
  filePath: string;
}): ReactElement {
  const { openFullView } = useTranscriptRows();
  const shown = useMemo(() => truncateForDisplay(content).text, [content]);
  const { preview, hiddenLines } = useMemo(() => previewLines(shown), [shown]);
  const language = languageForFilePath(filePath);
  const openFull = useCallback(
    () => openFullView({ kind: "content", title: filePath, code: shown, language }),
    [filePath, language, openFullView, shown],
  );
  return (
    <View>
      <CodeBlock code={preview} language={language} />
      {hiddenLines > 0 ? (
        <View style={styles.more}>
          <Button
            label="Show All Lines"
            accessibilityHint={`Opens the whole file. ${hiddenLines.toLocaleString("en-US")} lines are not shown here.`}
            size="sm"
            variant="plain"
            onPress={openFull}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The desktop file card: `my-1.5 rounded-lg border border-border bg-card`, inside the `px-1`
  // of the tool container.
  block: {
    marginHorizontal: theme.space.xs,
    marginVertical: 6,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: 40,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  openHeader: { borderBottomWidth: 1, borderBottomColor: theme.desktop.border },
  path: {
    flex: 1,
    minWidth: 0,
    ...monoWeight("regular"),
    fontSize: 12,
    lineHeight: 16,
    color: theme.desktop.foreground,
  },
  dir: { color: theme.desktop.mutedForeground },
  fileName: monoWeight("semibold"),
  badge: {
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 6,
  },
  badgeText: { ...monoWeight("medium"), fontSize: 10.5, lineHeight: 15 },
  counts: { flexDirection: "row", alignItems: "center", gap: 6 },
  count: { ...monoWeight("regular"), fontSize: 11, lineHeight: 15, fontVariant: ["tabular-nums"] },
  diff: { paddingBottom: theme.space.xs },
  diffContent: { minWidth: "100%" },
  more: { paddingHorizontal: theme.space.xs, paddingBottom: theme.space.xs },
  // The desktop `px-3 py-1 text-[11px] text-muted-foreground` label of a fragment or input.
  bodyLabel: {
    ...sansWeight("regular"),
    fontSize: 11.5,
    lineHeight: 16,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.xs,
    color: theme.desktop.mutedForeground,
  },
}));
