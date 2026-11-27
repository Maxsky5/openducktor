import { must } from "../../motion/dom";
import { designPixel, fadeIn } from "../../motion/effects";
import { offsetIn, type Point } from "../../motion/offset";
import type { SceneBuilder } from "../../motion/scene";
import { composerActivity, composerDraft, contextMeter } from "../../replicas/shell/composer";
import { createMenu } from "../../replicas/shell/create-menu";
import { pointer } from "../../replicas/shell/cursor";
import { sessionList } from "../../replicas/shell/nav-list";
import { DRAFT_TEXT } from "../../replicas/studio/SessionDraft";
import { sessionDraft } from "../../replicas/studio/session-draft";
import { slideOpen } from "../../replicas/studio/side-panels";
import { startupCard } from "../../replicas/studio/startup-card";
import { transcript } from "../../replicas/transcript/rows";
import { contextUse } from "../../sample/sessions";
import {
  CONTEXT_USED,
  ENTRY,
  MESSAGE,
  NAMED,
  NAV,
  type NewSessionTemplate,
  SENT_TIME,
  SESSION,
} from "./sample";

/**
 * A workspace session starts in a new worktree from its first message. The visitor opens the menu
 * of the arrow beside New task and selects New session. On the draft page, the visitor selects New
 * worktree, opens Auto branch, types the first message, and sends it. The composer docks at the
 * bottom, and the startup card shows each step. The visitor opens the naming step to see the new
 * branch. The saved session takes its title from the naming model, the card folds when the
 * session is ready, and the agent starts to work. The markup holds the draft with the typed
 * message.
 */
