import type { TaskConfirmCopy } from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import { type ReactElement, type ReactNode, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Button } from "@/ui/button";
import { Icon, type IconName } from "@/ui/icon";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";
import type { CommandFailure } from "@/host-session/command-outcome";
import { InPlaceSheet } from "@/ui/in-place-sheet";

/** The sheet, actions, and command failure that task confirmations share. */
export function TaskConfirmFrame({
  visible,
  title,
  intro,
  tone,
  confirm,
  isPending,
  loading = false,
  failure,
  icon,
  onCancel,
  onDismiss,
  onConfirm,
  children,
}: {
  visible: boolean;
  title: string;
  intro?: ReactNode;
  tone: "warning" | "destructive";
  confirm: { label: string; isBusy: boolean; disabled: boolean };
  isPending: boolean;
  loading?: boolean;
  failure: CommandFailure | null;
  icon?: IconName | undefined;
  onCancel: () => void;
  onDismiss?: (() => void) | undefined;
  onConfirm: () => void;
  children: ReactNode;
}): ReactElement {
  const [closing, setClosing] = useState(false);
  const cancel = () => setClosing(true);
  const dismissed = () => {
    // Reset implementation clears its whole model on Cancel. Let the sheet leave first.
    if (closing) onCancel();
    setClosing(false);
    onDismiss?.();
  };
  return (
    <InPlaceSheet
      visible={visible && !closing}
      title={title}
      intro={intro}
      onClose={cancel}
      onDismiss={dismissed}
      dismissible={!isPending}
      loading={loading && !isPending}
      loadingLabel="Loading task details…"
      closeControl={false}
      footer={
        <>
          <Button
            label="Cancel"
            variant="outline"
            size="lg"
            disabled={isPending}
            onPress={cancel}
            fill
            style={styles.action}
          />
          <Button
            label={confirm.label}
            size="lg"
            variant={tone}
            icon={icon}
            loading={confirm.isBusy}
            disabled={confirm.disabled}
            command
            onPress={onConfirm}
            fill
            style={styles.action}
          />
        </>
      }
    >
      {children}
      {failure ? (
        <Callout
          tone={failure.kind === "unknown" ? "warning" : "destructive"}
          title={failure.title}
          message={failure.message}
        />
      ) : null}
    </InPlaceSheet>
  );
}

export type TaskConfirmViewProps = Omit<
  Parameters<typeof TaskConfirmFrame>[0],
  "title" | "intro" | "tone" | "children"
> & { copy: TaskConfirmCopy };

export function TaskConfirmView({ copy, ...frame }: TaskConfirmViewProps): ReactElement {
  const theme = useAppTheme();
  useAnnounce(frame.visible ? copy.errors.join(" ") : null);
  return (
    <TaskConfirmFrame
      {...frame}
      title={copy.title}
      tone={copy.tone}
      intro={
        <>
          <Text variant="subhead" tone="secondary">
            {copy.description}
          </Text>
          {copy.subject.title ? (
            <Text variant="headline" numberOfLines={2}>
              {copy.subject.title}
            </Text>
          ) : null}
          <Text variant="caption2" tone="tertiary" selectable>
            {copy.subject.id}
          </Text>
        </>
      }
    >
      <View style={styles.section}>
        <Text variant="subhead" weight="medium" tone="secondary">
          What changes
        </Text>
        {copy.changes.map((change) => (
          <View key={change} style={styles.row}>
            <View style={styles.dot} />
            <Text variant="subhead" style={styles.rowText}>
              {change}
            </Text>
          </View>
        ))}
      </View>
      {copy.kept.length > 0 ? (
        <View style={styles.section}>
          <Text variant="subhead" weight="medium" tone="secondary">
            What stays
          </Text>
          {copy.kept.map((kept) => (
            <View key={kept} style={styles.row}>
              <Icon name="check" size={16} colorValue={theme.desktop.mutedForeground} />
              <Text variant="subhead" style={styles.rowText}>
                {kept}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <Callout tone="warning" title="Before you continue" message={copy.warning} />
      {copy.errors.length > 0 ? (
        <Callout
          tone="destructive"
          title="Check failed"
          message={copy.errors.join("\n") + "\nCancel and reopen to check again."}
        />
      ) : null}
    </TaskConfirmFrame>
  );
}

const styles = StyleSheet.create((theme) => ({
  action: { flex: 1, flexBasis: 0, minWidth: 0 },
  section: { gap: theme.space.sm, paddingBottom: theme.space.sm },
  row: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  rowText: { flex: 1 },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    marginHorizontal: 6,
    backgroundColor: theme.desktop.mutedForeground,
  },
}));
