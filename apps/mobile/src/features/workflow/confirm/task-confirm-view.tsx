import type { TaskConfirmCopy } from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/ui/button";
import type { IconName } from "@/ui/icon";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { useAnnounce } from "@/ui/use-announce";
import type { CommandFailure } from "@/host-session/command-outcome";
import { InPlaceSheet } from "@/ui/in-place-sheet";
import { titleCase } from "../start-session/start-form-model";

/** The sheet, the footer, and the failure that every task confirmation shares. */
export function TaskConfirmFrame({
  visible,
  title,
  tone,
  confirm,
  isPending,
  failure,
  icon,
  onCancel,
  onConfirm,
  children,
}: {
  visible: boolean;
  title: string;
  tone: "warning" | "destructive";
  /** The Confirm control: its label, and whether it waits for the action or the impact reads. */
  confirm: { label: string; isBusy: boolean; disabled: boolean };
  isPending: boolean;
  failure: CommandFailure | null;
  /** The desktop icon of the confirm button, such as `trash` for Delete. */
  icon?: IconName | undefined;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <InPlaceSheet
      visible={visible}
      title={title}
      onClose={onCancel}
      dismissible={!isPending}
      closeControl={false}
      footer={
        <>
          <Button
            label="Cancel"
            variant="outline"
            size="lg"
            disabled={isPending}
            onPress={onCancel}
            fill
          />
          <Button
            // The shared copy uses the sentence case of the desktop buttons.
            label={titleCase(confirm.label)}
            size="lg"
            variant={tone}
            icon={icon}
            loading={confirm.isBusy}
            disabled={confirm.disabled}
            command
            onPress={onConfirm}
            fill
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
  "title" | "tone" | "children"
> & {
  copy: TaskConfirmCopy;
  /** A failed impact read. The confirmation still states what it does not know. */
  impactError: string | null;
};

/**
 * A task confirmation. It states what the host keeps and removes, waits for the impact reads, and
 * shows a failure with the host reason where the user started the action.
 */
export function TaskConfirmView({
  copy,
  impactError,
  ...frame
}: TaskConfirmViewProps): ReactElement {
  styles.useVariants({ tone: copy.tone });
  // A failed impact check shows as a line of the impact, so VoiceOver hears it.
  const failedChecks = copy.lines
    .filter((line) => line.error)
    .map((line) => line.text)
    .join(" ");
  useAnnounce(frame.visible ? failedChecks : null);
  return (
    <TaskConfirmFrame {...frame} title={copy.title} tone={copy.tone}>
      <Text variant="body" style={styles.description}>
        {copy.descriptionSegments.map((segment, index) => (
          <Text
            // The segments of one description never change order.
            // react-doctor-disable-next-line react-doctor/no-array-index-as-key
            key={index}
            variant="body"
            weight={segment.emphasis ? "medium" : "regular"}
            style={segment.emphasis ? styles.emphasis : null}
          >
            {segment.text}
          </Text>
        ))}
      </Text>
      <View style={styles.impact} accessibilityLiveRegion="polite">
        {copy.lines.map((line) => (
          <Text
            key={line.text}
            variant="subhead"
            weight={line.emphasis ? "medium" : "regular"}
            style={line.error ? styles.errorLine : styles.line}
          >
            {line.text}
          </Text>
        ))}
      </View>
      {impactError ? (
        <Callout tone="warning" title="Cleanup impact unknown" message={impactError} />
      ) : null}
    </TaskConfirmFrame>
  );
}

const styles = StyleSheet.create((theme) => ({
  description: { color: theme.desktop.mutedForeground },
  emphasis: { color: theme.desktop.foreground },
  impact: {
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.md,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    variants: {
      tone: {
        warning: {
          borderColor: theme.desktop.warningBorder,
          backgroundColor: theme.desktop.warningSurface,
        },
        destructive: {
          borderColor: theme.desktop.destructiveBorder,
          backgroundColor: theme.desktop.destructiveSurface,
        },
      },
    },
  },
  line: {
    variants: {
      tone: {
        warning: { color: theme.desktop.warningSurfaceForeground },
        destructive: { color: theme.desktop.destructiveSurfaceForeground },
      },
    },
  },
  errorLine: { color: theme.desktop.destructiveMuted },
}));
