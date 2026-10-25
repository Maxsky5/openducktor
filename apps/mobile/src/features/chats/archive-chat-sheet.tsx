import type { WorkspaceRecord, WorkspaceSession } from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  isOutcomeUnknown,
  RESULT_UNKNOWN_TITLE,
} from "@openducktor/frontend-core/lib/command-outcome";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useMountedRef } from "@openducktor/frontend-core/lib/use-mounted-ref";
import { workspaceSessionArchivePreviewQueryOptions } from "@openducktor/frontend-core/queries/workspace-session-archive";
import { workspaceSessionTitle } from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import {
  type ArchiveWorkspaceSessionInput,
  useArchiveWorkspaceSession,
} from "@openducktor/frontend-core/workspace-sessions/use-archive-workspace-session";
import {
  ARCHIVE_CHAT_TEXT,
  isWorktreeChat,
} from "@openducktor/frontend-core/workspace-sessions/workspace-session-archive-plan";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { type ReactElement, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SheetFrame } from "@/navigation/sheet-frame";
import { useAppTheme } from "@/theme/app-theme-context";
import { RuntimeIcon } from "@/ui/brand-icons";
import { Button } from "@/ui/button";
import { SwitchRow } from "@/ui/fields";
import { Icon } from "@/ui/icon";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import {
  type ArchiveChatForm as ArchiveChatFormModel,
  archiveChatForm,
  archiveChatInput,
} from "./archive-chat-form";
import type { ChatSheetParams } from "./chat-sheet-params";
import { ChatSheetStateScreen } from "./chat-sheet-states";
import { useChatRecord } from "./use-chat-record";

const TITLE = "Archive Chat";

/** What happens to the worktree, under the worktree switch. The branch name is code. */
function WorktreeNotice({
  notice,
  checking,
}: {
  notice: ArchiveChatFormModel["notice"];
  checking: boolean;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.footer}>
      {checking ? (
        <View style={styles.checking} accessibilityRole="progressbar">
          <LoaderSpinner size={14} color={theme.desktop.mutedForeground} />
          <Text variant="footnote" style={styles.checkingText}>
            {ARCHIVE_CHAT_TEXT.checkingChanges}
          </Text>
        </View>
      ) : null}
      {notice.kind === "delete_branch" ? (
        <Text variant="footnote" tone="secondary">
          {"Branch "}
          <Text variant="monoSmall" tone="secondary">
            {notice.branchName ?? "…"}
          </Text>{" "}
          {notice.consequence}
        </Text>
      ) : (
        <Text variant="footnote" tone="secondary">
          {notice.text}
        </Text>
      )}
    </View>
  );
}

type ArchiveTarget = { workspace: WorkspaceRecord; record: WorkspaceSession };