export const build: SceneBuilder<NewSessionTemplate> = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const board = must(root, '[data-page="board"]');
  const page = must(root, '[data-page="session"]');
  const kanban = must(root, "[data-kanban]");
  const trigger = must(root, "[data-create-trigger]");
  const box = must(page, "[data-composer]");
  const row = (name: string): HTMLElement => must(page, `[data-row="${name}"]`);
  const message = row("message");
  const sentTime = must(message, "[data-time]");
  const cursor = pointer(scene, root);
  const sessions = sessionList(scene, root);
  const entryTitle = must(sessions.row(ENTRY.id), "[data-nav-title]");
  const composer = composerDraft(scene, page);
  const setActivity = composerActivity(page);
  const rows = transcript(scene, root);
  const card = startupCard(scene, page);
  const draft = sessionDraft(scene, root, page, cursor, {
    menu: scene.template("location"),
    branch: scene.template("branch"),
  });

  // Start: the board with the open sidebar, and no draft in the sidebar. The draft page waits with
  // Current checkout, an empty composer, and the startup card and the message of its transcript.
  sessions.place(
    NAV.entries.map((entry) => (entry.id === ENTRY.id ? { ...ENTRY, later: true } : entry)),
  );
  board.hidden = false;
  page.hidden = true;
  root.dataset.pane = "sidebar";
  kanban.setAttribute("aria-current", "true");
  draft.reset("local_repo_root");
  card.reset();
  composer.typed.textContent = "";
  composer.editor.removeAttribute("data-draft");
  composer.button.removeAttribute("data-ready");
  sentTime.textContent = DRAFT_TEXT.sending;
  setActivity("idle");
  const rightPanel = must(page, "[data-right-panel]");
  const rightHandle = must(page, "[data-right-handle]");
  const rightToggle = must(page, '[data-header="session"] [data-toggle="right"]');
  rightPanel.hidden = true;
  rightHandle.hidden = true;

  // The arrow beside New task opens its menu. New session opens the draft page with the caret in
  // the composer, and the draft joins the top of Recent.
  const menu = createMenu(scene, root, cursor, trigger, scene.template("menu"));
  const opened = menu.open(0.3);
  const picked = menu.pick("session", opened + 0.6, 0.6);
  // The page opens once the menu has closed, so a phone stage never shows the menu over the page.
  const drafted = picked + 0.2;
  scene.at(drafted, () => {
    board.hidden = true;
    page.hidden = false;
    root.dataset.pane = "main";
  });
  // The sidebar changes once a phone stage has faded its pane out.
  scene.at(drafted + 0.1, () => kanban.removeAttribute("aria-current"));
  sessions.update(ENTRY.id, drafted + 0.1, { selected: true });
  composer.focus(drafted);
  scene.mark("draft", drafted);

  // The visitor selects New worktree in the work location menu, and Auto branch shows next to it.
  const located = draft.pickLocation("local_worktree", drafted + 0.7);
  scene.mark("location", located);

  // Auto branch opens its popover: an empty branch name names the branch from the first message.
  const branched = draft.openBranch(located + 0.4);
  scene.mark("branch", branched);

  // The pointer rests on the empty branch name, which the hint explains, with the I-beam of a
  // text field.
  draft.leaveBranch(branched + 0.4);
  const rested = cursor.point(draft.branchName, branched + 0.4, 0.6);
  cursor.textBeam(rested - 0.2, branched + 2.15);

  // A click at the start of the text line of the composer closes the popover. The pointer hides
  // while the visitor types the first message, and the draft in the sidebar takes it as its title.
  const textStart = (): Point => {
    const unit = designPixel(root);
    const editor = offsetIn(composer.editor, root);
    return { x: editor.x + 20 * unit, y: editor.y + 22 * unit };
  };
  const clicked = cursor.click(textStart, branched + 2.0, 0.8);
  draft.closeBranch(clicked);
  composer.focus(clicked);
  cursor.hide(clicked + 0.05);
  const written = composer.type(MESSAGE, clicked + 0.25, 26, (shown) => {
    entryTitle.textContent = shown === "" ? ENTRY.title : shown;
  });

  // The pointer shows the I-beam over the text of the composer, until it moves to Send.
  cursor.textBeam(clicked - 0.25, written + 0.3);

  // Send: the composer glides to its dock with the startup placeholder, the startup card and the
  // message come in, and the draft moves to Running with the Starting badge.
  const sent = cursor.click(() => composer.button, written + 0.3, 0.7);
  composer.send(sent);
  draft.send(sent);
  scene.at(sent, () => box.toggleAttribute("data-starting", true));
  card.show(sent + 0.05);
  draft.showSent(message, sent + 0.05);
  sessions.update(ENTRY.id, sent + 0.1, { title: MESSAGE, draft: "starting", running: true });
  scene.mark("sent", sent);

  // The naming model names the branch and the title of the session. The pointer waits in the
  // padding after the chevron, so the state and the chevron stay in view, and when the check and
  // the chevron show, a click on the chevron shows the new branch.
  const named = card.runStep("naming", sent + 0.3, 1.4);
  const nearChevron = (): Point => {
    const chevron = card.chevron("naming");
    const place = offsetIn(chevron, root);
    return {
      x: place.x + chevron.offsetWidth / 2 + 12 * designPixel(root),
      y: place.y + chevron.offsetHeight / 2,
    };
  };
  const waiting = cursor.point(nearChevron, sent + 0.25, 0.8);
  const inspected = cursor.click(() => card.chevron("naming"), named + 0.2, 0.2);
  cursor.point(nearChevron, inspected + 0.1, 0.25);
  card.openDetails("naming", waiting, inspected, inspected + 0.8);
  cursor.hide(inspected + 0.8);
  scene.mark("named", inspected);

  // The host creates the worktree and saves the session, which takes the place of the draft with
  // the title of the naming model. Then the session starts and gets the first message.
  const created = card.runStep("checkout", named, 1.4);
  draft.handOff(created);
  sessions.update(ENTRY.id, created, { title: NAMED.title, runtime: SESSION.runtime });
  const prepared = card.runStep("prepare", created, 1.1);
  const ready = card.runStep("instruction", prepared, 0.4);

  // The session is ready: the card folds, the top bar shows its actions, the message shows its
  // time, and the agent starts to work.
  card.ready(ready);
  composer.focus(ready);
  draft.reveal(ready);
  // The ready session opens the right panel with the Diffs tab of its new worktree, as the app
  // reveals it once the startup ends, after the card folds and the top bar shows its actions.
  scene.at(ready + 0.3, () => {
    rightToggle.setAttribute("aria-pressed", "true");
    slideOpen(
      scene,
      { panel: rightPanel, content: must(rightPanel, "[data-right-content]"), handle: rightHandle },
      "width",
    );
  });
  scene.at(ready, () => {
    box.removeAttribute("data-starting");
    message.removeAttribute("data-pending");
    sentTime.textContent = SENT_TIME;
    setActivity("working");
  });
  sessions.update(ENTRY.id, ready, { draft: undefined });
  scene.mark("ready", ready);

  // The agent searches the code for searchNotes, then reads the note index. The context meter shows the
  // context that the session uses.
  const working = ready + 0.7;
  const searched = rows.tool(row("find-search"), working, 0.8);
  const meter = must(page, "[data-meter]");
  const showUse = contextMeter(meter);
  scene.at(working, () => {
    showUse(contextUse(SESSION, CONTEXT_USED));
    scene.run(fadeIn(meter, 0.3));
  });
  const read = rows.tool(row("read-index"), searched + 0.25, 0.6);
  scene.endAt(read + 2.4);
};
