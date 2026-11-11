import { type ListRenderItem } from "@shopify/flash-list";
import { FlashList } from "@/ui/flash-list";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { ReactElement } from "react";
import { ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { InPlaceSheet } from "@/ui/in-place-sheet";
import { CodeBlock } from "@/rich-content/code/code-block";
import type { DiffRow } from "@/rich-content/diff/diff-row-model";
import { diffRowType } from "@/rich-content/diff/diff-row-model";
import { DiffRowView } from "@/rich-content/diff/diff-rows";
import type { TranscriptFullView } from "./transcript-rows-context";
import { ToolDetailsSheetContent } from "./rows/tool-details-sheet";

/** The live tool call of a message. Recent calls are near the end, so it looks there first. */
const findToolMessage = (
  rows: readonly AgentChatTranscriptRow[],
  messageId: string,
): { message: AgentChatMessage; meta: ToolMeta } | null => {
  const row = rows.findLast((item) => item.kind === "message" && item.message.id === messageId);
  if (row?.kind !== "message" || row.message.meta?.kind !== "tool") return null;
  return { message: row.message, meta: row.message.meta };
};

/**
 * The full diff or file text of a file edit, or the details of a tool call, in a sheet over the
 * transcript. The list renders it beside its rows, so the sheet stays open while new content
 * scrolls the row away. The details of a call read its live message from `rows`.
 */
export function TranscriptFullViewSheet({
  view,
  rows,
  onClose,
}: {
  view: TranscriptFullView | null;
  rows: readonly AgentChatTranscriptRow[];
  onClose: () => void;
}): ReactElement | null {
  if (!view) return null;
  if (view.kind === "tool") {
    const shown = findToolMessage(rows, view.messageId);
    if (!shown) return null;
    return (
      <InPlaceSheet visible title={view.title} onClose={onClose} scrolls={false}>
        <ToolDetailsSheetContent message={shown.message} meta={shown.meta} />
      </InPlaceSheet>
    );
  }
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
