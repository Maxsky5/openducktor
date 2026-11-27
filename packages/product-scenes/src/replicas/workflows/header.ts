// The controller of EditorHeader.tsx: the status of the workflow, the save status, Undo, and the
// Publish button, which shows while the workflow has a draft.
import { must } from "../../motion/dom";
import { fadeIn } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import { HEADER_TEXT, versionLabel } from "./text";

/**
 * Seconds from an edit to the end of its save: AUTOSAVE_DELAY_MS of draft-autosave.ts, and the
 * draft save of a local host.
 */
const SAVE = 0.45;

export function editorHeader(scene: Scene, root: HTMLElement) {
  const version = must(root, "[data-version]");
  const versionText = must(version, "[data-version-label]");
  const save = must(root, "[data-save]");
  const saveText = must(save, "[data-save-text]");
  const undo = must(root, "[data-undo]");
  const publish = must(root, "[data-publish]");
  /** The version that the status shows. */
  let shown = 0;

  /** Shows the status of `number`: published, or with unpublished changes. */
  const setVersion = (number: number, draft: boolean): void => {
    shown = number;
    versionText.textContent = versionLabel(number, draft);
    version.dataset.tone = draft ? "draft" : "published";
  };

  const setSaving = (saving: boolean): void => {
    save.toggleAttribute("data-saving", saving);
    saveText.textContent = saving ? HEADER_TEXT.saving : HEADER_TEXT.saved;
  };

  const setUndo = (enabled: boolean): void => {
    undo.toggleAttribute("data-disabled", !enabled);
  };

  /**
   * An edit at `at`: the header shows Saving, then Saved. The first save of a published version
   * creates the draft, so the status of the version shows the unpublished changes and Publish
   * comes in. Returns the time of the save.
   */
  const edit = (at: number): number => {
    scene.at(at, () => {
      setSaving(true);
      setUndo(true);
    });
    const saved = at + SAVE;
    scene.at(saved, () => {
      setSaving(false);
      setVersion(shown, true);
      if (!publish.hidden) return;
      // The button renders at once, as in the app, and fades in.
      publish.hidden = false;
      scene.run(fadeIn(publish, 0.15));
    });
    return saved;
  };

  /** The editor opens the new version: no draft, no Publish, and nothing to undo. */
  const published = (at: number, number: number): void =>
    scene.at(at, () => {
      setVersion(number, false);
      setUndo(false);
      publish.hidden = true;
    });

  /** The first frame: version `number` is published, with nothing to undo and no Publish. */
  const reset = (number: number): void => {
    setVersion(number, false);
    setSaving(false);
    setUndo(false);
    publish.hidden = true;
  };

  return { publish, reset, edit, published };
}
