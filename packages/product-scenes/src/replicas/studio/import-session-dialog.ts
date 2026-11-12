// The Import session dialog of ImportSessionDialog.tsx: it opens over a window, the visitor chooses
// a runtime, the list loads, a search filters it, and Import shows its spinner until the dialog
// closes.
import { all, must } from "../../motion/dom";
import { designPixel, fadeHide, settleIn } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import { typeText } from "../../motion/text";
import { EASE } from "../../motion/tokens";
import type { RuntimeKind } from "../../sample/models";
import { IMPORT_TEXT, sessionCount } from "./import-session-text";
import { modal } from "./modal";

/** The durations of popover.css in seconds: --popover-open-dur and --popover-close-dur. */
const POPOVER = { open: 0.25, close: 0.15 } as const;

/** The duration of the dialog resize of dialog.css in seconds: --resize-dur. */
const RESIZE = 0.3;

/** The dialog in `root` and the steps that fill it. */
export function importSessionDialog(scene: Scene, root: HTMLElement) {
  const overlay = must(root, "[data-import-dialog]");
  const { box, open, close } = modal(scene, root, overlay);
  const trigger = must(box, "[data-runtime-trigger]");
  const placeholder = must(trigger, "[data-runtime-placeholder]");
  const value = must(trigger, "[data-runtime-value]");
  const options = must(overlay, "[data-runtime-options]");
  const results = must(box, "[data-results]");
  const search = must(results, "[data-search]");
  const typed = must(search, "[data-typed]");
  const loading = must(results, "[data-loading]");
  const loadingTitle = must(loading, "[data-loading-title]");
  const list = must(results, "[data-session-list]");
  const count = must(results, "[data-count]");
  const cancel = must(box, "[data-cancel]");
  const closeButton = must(box, "[data-close]");
  const rows = (): HTMLElement[] => all(list, "[data-session-row]");
  const option = (kind: RuntimeKind): HTMLElement =>
    must(options, `[data-runtime-option="${kind}"]`);
  const importButton = (id: string): HTMLElement => must(list, `[data-import="${id}"]`);
  /** The gap between the runtime field and its option list: 6 design pixels. */
  const gap = 6 * designPixel(root);

  /** Shows the loading state with `title`, in place of the list and the count. */
  const showLoading = (title: string): void => {
    loadingTitle.textContent = title;
    loading.hidden = false;
    list.hidden = true;
    count.hidden = true;
  };

  /** Build time: the closed dialog as it opens, with no runtime and an empty search. */
  const reset = (): void => {
    overlay.hidden = true;
    box.removeAttribute("data-chosen");
    placeholder.hidden = false;
    value.hidden = true;
    options.hidden = true;
    results.hidden = true;
    search.removeAttribute("data-filled");
    typed.textContent = "";
    showLoading(IMPORT_TEXT.finding);
    for (const button of all(list, "[data-import]")) {
      button.removeAttribute("data-importing");
      button.removeAttribute("data-disabled");
    }
    for (const control of [trigger, search, cancel, closeButton])
      control.removeAttribute("data-disabled");
  };

  /** Highlights the option `kind`, as cmdk does for the item under the pointer. */
  const highlight = (kind: RuntimeKind): void => {
    for (const item of all(options, "[data-runtime-option]"))
      item.toggleAttribute("data-hover", item === option(kind));
  };

  /** The top of the option list: 6px under the runtime field. */
  const optionsTop = (): number => offsetIn(trigger, overlay).y + trigger.offsetHeight + gap;

  /** Puts the option list 6px under the runtime field, with the width of the field. */
  const placeOptions = (): void => {
    gsap.set(options, {
      left: offsetIn(trigger, overlay).x,
      top: optionsTop(),
      width: trigger.offsetWidth,
    });
  };

  /**
   * Opens the option list 6px under the runtime field at `at`, with the width of the field, as
   * popover.css does. cmdk highlights the first option.
   */
  const openOptions = (at: number, first: RuntimeKind): void =>
    scene.at(at, () => {
      options.hidden = false;
      highlight(first);
      placeOptions();
      scene.run(
        gsap.fromTo(
          options,
          { autoAlpha: 0, scale: 0.97, transformOrigin: "top left" },
          { autoAlpha: 1, scale: 1, duration: POPOVER.open, ease: EASE.arrive },
        ),
      );
    });

  /**
   * Chooses the runtime `kind` at `at`: the list closes, the field shows the runtime, and the
   * results show the loading state. The dialog takes its fixed height, h-[min(48rem,...)], with the
   * resize of dialog-resize.ts, so the list that loads later does not change its size.
   */
  const choose = (kind: RuntimeKind, at: number): void =>
    scene.at(at, () => {
      scene.run(gsap.to(options, { scale: 0.99, duration: POPOVER.close, ease: EASE.arrive }));
      scene.run(fadeHide(options, POPOVER.close, EASE.arrive));
      placeholder.hidden = true;
      value.hidden = false;
      const from = { height: box.offsetHeight, top: optionsTop() };
      box.toggleAttribute("data-chosen", true);
      results.hidden = false;
      const to = { height: box.offsetHeight, top: optionsTop() };
      const resize = { duration: RESIZE, ease: EASE.arrive };
      scene.run(
        gsap.fromTo(
          box,
          { height: from.height },
          { height: to.height, ...resize, clearProps: "height" },
        ),
      );
      // The closing list stays under the field while the dialog grows. The field moves in step
      // with the height of the dialog, so the list takes the same tween to its end place.
      scene.run(gsap.fromTo(options, { top: from.top }, { top: to.top, ...resize }));
    });

  /** Shows the rows `ids` and their count at `at`, in place of the loading state. */
  const showRows = (ids: readonly string[], at: number): void =>
    scene.at(at, () => {
      const shown = rows().filter((row) => ids.includes(row.dataset.sessionRow ?? ""));
      for (const row of rows()) row.hidden = !shown.includes(row);
      loading.hidden = true;
      list.hidden = false;
      count.hidden = false;
      count.textContent = sessionCount(shown.length);
      scene.run(settleIn(shown));
    });

  /** Types `text` in the search from `at`. The search shows its loading state. Returns the end. */
  const typeSearch = (text: string, at: number): number => {
    scene.at(at, () => {
      search.toggleAttribute("data-focused", true);
      typed.toggleAttribute("data-typing", true);
    });
    // The search waits for its debounce from the first letter, so the loading state shows then.
    const end = typeText(scene, typed, text, at, {
      charsPerSecond: 12,
      onText: (shown) => {
        search.toggleAttribute("data-filled", shown !== "");
        if (shown !== "" && loading.hidden) showLoading(IMPORT_TEXT.searching);
      },
    });
    return end;
  };

  /**
   * Import of the row `id` shows its spinner at `at`. The click moves the focus from the search,
   * and the dialog turns off its other controls while the import runs.
   */
  const startImport = (id: string, at: number): void =>
    scene.at(at, () => {
      search.removeAttribute("data-focused");
      typed.removeAttribute("data-typing");
      for (const button of all(list, "[data-import]"))
        button.toggleAttribute("data-disabled", button !== importButton(id));
      importButton(id).toggleAttribute("data-importing", true);
      for (const control of [trigger, search, cancel, closeButton])
        control.toggleAttribute("data-disabled", true);
    });

  return {
    trigger: (): HTMLElement => trigger,
    highlight,
    option: (kind: RuntimeKind) => (): HTMLElement => option(kind),
    search: (): HTMLElement => search,
    importButton: (id: string) => (): HTMLElement => importButton(id),
    reset,
    open,
    close,
    openOptions,
    choose,
    showRows,
    typeSearch,
    startImport,
  };
}
