import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SheetFrame } from "@/navigation/sheet-frame";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { ChatRecordRead } from "./use-chat-record";

type ChatSheetRead = Exclude<ChatRecordRead, { status: "ready" }> | { status: "invalid" };

/** The states of a chat sheet before its chat is known. */
function ChatSheetState({ read }: { read: ChatSheetRead }): ReactElement {
  if (read.status === "loading") return <LoadingState label="Loading chat" />;
  if (read.status === "error") {
    return <ErrorState title="The chat did not load" message={read.message} onRetry={read.retry} />;
  }
  if (read.status === "invalid") {
    return (
      <EmptyState
        icon="circle-alert"
        title="Link Not Valid"
        message="Close this sheet and select the chat again."
      />
    );
  }
  return <EmptyState icon="message-square-off" title="Chat Not Available" message={read.reason} />;
}

/** A compact chat sheet that shows a state before its chat is known. */
export function ChatSheetStateScreen({
  title,
  read,
}: {
  title: string;
  read: ChatSheetRead;
}): ReactElement {
  return (
    <SheetFrame title={title}>
      <View style={styles.state}>
        <ChatSheetState read={read} />
      </View>
    </SheetFrame>
  );
}

const styles = StyleSheet.create(() => ({
  // A fitted sheet has no height of its own, so a state takes a fixed one.
  state: { height: 260 },
}));
