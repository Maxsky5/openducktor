// The motion of the model picker of ModelPicker.tsx. It opens and closes with the motion of
// popover.css: it grows from 97 % and fades in over 250 ms, and it shrinks to 99 % and fades out
// over 150 ms. It opens with the focus in the search field. A rail button shows the models of its
// runtime at once, and a click on a model selects it and keeps the picker open: the options bar
// shows the options of the new model.
import { all, data, must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import type { RuntimeKind } from "../../sample/models";
import { popoverIn, popoverOut } from "../ui/popover";
import { effortSlider } from "./effort-slider";

/** The steps of one model picker. */
type ModelPickerSteps = {
  /** Build time: the picker is closed, on `view`, with the model `key` and its options. */
  reset: (view: RuntimeKind, key: string) => void;
  open: (at: number) => void;
  close: (at: number) => void;
  /** The rail button of `kind` shows its models at once. */
  show: (kind: RuntimeKind, at: number) => void;
  /** Selects the model `key`, and the options bar shows its options. */
  select: (key: string, at: number) => void;
  rail: (kind: RuntimeKind) => HTMLElement;
  row: (key: string) => HTMLElement;
  /** The effort slider of the options of the model `key`. */
  effort: (key: string) => ReturnType<typeof effortSlider>;
};

/** The model picker `picker` of a scene. */
export function modelPicker(scene: Scene, picker: HTMLElement): ModelPickerSteps {
  const search = must(picker, "[data-search]");
  const rail = (kind: RuntimeKind): HTMLElement => must(picker, `[data-rail="${kind}"]`);
  const row = (key: string): HTMLElement => must(picker, `[data-model="${key}"] [data-model-pick]`);
  const options = (key: string): HTMLElement => must(picker, `[data-options="${key}"]`);

  const selectNow = (key: string): void => {
    for (const item of all(picker, "[data-model]"))
      item.toggleAttribute("data-selected", data(item, "model") === key);
    for (const pane of all(picker, "[data-options]")) pane.hidden = data(pane, "options") !== key;
  };

  const reset = (view: RuntimeKind, key: string): void => {
    picker.hidden = true;
    picker.dataset.view = view;
    selectNow(key);
    search.toggleAttribute("data-focused", true);
  };

  const open = (at: number): void => scene.at(at, () => scene.run(popoverIn(picker)));

  const close = (at: number): void => scene.at(at, () => scene.run(popoverOut(picker)));

  // The product shows the new list at once, and the focus goes back to the search field.
  const show = (kind: RuntimeKind, at: number): void =>
    scene.at(at, () => {
      picker.dataset.view = kind;
      search.toggleAttribute("data-focused", true);
    });

  // The click moves the focus from the search field to the row. The row takes its tint with the
  // transition-colors of the product.
  const select = (key: string, at: number): void =>
    scene.at(at, () => {
      search.removeAttribute("data-focused");
      selectNow(key);
      const row = must(picker, `[data-model="${key}"]`);
      scene.run(
        gsap.fromTo(
          row,
          { "--tint": 0 },
          {
            "--tint": 1,
            duration: 0.15,
            ease: EASE.chat,
            onComplete: () => row.style.removeProperty("--tint"),
          },
        ),
      );
      scene.run(
        gsap.fromTo(
          options(key),
          { autoAlpha: 0.4 },
          { autoAlpha: 1, duration: 0.2, ease: EASE.chat, clearProps: "opacity,visibility" },
        ),
      );
    });

  const effort = (key: string): ReturnType<typeof effortSlider> =>
    effortSlider(scene, must(options(key), "[data-effort-track]"));

  return { reset, open, close, show, select, rail, row, effort };
}
