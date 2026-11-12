import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { diffComments } from "../../replicas/mobile/diff-comments";
import { composerDraft } from "../../replicas/mobile/draft";
import { finger } from "../../replicas/mobile/finger";
import { menus } from "../../replicas/mobile/menus";
import { rail } from "../../replicas/mobile/rail";
import { screens } from "../../replicas/mobile/screens";
import { stepList } from "../../replicas/mobile/steps";
import { composerActivity } from "../../replicas/shell/composer";
import { follow, transcript } from "../../replicas/transcript/rows";
import { COMMENT_TEXT, HOOK, RAIL, RANGE, TYPED } from "./sample";

/** The rows that the sent message brings. */
const LATER_ROWS = ["sent", "keymap", "answer"];

/**
 * The visitor comments on two diff lines for the Builder. The session menu opens Changes, the tab
 * shows Branch changes, and a tap shows the diff of the hook under its row. Its menu opens the
 * full diff. A tap selects the first line, a tap on the next line extends the range, and Comment
 * opens the field. The saved comment shows Pending under the range. Back in Changes, the pending
 * card offers Send, which opens the session: the composer counts the comment. The visitor sends a
 * message, the comment goes with it, and the Builder works again. The markup holds the frame where
 * the composer counts the pending comment.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const steps = stepList(scene, root);
  const phone = screens(scene, root);
  const tap = finger(scene, root).tap;
  const menu = menus(scene, root);
  const session = phone.screen("session");
  const changes = phone.screen("changes");
  const diff = phone.screen("diff");
  const reply = phone.screen("reply");
  const flow = diffComments(scene, diff);
  const tabs = must(changes, "[data-scope]");
  const hook = must(changes, `[data-file="${HOOK.id}"]`);
  const inline = must(changes, "[data-file-diff]");
  const inlineComment = must(inline, "[data-diff-comment]");
  const pending = must(changes, "[data-pending-comments]");
  const count = must(hook, "[data-comment-count]");
  const rows = transcript(scene, reply);
  const row = (id: string): HTMLElement => must(reply, `[data-row="${id}"]`);
  const draft = composerDraft(scene, reply);
  const composer = must(reply, "[data-composer]");
  const setActivity = composerActivity(reply);
  const setRail = rail(reply);
  const menuButton = (): HTMLElement => must(session, "[data-session-menu]");
  const fileMenu = (): HTMLElement => must(hook, "[data-file-menu]");
  follow(scene, must(reply, "[data-track]"));

  // Start: the Builder ended its turn, and Changes shows Uncommitted changes with no diff open.
  phone.only("session");
  tabs.dataset.scope = "uncommitted";
  hook.dataset.expanded = "false";
  inline.hidden = true;
  inlineComment.hidden = true;
  pending.hidden = true;
  count.hidden = true;
  for (const id of LATER_ROWS) row(id).hidden = true;

  // The session menu opens Changes.
  const opened = tap(menuButton, 1.3);
  menu.open("session", menuButton, opened);
  const chosen = tap(() => menu.item("session", "changes"), opened + 1);
  menu.close("session", chosen);
  phone.push("session", "changes", chosen + 0.1);

  // Branch changes lists the files. A tap shows the diff of the hook, and its menu opens the full
  // diff. Each step lights up when the last tap of the step before it ends, at least 1.2 s
  // before its own first tap.
  steps.show(1, chosen);
  const scoped = tap(() => must(changes, '[data-scope-tab="target"]'), chosen + 1.3);
  scene.at(scoped, () => {
    tabs.dataset.scope = "target";
  });
  const expanded = tap(() => hook, scoped + 0.9);
  scene.at(expanded, () => {
    hook.dataset.expanded = "true";
    inline.hidden = false;
  });
  const more = tap(fileMenu, expanded + 1.1);
  menu.open("file", fileMenu, more);
  const full = tap(() => menu.item("file", "open-diff"), more + 1);
  menu.close("file", full);
  phone.push("changes", "diff", full + 0.1);

  // A tap selects the first line, and a tap on the last line extends the range.
  steps.show(2, full);
  const first = tap(() => flow.line(RANGE.first), full + 1.4);
  flow.select(RANGE.first, first);
  const last = tap(() => flow.line(RANGE.last), first + 0.9);
  flow.extend(RANGE.last, last);
  const started = tap(() => must(diff, "[data-comment-start]"), last + 0.9);
  flow.start(started);

  // The visitor writes the comment and saves it. It shows Pending under the range.
  steps.show(3, started + 0.2);
  const typed = flow.type(COMMENT_TEXT, started + 0.6);
  const saved = tap(() => must(diff, "[data-comment-save]"), typed + 0.5);
  flow.save(saved);

  // Back in Changes, the pending card offers Send, which opens the session.
  steps.show(4, saved + 0.6);
  const back = tap(() => must(diff, "[data-back]"), saved + 1.8);
  scene.at(back, () => {
    pending.hidden = false;
    count.hidden = false;
    inlineComment.hidden = false;
  });
  const returned = phone.pop("diff", "changes", back);
  const sent = tap(() => must(changes, "[data-send-feedback]"), returned + 1);
  const session2 = phone.push("changes", "reply", sent);

  // The composer counts the comment. The visitor sends a message, and the comment goes with it.
  steps.show(5, sent);
  const focused = tap(() => composer, session2 + 0.9);
  const written = draft.type(TYPED, focused + 0.2);
  const delivered = tap(() => must(reply, "[data-send]"), written + 0.5);
  draft.send(delivered);
  scene.at(delivered, () => {
    composer.removeAttribute("data-comments");
    setActivity("working");
    setRail("build", RAIL.working.build);
  });
  rows.show(row("sent"), delivered + 0.1);
  const read = rows.tool(row("keymap"), delivered + 0.6, 0.3);
  const said = rows.say(row("answer"), read + 0.3);
  scene.endAt(said + 2.4);
};
