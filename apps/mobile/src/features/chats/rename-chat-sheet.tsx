import {
  WORKSPACE_SESSION_MANUAL_TITLE_LIMIT,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  isOutcomeUnknown,
  RESULT_UNKNOWN_TITLE,
} from "@openducktor/frontend-core/lib/command-outcome";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useMountedRef } from "@openducktor/frontend-core/lib/use-mounted-ref";
import {
  canSaveWorkspaceSessionRename,
  RENAME_CHAT_TEXT,
  useRenameWorkspaceSession,
  workspaceSessionRenameInitialTitle,
} from "@openducktor/frontend-core/workspace-sessions/workspace-session-rename";
import { useRouter } from "expo-router";
import { type ReactElement, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCommandGate } from "@/host-session/active-session-context";
import { SheetFrame } from "@/navigation/sheet-frame";
import { Button } from "@/ui/button";
import { TextField } from "@/ui/fields";
import { Callout } from "@/ui/callout";
import { type SheetFieldFocus, useSheetFieldFocus } from "@/ui/use-sheet-field-focus";
import type { ChatSheetParams } from "./chat-sheet-params";
import { ChatSheetStateScreen } from "./chat-sheet-states";
import { useChatRecord } from "./use-chat-record";

const TITLE = "Rename Chat";

function RenameChatForm({
  workspaceId,
  record,
  focus,
}: {
  workspaceId: string;
  record: WorkspaceSession;
  focus: SheetFieldFocus;
}): ReactElement {
  const router = useRouter();
  const { feedback } = useClientConnection();
  const mounted = useMountedRef();
  const initialTitle = workspaceSessionRenameInitialTitle(record);
  const [draft, setDraft] = useState(initialTitle);
  const rename = useRenameWorkspaceSession({
    workspaceId,
    sessionId: record.id,
    onRenamed: () => {
      feedback.show("success", "Chat renamed.");
      if (mounted.current) router.back();
    },
  });
  const canSave = canSaveWorkspaceSessionRename({
    initialTitle,
    draft,
    isPending: rename.isPending,
  });
  const gate = useCommandGate();
  // The return key sends the rename too, so it follows the command gate like Save.
  const save = () => {
    if (canSave && gate.open) rename.mutate(draft.trim());
  };
  const unknown = rename.error !== null && isOutcomeUnknown(rename.error);
  return (
    <SheetFrame title={TITLE} subtitle={RENAME_CHAT_TEXT.description} closable={!rename.isPending}>
      <View style={styles.body}>
        <TextField
          label={RENAME_CHAT_TEXT.nameLabel}
          value={draft}
          onChangeText={setDraft}
          maxLength={WORKSPACE_SESSION_MANUAL_TITLE_LIMIT}
          placeholder={record.generatedTitle ?? "Untitled session"}
          inputRef={focus.ref}
          autoFocus={focus.autoFocus}
          selectTextOnFocus
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="done"
          onSubmitEditing={save}
          editable={!rename.isPending}
          error={rename.error && !unknown ? errorMessage(rename.error) : null}
        />
        {unknown && rename.error ? (
          <Callout
            tone="warning"
            title={RESULT_UNKNOWN_TITLE}
            message={errorMessage(rename.error)}
          />
        ) : null}
        <View style={styles.actions}>
          <Button
            label="Cancel"
            variant="outline"
            size="lg"
            fill
            disabled={rename.isPending}
            onPress={() => router.back()}
          />
          <Button
            label={RENAME_CHAT_TEXT.save}
            size="lg"
            fill
            command
            loading={rename.isPending}
            disabled={!canSave}
            onPress={save}
          />
        </View>
      </View>
    </SheetFrame>
  );
}

function RenameChatRead({ params }: { params: ChatSheetParams }): ReactElement {
  const read = useChatRecord(params.workspaceId, params.sessionId);
  // The route owns the focus, so a form that shows after the chat read still gets it.
  const focus = useSheetFieldFocus();
  if (read.status === "ready") {
    return (
      <RenameChatForm workspaceId={read.workspace.workspaceId} record={read.record} focus={focus} />
    );
  }
  return <ChatSheetStateScreen title={TITLE} read={read} />;
}

/** Renames a chat. A blank name returns it to its generated title. Null params show a bad link. */
export function RenameChatSheet({ params }: { params: ChatSheetParams | null }): ReactElement {
  if (!params) return <ChatSheetStateScreen title={TITLE} read={{ status: "invalid" }} />;
  return <RenameChatRead params={params} />;
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.space.lg },
  actions: { flexDirection: "row", gap: theme.space.md },
}));