function ArchiveChatForm({
  target,
  archive,
  onConfirm,
}: {
  target: ArchiveTarget;
  archive: ReturnType<typeof useArchiveWorkspaceSession>;
  onConfirm: (input: ArchiveWorkspaceSessionInput) => void;
}): ReactElement {
  const { workspace, record } = target;
  const router = useRouter();
  const theme = useAppTheme();
  // Worktree removal starts turned on, as on desktop.
  const [wantsWorktreeRemoval, setWantsWorktreeRemoval] = useState(true);
  const preview = useQuery({
    ...workspaceSessionArchivePreviewQueryOptions(workspace.workspaceId, record.id),
    enabled: isWorktreeChat(record),
  });
  const form = archiveChatForm({
    record,
    wantsWorktreeRemoval,
    preview,
    isArchiving: archive.isPending,
  });
  const confirm = () => {
    if (form.canArchive)
      onConfirm(archiveChatInput({ workspace, record, wantsWorktreeRemoval, preview }));
  };
  const unknown = archive.error !== null && isOutcomeUnknown(archive.error);
  const { notice } = form;
  return (
    <SheetFrame
      title={TITLE}
      subtitle={ARCHIVE_CHAT_TEXT.description}
      closable={!archive.isPending}
    >
      <View style={styles.body}>
        <View style={styles.chatCard}>
          <View style={styles.runtimeTile}>
            <RuntimeIcon runtimeKind={record.runtimeKind} size={16} />
          </View>
          <View style={styles.chatText}>
            <Text style={styles.chatTitle}>{workspaceSessionTitle(record)}</Text>
            <Text variant="monoSmall" selectable style={styles.chatPath}>
              {record.executionTarget.workingDirectory}
            </Text>
          </View>
        </View>
        <Text variant="footnote" style={styles.muted}>
          {ARCHIVE_CHAT_TEXT.stopsWork}
        </Text>
        {form.offersWorktreeRemoval ? (
          <View style={styles.worktree}>
            <View style={styles.switchCard}>
              <SwitchRow
                label={ARCHIVE_CHAT_TEXT.removeWorktree}
                value={form.removeWorktree}
                onValueChange={setWantsWorktreeRemoval}
                disabled={
                  archive.isPending || form.sharedNotice !== null || form.taskNotice !== null
                }
              />
            </View>
            {form.sharedNotice ? (
              <Text variant="footnote" style={styles.muted}>
                {form.sharedNotice}
              </Text>
            ) : null}
            {form.taskNotice ? (
              <Text variant="footnote" style={styles.muted}>
                {form.taskNotice}
              </Text>
            ) : null}
            <WorktreeNotice notice={notice} checking={preview.isFetching} />
          </View>
        ) : notice.kind === "delete_branch" ? null : (
          <Text variant="footnote" style={styles.muted}>
            {notice.text}
          </Text>
        )}
        {preview.error ? (
          <Callout
            tone="destructive"
            title="Worktree check failed"
            message={errorMessage(preview.error)}
            action={
              <Button
                label="Check Again"
                size="sm"
                variant="outline"
                onPress={() => {
                  void preview.refetch();
                }}
              />
            }
          />
        ) : null}
        {form.warnings.map((warning) => (
          <View key={warning.kind} style={styles.warning} accessible accessibilityRole="alert">
            {/* As on desktop, only the local changes warning has the alert mark. */}
            {warning.kind === "local_changes" ? (
              <Icon name="triangle-alert" size={16} colorValue={theme.desktop.destructiveMuted} />
            ) : null}
            <Text variant="footnote" style={styles.warningText}>
              {warning.text}
            </Text>
          </View>
        ))}
        {archive.error ? (
          <Callout
            tone={unknown ? "warning" : "destructive"}
            title={unknown ? RESULT_UNKNOWN_TITLE : "The chat was not archived"}
            message={errorMessage(archive.error)}
          />
        ) : null}
        <View style={styles.actions}>
          <Button
            label="Cancel"
            variant="outline"
            size="lg"
            fill
            disabled={archive.isPending}
            onPress={() => router.back()}
          />
          <Button
            label={archive.isPending ? ARCHIVE_CHAT_TEXT.confirming : ARCHIVE_CHAT_TEXT.confirm}
            variant={form.destructive ? "destructive" : "filled"}
            size="lg"
            icon="archive"
            fill
            command
            loading={archive.isPending}
            disabled={!form.canArchive}
            onPress={confirm}
          />
        </View>
      </View>
    </SheetFrame>
  );
}

function ArchiveChatRead({ params }: { params: ChatSheetParams }): ReactElement {
  const router = useRouter();
  const { feedback } = useClientConnection();
  const mounted = useMountedRef();
  const read = useChatRecord(params.workspaceId, params.sessionId);
  const [confirmed, setConfirmed] = useState<ArchiveTarget | null>(null);
  // The sheet owns the command, so its result still closes the sheet after the form changes.
  const archive = useArchiveWorkspaceSession(() => {
    feedback.show("success", "Chat archived.");
    if (mounted.current) router.back();
  });
  // An archived chat leaves the active list while the sheet closes; show nothing in that time.
  if (archive.isSuccess) return <SheetFrame title={TITLE} closable={false} />;
  const renderForm = (target: ArchiveTarget) => (
    <ArchiveChatForm
      target={target}
      archive={archive}
      onConfirm={(input) => {
        setConfirmed(target);
        archive.mutate(input);
      }}
    />
  );
  if (read.status === "ready") return renderForm(read);
  // The host event of the archive can remove the chat from the active list before the command
  // reply. Keep the confirmed chat on screen until the reply comes.
  if (archive.isPending && confirmed) return renderForm(confirmed);
  return <ChatSheetStateScreen title={TITLE} read={read} />;
}

/**
 * Archives a chat with the desktop rules: it stops the chat's work and can remove its worktree.
 * Null params show a bad link.
 */
export function ArchiveChatSheet({ params }: { params: ChatSheetParams | null }): ReactElement {
  if (!params) return <ChatSheetStateScreen title={TITLE} read={{ status: "invalid" }} />;
  return <ArchiveChatRead params={params} />;
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.space.lg },
  chatCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.colors.panelFill,
  },
  runtimeTile: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.desktop.background,
  },
  chatText: { flex: 1, minWidth: 0, gap: 4 },
  chatTitle: {
    ...theme.type.body,
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
    color: theme.desktop.foreground,
  },
  chatPath: { color: theme.desktop.mutedForeground },
  muted: { color: theme.desktop.mutedForeground },
  worktree: { gap: theme.space.sm },
  switchCard: {
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    overflow: "hidden",
  },
  footer: { gap: theme.space.sm },
  checking: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  checkingText: { color: theme.desktop.mutedForeground },
  warning: { flexDirection: "row", gap: theme.space.sm, alignItems: "flex-start" },
  warningText: { flex: 1, color: theme.desktop.destructiveMuted },
  actions: { flexDirection: "row", gap: theme.space.md },
}));
