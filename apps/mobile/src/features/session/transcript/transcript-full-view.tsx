import { FlashList, type ListRenderItem } from "@shopify/flash-list";
import type { ReactElement } from "react";
import { ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { InPlaceSheet } from "@/ui/in-place-sheet";
import { CodeBlock } from "@/rich-content/code/code-block";
import type { DiffRow } from "@/rich-content/diff/diff-row-model";
import { diffRowType } from "@/rich-content/diff/diff-row-model";
import { DiffRowView } from "@/rich-content/diff/diff-rows";
import type { TranscriptFullView } from "./transcript-rows-context";

/**
 * The full diff or file text of a file edit, in a sheet over the transcript. The list renders it
 * beside its rows, so the sheet stays open while new content scrolls the row away.
 */
export function TranscriptFullViewSheet({
  view,
  onClose,
}: {
  view: TranscriptFullView | null;
  onClose: () => void;
}): ReactElement | null {
  if (!view) return null;
  return (
    <InPlaceSheet visible title={view.title} onClose={onClose} scrolls={false}>
      {view.kind === "diff" ? (
        <FlashList
          data={view.rows}
          renderItem={renderDiffRow}
          keyExtractor={diffRowKey}
          getItemType={diffRowType}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <CodeBlock code={view.code} language={view.language} showLineNumbers />
        </ScrollView>
      )}
    </InPlaceSheet>
  );
}

const renderDiffRow: ListRenderItem<DiffRow> = ({ item }) => <DiffRowView row={item} />;
const diffRowKey = (row: DiffRow): string => row.key;

const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.layout.screenPadding },
}));
