// One command of the Keyboard shortcuts section: SettingsShortcutRow of settings-shortcut-row.tsx,
// with the name, the line that says when the command runs, and the keys as ShortcutKeycaps, or Add
// keys for a command without keys. The row of a command that a scene records has the parts of the
// recorder too: the Custom badge, the recording hint, Cancel with Esc, and Remove. Its static
// frame shows the recorded keys. shortcut-settings.ts changes them.
import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";
import type { KeyPlatform } from "../keys";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Kbd } from "../ui/Kbd";
import "./ShortcutRow.css";

/** The key caps of a shortcut on each platform, as shortcutKeyParts of key-labels.ts gives them. */
export type PlatformKeys = Readonly<Record<KeyPlatform, readonly string[]>>;

/** A command of the list, as buildCommandViews of settings-shortcut-model.ts gives it. */
export type ShortcutCommand = {
  id: string;
  label: string;
  /** When the command runs: whenLabel of settings-shortcut-model.ts. */
  when: string;
  /** The user may change when the command runs, so the row shows the When picker. */
  picker: boolean;
  /** The keys of the command, or null for a command without keys. */
  keys: PlatformKeys | null;
};

/** The words of the row and of its recorder. */
export const ROW_TEXT = {
  when: "When",
  addKeys: "Add keys",
  pressKeys: "Press keys…",
  custom: "Custom",
  cancel: "Cancel",
  escape: "Esc",
  remove: "Remove",
} as const;

/** The modifiers that a recorded shortcut needs: recordingModifierNames of key-labels.ts. */
const RECORDING_MODIFIERS = {
  mac: "⌘ ⌃ or ⌥",
  pc: "Ctrl or Alt",
} as const satisfies Record<KeyPlatform, string>;

/** The guidance of the recorder while no key is down. */
export function recordingHint(platform: KeyPlatform): string {
  return `Hold ${RECORDING_MODIFIERS[platform]} and press a key.`;
}

/** The text of the field of the recorder while modifiers are down, such as "⇧ ⌘ …". */
export function heldText(modifiers: readonly string[]): string {
  return `${modifiers.join(" ")} …`;
}

type ShortcutRowProps = {
  command: ShortcutCommand;
  platform: KeyPlatform;
  /** The keys that a scene records in the row. The row then has the parts of the recorder. */
  recorded?: PlatformKeys | undefined;
  hidden?: boolean;
};

export function ShortcutRow({
  command,
  platform,
  recorded,
  hidden = false,
}: ShortcutRowProps): ReactElement {
  const keys = (recorded ?? command.keys)?.[platform];
  return (
    <li className="sr-row" hidden={hidden} data-command={command.id}>
      <div className="sr-main">
        <p className="sr-title">
          {command.label}
          {recorded && (
            <Badge className="sr-badge" data-custom="">
              {ROW_TEXT.custom}
            </Badge>
          )}
        </p>
        <div className="sr-when" data-when="">
          {ROW_TEXT.when}
          {command.picker ? (
            <span className="sr-picker">
              {command.when}
              <ChevronDown />
            </span>
          ) : (
            <span className="sr-when-label">{command.when}</span>
          )}
        </div>
        {recorded && (
          <p className="sr-hint" hidden data-recording-hint="">
            {recordingHint(platform)}
          </p>
        )}
      </div>
      <div className="sr-side">
        {recorded && (
          <span className="sr-actions" hidden data-row-actions="">
            <Button variant="ghost" size="sm" className="sr-remove">
              {ROW_TEXT.remove}
            </Button>
          </span>
        )}
        <Button variant="ghost" className="sr-field" data-key-field="">
          {recorded && (
            <span className="sr-press" hidden data-press="">
              {ROW_TEXT.pressKeys}
            </span>
          )}
          <span className="sr-add" hidden={Boolean(keys)} data-add-keys="">
            {ROW_TEXT.addKeys}
          </span>
          {keys && <Kbd keys={keys} className="sr-keycaps" data-keycaps="" />}
        </Button>
        {recorded && (
          <Button variant="ghost" size="sm" className="sr-cancel" hidden data-record-cancel="">
            {ROW_TEXT.cancel}
            <kbd>{ROW_TEXT.escape}</kbd>
          </Button>
        )}
      </div>
    </li>
  );
}
