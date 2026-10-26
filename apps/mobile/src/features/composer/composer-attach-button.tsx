import type { ReactElement } from "react";
import { ActionMenu } from "@/ui/action-menu";
import { blurFocusedField } from "@/ui/keyboard-dismiss";
import { type AttachmentPickers, attachmentKindsText } from "./composer-attachments";
import { QuietIconControl } from "./composer-controls";
import type { useAttachmentPickers } from "./use-attachment-pickers";

/**
 * The desktop attach control: a quiet paperclip. On the phone it opens a menu with the photo
 * library and the file picker. It offers only the kinds that the model takes, and names them.
 * Staging is a host command, so picking follows the command gate. A press blurs the message field
 * first, so Android does not open the keyboard again when the menu or the picker closes.
 */
export function ComposerAttachButton({
  pickers,
  picking,
  accessibilityLabel,
}: {
  pickers: AttachmentPickers;
  picking: ReturnType<typeof useAttachmentPickers>;
  /** The name of the control. It defaults to "Add attachment" with the kinds it takes. */
  accessibilityLabel?: string | undefined;
}): ReactElement {
  const available = picking.canPickPhotos || picking.canPickFiles;
  const label =
    accessibilityLabel ??
    (pickers.unavailableReason
      ? `Add attachment. ${pickers.unavailableReason}`
      : `Add attachment: ${attachmentKindsText(pickers.kinds)}`);
  return (
    <ActionMenu
      title={pickers.unavailableReason ?? `Attach ${attachmentKindsText(pickers.kinds)}`}
      items={[
        {
          id: "photos",
          title: "Photo Library",
          icon: "image",
          disabled: !picking.canPickPhotos,
          command: true,
        },
        {
          id: "files",
          title: "Files",
          icon: "folder",
          disabled: !picking.canPickFiles,
          command: true,
        },
      ]}
      onSelect={(id) => {
        if (id === "photos") void picking.pickPhotos();
        if (id === "files") void picking.pickFiles();
      }}
    >
      <QuietIconControl
        icon="paperclip"
        accessibilityLabel={label}
        command
        disabled={!available || picking.isPicking}
        onPress={blurFocusedField}
      />
    </ActionMenu>
  );
}
