// The Settings dialog of SettingsDialog.tsx over a window. It opens with the motion of dialog.css,
// a section of the menu shows its pane at once, and Save settings saves. The shared Settings of
// SettingsModalProvider in settings-modal.tsx unmounts the dialog when it closes, so the dialog
// goes at once, with no close motion.
import { all, data, must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import { modal } from "../studio/modal";
import type { SettingsSection } from "./SettingsDialog";

/** The parts of the Settings dialog, and the steps that change it. */
type SettingsDialogSteps = {
  open: (at: number) => void;
  reset: (section: SettingsSection) => void;
  hover: (section: SettingsSection, at: number) => void;
  select: (section: SettingsSection, at: number) => void;
  saveAndClose: (at: number, end: number) => void;
  menuItem: (section: SettingsSection) => HTMLElement;
  saveButton: () => HTMLElement;
};

/** The Settings dialog in the window `root`, and the steps that change it. */
export function settingsDialog(scene: Scene, root: HTMLElement): SettingsDialogSteps {
  const overlay = must(root, "[data-settings-dialog]");
  const { box, open, unmount } = modal(scene, root, overlay);
  const save = must(box, "[data-settings-save]");
  const cancel = must(box, "[data-settings-cancel]");
  const menuItem = (section: SettingsSection): HTMLElement =>
    must(box, `[data-settings-menu="${section}"]`);

  /** Selects `section` in the menu, and shows its pane in the place of the other panes. */
  const showNow = (section: SettingsSection): void => {
    for (const item of all(box, "[data-settings-menu]")) {
      item.dataset.variant = data(item, "settingsMenu") === section ? "accent" : "ghost";
      item.removeAttribute("data-hover");
    }
    for (const pane of all(box, "[data-settings-section]"))
      pane.hidden = data(pane, "settingsSection") !== section;
  };

  /** Build time: the dialog is closed, and it opens on `section`. */
  const reset = (section: SettingsSection): void => {
    overlay.hidden = true;
    showNow(section);
  };

  /** The pointer rests on the menu item of `section` from `at`: it takes the hover surface. */
  const hover = (section: SettingsSection, at: number): void =>
    scene.at(at, () => menuItem(section).toggleAttribute("data-hover", true));

  /** Selects `section` at `at`. Its pane shows at once, as the app renders the new section. */
  const select = (section: SettingsSection, at: number): void =>
    scene.at(at, () => showNow(section));

  /**
   * Save settings saves from `at` to `end`: the button shows its spinner and Saving…, and the two
   * buttons are disabled. When the save ends, the dialog closes at once.
   */
  const saveAndClose = (at: number, end: number): void => {
    scene.at(at, () => {
      save.toggleAttribute("data-busy", true);
      for (const button of [save, cancel]) button.toggleAttribute("data-disabled", true);
    });
    unmount(end);
  };

  return {
    open,
    reset,
    hover,
    select,
    saveAndClose,
    menuItem,
    saveButton: (): HTMLElement => save,
  };
}
