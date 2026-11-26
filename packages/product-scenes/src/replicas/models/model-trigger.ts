// The model picker trigger of ModelTrigger.tsx in a scene. The trigger of the product shows a new
// selection at once, so `set` changes the markup with no motion.
import { must } from "../../motion/dom";
import { type ModelChoice, modelName } from "../../sample/models";

/** The steps of one model picker trigger. */
type ModelTriggerSteps = {
  /** The trigger sums up `value`. */
  set: (value: ModelChoice) => void;
};

/** The trigger `trigger` of ModelTrigger.tsx. */
export function modelTrigger(trigger: HTMLElement): ModelTriggerSteps {
  const logos = must(trigger, "[data-runtime-logos]");
  const profile = must(trigger, "[data-profile]");
  const slash = must(trigger, "[data-profile-slash]");
  const model = must(trigger, "[data-model-name]");
  const effort = must(trigger, "[data-effort]");
  const speed = must(trigger, "[data-speed]");

  const set = (value: ModelChoice): void => {
    logos.dataset.runtime = value.runtime;
    profile.textContent = value.profile ?? "";
    profile.hidden = !value.profile;
    slash.hidden = !value.profile;
    model.textContent = modelName(value);
    effort.textContent = value.effort ?? "";
    effort.hidden = !value.effort;
    speed.hidden = value.speed !== "fast";
  };

  return { set };
}
