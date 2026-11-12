import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { composerActivity, composerDraft } from "../../replicas/shell/composer";
import { pointer } from "../../replicas/shell/cursor";
import { ciComments } from "../../replicas/studio/ci-comments";
import { tooltip } from "../../replicas/ui/tip";
import { follow, transcript } from "../../replicas/transcript/rows";
import { APPROVAL, ASK, NOW, UPDATED } from "./sample";

/** The chat rows of the turn that applies the suggestion. */
const CHAT_ROWS = ["ask", "edit", "commit", "push", "applied"];

/** Seconds that a read of the pull request takes, while the refresh icon spins. */
const READ = 0.6;

/**
 * The visitor reads the comments of a pull request in the CI Checks tab. Humans hides the bot
 * comment, and All shows it again. Hide resolved removes the resolved thread, and the visitor
 * scrolls to the suggested change of the open thread. The app sends no comment to the agent, so
 * the visitor types the request in the chat. The Builder edits the file, commits, and pushes. The
 * visitor scrolls up and refreshes the tab, and the new review shows at the top. The thread stays
 * unresolved: a push does not resolve it. A phone stage shows only the panel, so the pointer stays
 * on the panel. The markup holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const comments = ciComments(scene, root);
  const rows = transcript(scene, root);
  const row = (id: string): HTMLElement => must(root, `[data-row="${id}"]`);
  const setActivity = composerActivity(root);
  const cursor = pointer(scene, root);
  const tip = tooltip(root);
  const refresh = must(root, "[data-checks-refresh]");
  const updated = must(root, "[data-checks-updated]");
  const composer = composerDraft(scene, root);
  const narrow = getComputedStyle(must(root, ".tpage-chat")).display === "none";
  follow(scene, must(root, "[data-track]"));

  // Start: the Builder published the pull request, and the first read shows its comments with
  // every item, before the new review.
  comments.reset([APPROVAL], NOW.first);
  updated.textContent = UPDATED.first;
  for (const id of CHAT_ROWS) row(id).hidden = true;
  setActivity("idle");

  // Humans leaves out the comment of the bot, and All shows it again.
  const humans = cursor.click(() => comments.filterButton("humans"), 0.5);
  comments.filter("humans", humans);
  const every = cursor.click(() => comments.filterButton("all"), humans + 0.9, 0.6);
  comments.filter("all", every);

  // Filter comments opens its popover, and Hide resolved removes the resolved thread.
  const pointed = cursor.point(() => comments.menuButton, every + 0.6, 0.6);
  scene.at(pointed, () => {
    comments.menuButton.toggleAttribute("data-hover", true);
    tip.show(comments.menuButton, "Filter comments");
  });
  const opened = cursor.click(() => comments.menuButton, pointed + 0.5, 0.1);
  scene.at(opened, () => tip.hide());
  comments.openMenu(true, opened);
  const hidden = cursor.click(() => comments.toggle, opened + 0.4, 0.6);
  comments.hideResolved(true, hidden);
  const closed = cursor.click(() => comments.menuButton, hidden + 0.7, 0.5);
  comments.openMenu(false, closed);
  scene.at(closed + 0.2, () => comments.menuButton.removeAttribute("data-hover"));

  // The visitor scrolls to the suggested change of the open thread.
  const read = comments.scrollTo(
    () => must(comments.card("thread"), "[data-suggestion]"),
    closed + 0.4,
    1.1,
  );

  // The visitor asks the Builder to apply the suggestion. The Builder edits the file, commits,
  // and pushes. Then it ends its turn. Returns the end of the turn.
  const ask = (at: number): number => {
    const clicked = cursor.click(() => composer.editor, at, 0.8);
    composer.focus(clicked);
    const written = composer.type(ASK, clicked + 0.2, 30);
    const sent = cursor.click(() => composer.button, written + 0.2, 0.6);
    composer.send(sent);
    scene.at(sent, () => setActivity("working"));
    const asked = rows.show(row("ask"), sent + 0.1);
    cursor.hide(sent + 0.3);
    const edited = rows.show(row("edit"), asked + 0.6);
    const committed = rows.tool(row("commit"), edited + 0.4, 0.4);
    const pushed = rows.tool(row("push"), committed + 0.2, 0.8);
    const replied = rows.say(row("applied"), pushed + 0.3);
    scene.at(replied, () => setActivity("idle"));
    return replied;
  };

  // A phone stage does not show the chat, so the turn ends there after a short read of the
  // suggestion.
  const turn = (at: number): number => {
    cursor.hide(at - 0.3);
    scene.at(at + 1.6, () => {
      for (const id of CHAT_ROWS) row(id).hidden = false;
    });
    return at + 1.6;
  };
  const replied = narrow ? turn(read + 0.5) : ask(read + 0.5);

  // The visitor scrolls up and refreshes the tab. The new review of maya shows at the top.
  const top = comments.scrollTo(() => null, replied + 0.3, 0.7);
  const refreshed = cursor.click(() => refresh, top - 0.3, 0.8);
  scene.at(refreshed, () => refresh.toggleAttribute("data-spinning", true));
  scene.at(refreshed + READ, () => {
    refresh.removeAttribute("data-spinning");
    updated.textContent = UPDATED.last;
  });
  comments.read(NOW.last, APPROVAL, refreshed + READ);
  cursor.hide(refreshed + READ + 0.5);
  scene.endAt(refreshed + READ + 3.2);
};
