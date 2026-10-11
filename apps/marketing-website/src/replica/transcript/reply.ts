// The answer step of ReplyHere.astro: the visitor picks an option, confirms, and a note replaces
// the card.
import { must } from "../../motion/dom";
import { fadeIn } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import type { Pointer } from "../shell/pointer";
import { questionCard } from "./question";

/** Answers the question of the Reply here block `block` with `answer` from `at`. Returns the time of the note. */
export function answerHere(
  scene: Scene,
  block: HTMLElement,
  cursor: Pointer,
  answer: string,
  at: number,
): number {
  const question = must(block, "[data-reply-question]");
  const sent = must(block, "[data-reply-sent]");
  const form = questionCard(scene, must(question, "[data-request]"), cursor);
  const chosen = form.choose(answer, 0, at, 0.9);
  const confirmed = form.confirm(chosen + 0.6, 0.7);
  const noted = confirmed + 0.5;
  scene.at(noted, () => {
    question.hidden = true;
    sent.hidden = false;
    scene.run(fadeIn(sent, 0.2));
  });
  return noted;
}
