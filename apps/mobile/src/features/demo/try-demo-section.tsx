import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { type ReactElement, useState } from "react";
import { useFeedbackStore, useHostSessionOwner } from "@/app-shell/app-services";
import { DraftSaveBeforeSwitchError } from "@/host-session/host-session-owner";
import { useConfirmDraftLoss } from "@/hosts/confirm-draft-loss";
import { useConfirm } from "@/ui/confirm-dialog";
import { DividedCard, SettingsIconTile, SettingsRow, SettingsSection } from "@/ui/settings-layout";

/**
 * The way into the demo from a connected host. The host closes as a host switch does, so its
 * drafts and data stay saved, and Exit demo leads back to host selection.
 */
export function TryDemoSection({ hostLabel }: { hostLabel: string }): ReactElement {
  const owner = useHostSessionOwner();
  const confirm = useConfirm();
  const confirmDraftLoss = useConfirmDraftLoss();
  const { feedback } = useFeedbackStore();
  const [opening, setOpening] = useState(false);

  const enter = async (discardUnsavedDrafts = false): Promise<void> => {
    try {
      await owner.enterDemo({ discardUnsavedDrafts });
    } catch (cause) {
      if (!(cause instanceof DraftSaveBeforeSwitchError)) {
        setOpening(false);
        feedback.show("error", "The demo did not open", { description: errorMessage(cause) });
      } else if (await confirmDraftLoss(cause)) await enter(true);
      else setOpening(false);
    }
  };

  const open = async () => {
    const confirmed = await confirm({
      title: "Try the demo?",
      message: `The app closes the connection to ${hostLabel}. Its drafts and data stay saved. To come back, tap Exit demo on the Host tab, then select ${hostLabel}.`,
      confirmLabel: "Try demo",
      icon: "play",
    });
    if (!confirmed) return;
    setOpening(true);
    // The demo replaces this screen when it opens, so only a failure ends the busy state here.
    await enter();
  };

  return (
    <SettingsSection
      title="Demo"
      description="Explore OpenDucktor with sample data on this device."
    >
      <DividedCard>
        <SettingsRow
          title={opening ? "Opening the demo…" : "Try demo"}
          description="Your hosts, drafts, and data stay as they are."
          leading={<SettingsIconTile icon="flask-conical" />}
          onPress={opening ? undefined : () => void open()}
          accessibilityHint="Closes the connection to this host and opens the demo with sample data."
        />
      </DividedCard>
    </SettingsSection>
  );
}
