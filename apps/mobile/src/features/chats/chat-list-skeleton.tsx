import { Fragment, type ReactElement, type ReactNode } from "react";
import { type DimensionValue, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SkeletonFrame } from "@/ui/placeholders";
import { ArchivedChatRowPlaceholder } from "./archived-chat-row";
import { ChatSectionHeaderPlaceholder } from "./chat-section-header";

type PlaceholderRow = { id: string; title: DimensionValue; detail: DimensionValue };

/**
 * Two day sections of the rows to come, for a short first section and a longer second one, with
 * text widths that change from row to row as real titles and folders do.
 */
const SECTIONS: readonly { id: string; rows: readonly PlaceholderRow[] }[] = [
  {
    id: "section-1",
    rows: [
      { id: "row-1", title: "62%", detail: "84%" },
      { id: "row-2", title: "48%", detail: "76%" },
    ],
  },
  {
    id: "section-2",
    rows: [
      { id: "row-3", title: "70%", detail: "80%" },
      { id: "row-4", title: "54%", detail: "72%" },
      { id: "row-5", title: "66%", detail: "86%" },
      { id: "row-6", title: "44%", detail: "78%" },
    ],
  },
];

/**
 * The archived chats for their first load, in the layout of the loaded list: the list header, the
 * day sections, and the chat cards. The list then takes the place of each part.
 */
export function ChatListSkeleton({ header }: { header: ReactNode }): ReactElement {
  return (
    <ScrollView
      scrollEnabled={false}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      {header}
      <SkeletonFrame label="Loading chats">
        {SECTIONS.map((section, index) => (
          <Fragment key={section.id}>
            <ChatSectionHeaderPlaceholder first={index === 0} />
            {section.rows.map((row) => (
              <ArchivedChatRowPlaceholder
                key={row.id}
                titleWidth={row.title}
                detailWidth={row.detail}
              />
            ))}
          </Fragment>
        ))}
      </SkeletonFrame>
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The end space of the archived chat list.
  content: { paddingBottom: theme.space.xxxl },
}));
