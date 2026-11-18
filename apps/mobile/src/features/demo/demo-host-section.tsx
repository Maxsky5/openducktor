import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { type ReactElement, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useFeedbackStore, useHostSessionOwner } from "@/app-shell/app-services";
import { Button } from "@/ui/button";
import { useConfirm } from "@/ui/confirm-dialog";
import { DividedCard, SettingsIconTile, SettingsSection } from "@/ui/settings-layout";
import { Text } from "@/ui/text";

/** The demo host of the Host tab: what the demo is, then Reset demo and Exit demo. */
export function DemoHostSection(): ReactElement {
  const owner = useHostSessionOwner();
  const confirm = useConfirm();
  const { feedback } = useFeedbackStore();
  const [busy, setBusy] = useState<"reset" | "exit" | null>(null);
  /** The owner shows the cleanup failures. Other failures show here. */
  const run = async (action: "reset" | "exit") => {
    const confirmed = await confirm(
      action === "reset"
        ? {
            title: "Reset demo?",
            message: "The sample data comes back. Your demo changes are discarded.",
            confirmLabel: "Reset demo",
            icon: "rotate-ccw",
            destructive: true,
          }
        : {
            title: "Exit demo?",
            message: "Your demo changes are discarded. Your saved hosts stay as they are.",
            confirmLabel: "Exit demo",
            icon: "arrow-left",
          },
    );
    if (!confirmed) return;
    setBusy(action);
    try {
      await (action === "reset" ? owner.resetDemo() : owner.exitDemo());
    } catch (cause) {
      setBusy(null);
      feedback.show("error", `The demo did not ${action}`, { description: errorMessage(cause) });
    }
  };
  return (
    <SettingsSection title="Current host">
      <DividedCard>
        <View style={styles.row}>
          <SettingsIconTile icon="flask-conical" selected />
          <View style={styles.text}>
            <Text weight="medium" numberOfLines={1}>
              Demo host
            </Text>
            <Text variant="subhead" tone="tertiary">
              Sample data on this device. Nothing connects to a computer.
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Button
            label="Reset demo"
            icon="rotate-ccw"
            variant="outline"
            loading={busy === "reset"}
            disabled={busy !== null}
            onPress={() => void run("reset")}
            fill
          />
          <Button
            label="Exit demo"
            icon="arrow-left"
            variant="outline"
            loading={busy === "exit"}
            disabled={busy !== null}
            onPress={() => void run("exit")}
            fill
          />
        </View>
      </DividedCard>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    padding: theme.space.lg,
  },
  text: { flex: 1, minWidth: 0, gap: 2 },
  actions: { gap: theme.space.sm, padding: theme.space.lg },
}));
