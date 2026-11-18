import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { settingsDialog } from "../../replicas/settings/settings-dialog";
import { shortcutSettings } from "../../replicas/settings/shortcut-settings";
import { pointer } from "../../replicas/shell/cursor";
import { sessionList } from "../../replicas/shell/nav-list";
import { positionHints } from "../../replicas/shell/position-hints";
import { heldKeys } from "../../replicas/ui/held-keys";
import {
  FIRST,
  FIRST_SECTION,
  JUMP_DIGIT,
  RECORDED,
  SEARCH,
  SEARCH_STEPS,
  START_NAV,
  STEP_KEYS,
  THIRD,
} from "./sample";

/** Seconds that the host takes to save the keyboard shortcuts. */
const SAVE = 0.3;

/** Seconds that the scene holds its last frame. */
const END_HOLD = 1.5;

/** The letters that the visitor types each second in the search. */
const TYPING = 10;

/**
 * The visitor holds Mod: after the delay of the app, the session rows show their numbers and the
 * workspace tiles their keys. Mod 3 opens the third session, and the hints hide when Mod goes up.
 * The default keys of Open Settings open Settings on Repositories, the section of the first open.
 * The visitor selects Keyboard shortcuts, searches fork, and records Mod Shift F for Fork from
 * message. The keys need no choice, so they go into the draft at once, and Save settings saves
 * them and closes Settings. The display at the bottom shows each key that the visitor holds. The
 * markup holds the frame after the recording.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const firstPage = must(root, '[data-page="first"]');
  const thirdPage = must(root, '[data-page="third"]');
  const sessions = sessionList(scene, root);
  const hints = positionHints(scene, root);
  const held = heldKeys(scene, root);
  const dialog = settingsDialog(scene, root);
  const shortcuts = shortcutSettings(scene, root, SEARCH_STEPS);
  const cursor = pointer(scene, root);
  const keys = STEP_KEYS[shortcuts.platform()];

  // Start: the first chat is open, and Settings is closed on the section of its first open.
  sessions.place(START_NAV.entries);
  firstPage.hidden = false;
  thirdPage.hidden = true;
  dialog.reset(FIRST_SECTION);
  shortcuts.reset(RECORDED.id);

  // The visitor holds Mod. The hints show at once when the delay of the app ends.
  const modDown = 0.6;
  const jump = modDown + 1.85;
  const modUp = jump + 0.5;
  held.hold([keys.mod], modDown);
  scene.mark("hold", modDown);
  scene.mark("hints", hints.hold(modDown, modUp));

  // Mod 3 opens the third session of the sidebar, and its page takes the place of the first page.
  held.hold([keys.mod, JUMP_DIGIT], jump);
  sessions.update(FIRST.entry.id, jump, { selected: false });
  sessions.update(THIRD.entry.id, jump, { selected: true });
  scene.at(jump, () => {
    firstPage.hidden = true;
    thirdPage.hidden = false;
  });
  scene.mark("jump", jump);
  held.hold([keys.mod], jump + 0.2);
  held.release(modUp);
  scene.mark("mod-up", modUp);

  // The default keys of Open Settings open the dialog with its open motion.
  const settingsDown = modUp + 0.7;
  const opened = settingsDown + 0.2;
  held.hold(keys.settings.slice(0, 1), settingsDown);
  scene.mark("control", settingsDown);
  held.hold(keys.settings, opened);
  dialog.open(opened);
  scene.mark("settings", opened);
  held.release(opened + 0.25);

  // The visitor selects Keyboard shortcuts in the menu. Its section takes the place of
  // Repositories at once.
  const section = cursor.click(() => dialog.menuItem("Keyboard shortcuts"), opened + 0.5, 0.8);
  dialog.hover("Keyboard shortcuts", section - 0.12);
  dialog.select("Keyboard shortcuts", section);

  // The visitor selects the search and types fork. The list keeps the rows that match each letter.
  const searched = cursor.click(shortcuts.search, section + 0.6, 0.6);
  shortcuts.focusSearch(searched);
  const typing = searched + 0.3;
  scene.mark("search", typing);
  const typed = shortcuts.type(SEARCH, typing, TYPING);

  // Add keys starts the recorder of Fork from message. Cancel takes the place of the field under
  // the pointer, so the pointer goes away while the visitor presses keys.
  const record = cursor.click(() => shortcuts.keyField(RECORDED.id), typed + 0.5, 0.7);
  shortcuts.hover(RECORDED.id, record - 0.15);
  shortcuts.record(RECORDED.id, record);
  shortcuts.leave(RECORDED.id, record);
  cursor.hide(record + 0.25);
  scene.mark("record", record);

  // The visitor holds Mod, then Shift, and the field shows them. F completes the keys, which go
  // into the draft with no problem.
  let down = record + 0.7;
  for (const [index, modifiers] of keys.recording.entries()) {
    held.hold(modifiers, down);
    shortcuts.hold(RECORDED.id, modifiers, down);
    scene.mark(`record-keys-${index + 1}`, down);
    down += 0.3;
  }
  held.hold(keys.recorded, down);
  shortcuts.recorded(RECORDED.id, down);
  scene.mark("recorded", down);
  held.release(down + 0.3);

  // Save settings saves the draft. Settings closes when the save ends.
  const saved = cursor.click(dialog.saveButton, down + 0.9, 0.8);
  shortcuts.disable(saved);
  dialog.saveAndClose(saved, saved + SAVE);
  scene.mark("saved", saved + SAVE);
  cursor.hide(saved + SAVE + 0.2);
  scene.endAt(saved + SAVE + END_HOLD);
};
