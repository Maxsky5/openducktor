import { all, must } from "../../motion/dom";
import { brandColor, designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { mountLoop } from "../../motion/loop";
import { EASE } from "../../motion/tokens";
import { pointer } from "../../replica/shell/pointer";
import { type ModelRef, modelKey, modelName, SPEC_AFTER, SPEC_BEFORE } from "../../sample/models";

/**
 * The per-role agent defaults. The Spec role uses Codex at the start. You open its model picker,
 * look at the OpenCode and Codex models, and choose Lyra 3 in the Claude runtime. The markup holds
 * the last frame with the picker open, so visitors without motion see the three runtimes and a
 * model list.
 */
export function mountRuntimes(): void {
  mountLoop(must(document, '[data-scene="runtimes"]'), (scene) => {
    const root = must(scene.stage, "[data-pane]");
    const card = must(root, '[data-role="spec"]');
    const trigger = must(card, "[data-model-trigger]");
    const logos = must(trigger, "[data-runtime-logos]");
    const name = must(trigger, "[data-model-name]");
    const picker = must(card, "[data-picker]");
    const rail = (kind: string): HTMLElement => must(picker, `[data-rail="${kind}"]`);
    const list = (kind: string): HTMLElement => must(picker, `[data-list="${kind}"]`);
    const row = (key: string): HTMLElement =>
      must(picker, `[data-model="${key}"] [data-model-pick]`);
    const cursor = pointer(scene, root);
    const u = (): number => designPixel(root);

    const select = (key: string): void => {
      for (const item of all(picker, "[data-model]"))
        item.toggleAttribute("data-selected", item.dataset.model === key);
    };
    const setModel = (ref: ModelRef): void => {
      logos.dataset.runtime = ref.runtime;
      name.textContent = modelName(ref);
    };
    /** The rail button shows another runtime. The rows of the list come in one after another. */
    const view = (kind: string, at: number): void =>
      scene.at(at, () => {
        picker.dataset.view = kind;
        scene.run(
          gsap.fromTo(
            list(kind).children,
            { autoAlpha: 0, x: -6 * u() },
            {
              autoAlpha: 1,
              x: 0,
              duration: 0.3,
              stagger: 0.04,
              ease: EASE.enter,
              clearProps: "opacity,visibility,transform",
            },
          ),
        );
      });

    // Start: the Spec role uses Codex, and the picker is closed.
    setModel(SPEC_BEFORE);
    select(modelKey(SPEC_BEFORE));
    picker.dataset.view = "opencode";
    picker.hidden = true;

    // 1. You open the model picker of the Spec role. No model is a favorite, so the picker shows
    //    the first runtime, OpenCode.
    const opened = cursor.click(() => trigger, 0.6, 1);
    scene.at(opened + 0.05, () => {
      picker.hidden = false;
      scene.run(
        gsap.fromTo(
          picker,
          { autoAlpha: 0, scale: 0.96, y: -4 * u() },
          {
            autoAlpha: 1,
            scale: 1,
            y: 0,
            duration: 0.25,
            ease: EASE.enter,
            clearProps: "opacity,visibility,transform",
          },
        ),
      );
    });

    // 2. You look at the Codex models, with the current model, then at the Claude models.
    const codex = cursor.click(() => rail("codex"), opened + 1.1, 0.7);
    view("codex", codex + 0.05);
    const claude = cursor.click(() => rail("claude"), codex + 1.3, 0.5);
    view("claude", claude + 0.05);

    // 3. You choose Lyra 3. The picker closes, and the Spec role uses the Claude runtime.
    const picked = cursor.click(() => row(modelKey(SPEC_AFTER)), claude + 1.2, 0.7);
    scene.at(picked + 0.05, () => select(modelKey(SPEC_AFTER)));
    scene.at(picked + 0.25, () => {
      scene.run(
        gsap.to(picker, {
          autoAlpha: 0,
          scale: 0.96,
          duration: 0.2,
          ease: EASE.exit,
          onComplete: () => {
            picker.hidden = true;
            gsap.set(picker, { clearProps: "opacity,visibility,transform" });
          },
        }),
      );
      setModel(SPEC_AFTER);
      scene.run(
        gsap.fromTo(
          trigger,
          { boxShadow: `0 0 0 ${3 * u()}px ${brandColor(trigger, 0.28)}` },
          {
            boxShadow: `0 0 0 0px ${brandColor(trigger, 0)}`,
            duration: 1.1,
            ease: EASE.enter,
            clearProps: "boxShadow",
          },
        ),
      );
    });
    // 4. The four roles now use three runtimes. Each role logo pops in turn.
    scene.at(picked + 0.9, () => {
      scene.run(
        gsap.fromTo(
          all(root, "[data-runtime-logos]"),
          { scale: 1 },
          { scale: 1.3, duration: 0.18, yoyo: true, repeat: 1, stagger: 0.12, ease: EASE.gentle },
        ),
      );
    });
    cursor.hide(picked + 0.8);
    scene.endAt(picked + 3.8);
  });
}
