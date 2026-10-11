import { all, must } from "../../motion/dom";
import { designPixel, fadeIn, growIn, pop, riseIn } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { mountLoop } from "../../motion/loop";
import { typeText } from "../../motion/text";
import { EASE } from "../../motion/tokens";
import { composerActivity, contextMeter } from "../../replica/shell/composer";
import { pointer } from "../../replica/shell/pointer";
import { sessionList } from "../../replica/shell/sidebar";
import { notify } from "../../replica/shell/toast";
import { startDialog } from "../../replica/studio/start-dialog";
import { follow, transcript } from "../../replica/transcript/transcript";
import {
  CHAT_SESSION,
  CREATED_TASKS,
  MENU_TASK,
  QUERY,
  REQUEST,
  SEARCH,
  SEARCH_USED,
} from "../../sample/chat";
import { NAV_SESSIONS } from "../../sample/nav";
import { contextUse } from "../../sample/sessions";
import { CHAT_ENTRY, studioNav } from "../../sample/studio-nav";
import type { ChatTemplate } from "./templates";

const BUILDER = NAV_SESSIONS["menu-build"];

/**
 * A workspace chat turns one request into Backlog tasks. The visitor picks a reusable prompt
 * from the slash menu and types the request. The agent searches the tasks, then creates the
 * tasks that are missing with the OpenDucktor MCP tools. Then the visitor opens a new task from
 * its card and starts its Builder in the background, so the chat stays on screen. The markup
 * holds the last frame.
 */
export function mountChat(): void {
  mountLoop<ChatTemplate>(must(document, '[data-scene="chat"]'), (scene) => {
    const root = must(scene.stage, "[data-root]");
    const track = must(root, "[data-track]");
    const editor = must(root, "[data-editor]");
    const chip = must(editor, "[data-chip]");
    const typed = must(editor, "[data-typed]");
    const menu = must(root, "[data-slash]");
    const send = must(root, "[data-send]");
    const meter = must(root, "[data-meter]");
    const row = (name: string): HTMLElement => must(track, `[data-row="${name}"]`);
    const searchArgs = must(row("search"), "[data-tool-args]");
    const setActivity = composerActivity(root);
    const sessions = sessionList(scene, root);
    const setContext = contextMeter(meter);
    const rows = transcript(scene, root);
    const cursor = pointer(scene, root);
    follow(scene, track);

    // Start: a new chat. The transcript is empty and the runtime has reported no context use. The
    // sidebar lists the chat when it runs, and the Builder when it starts.
    sessions.place([{ ...BUILDER, later: true }, ...studioNav({ ...CHAT_ENTRY, later: true })]);
    for (const child of all(track, ":scope > *")) child.hidden = true;
    for (const card of all(track, "[data-task]")) card.hidden = true;
    meter.hidden = true;
    searchArgs.textContent = SEARCH.running;
    setActivity("idle");

    // The visitor clicks the composer and types a slash query. The menu lists the matching prompts.
    const focused = cursor.click(() => editor, 0.5, 0.9);
    scene.at(focused, () => typed.toggleAttribute("data-typing", true));
    const queryAt = focused + 0.4;
    scene.at(queryAt, () => editor.toggleAttribute("data-draft", true));
    const queried = typeText(scene, typed, QUERY, queryAt, { charsPerSecond: 12 });
    scene.at(queried, () => {
      menu.toggleAttribute("data-open", true);
      scene.run(riseIn(menu, 6 * designPixel(root), 0.25));
    });

    // Enter picks the active prompt. The prompt becomes a chip, and the request follows it.
    const picked = queried + 1.3;
    scene.at(picked, () => {
      menu.removeAttribute("data-open");
      typed.textContent = "";
      chip.hidden = false;
      scene.run(pop(chip, 1.08));
      send.toggleAttribute("data-ready", true);
    });
    const requested = typeText(scene, typed, REQUEST, picked + 0.4, { charsPerSecond: 22 });

    // Send posts the prompt text with the request in place of $ARGUMENTS.
    const sent = cursor.click(() => send, requested + 0.25, 0.7);
    scene.at(sent, () => {
      typed.removeAttribute("data-typing");
      typed.textContent = "";
      chip.hidden = true;
      editor.removeAttribute("data-draft");
      send.removeAttribute("data-ready");
      setActivity("working");
    });
    sessions.update(CHAT_ENTRY.id, sent, { running: true, selected: true });
    cursor.hide(sent + 0.35);
    rows.show(row("message"), sent + 0.1);

    // The agent searches the tasks for export, and finds the Markdown export task.
    const searched = rows.tool(row("search"), sent + 0.8, 0.9);
    scene.at(searched, () => {
      searchArgs.textContent = SEARCH.done;
      setContext(contextUse(CHAT_SESSION, SEARCH_USED));
      meter.hidden = false;
      scene.run(fadeIn(meter));
    });
    let at = rows.say(row("plan"), searched + 0.3) + 0.35;

    // Each create_task call shows the new task under its tool row.
    for (const task of CREATED_TASKS) {
      const created = rows.tool(row(`create-${task.id}`), at, 0.7);
      const card = must(row(`create-${task.id}`), "[data-task]");
      scene.at(created, () => {
        card.hidden = false;
        scene.run(growIn(card, 0.45));
      });
      at = created + 0.75;
    }

    // The final message ends the turn. The runtime reports the context use of the turn.
    const ended = rows.say(row("final"), at);
    scene.at(ended, () => {
      setActivity("idle");
      setContext(contextUse(CHAT_SESSION));
      scene.run(pop(meter, 1.06));
    });
    sessions.update(CHAT_ENTRY.id, ended, { running: false, time: "now" });

    // The visitor opens the task that can start now. Its details slide in over the chat.
    const sheet = scene.template("sheet");
    const panel = must(sheet, "[data-sheet]");
    const shade = must(sheet, "[data-sheet-shade]");
    const open = must(row(`create-${MENU_TASK.id}`), "[data-task-open]");
    const opened = cursor.click(() => open, ended + 0.9, 0.9);
    scene.at(opened + 0.05, () => {
      root.append(sheet);
      scene.run(fadeIn(shade, 0.3));
      scene.run(
        gsap.fromTo(panel, { xPercent: 100 }, { xPercent: 0, duration: 0.3, ease: EASE.arrive }),
      );
    });

    // Start Builder opens the start dialog, and the sheet closes behind it.
    const clicked = cursor.click(() => must(panel, "[data-sheet-start]"), opened + 1.8, 1);
    scene.at(clicked + 0.1, () => {
      scene.run(gsap.to(panel, { xPercent: 100, duration: 0.2, ease: EASE.dismiss }));
      scene.run(
        gsap.to(shade, {
          autoAlpha: 0,
          duration: 0.2,
          ease: EASE.dismiss,
          onComplete: () => sheet.remove(),
        }),
      );
    });

    // Run in background starts the Builder. The chat stays, and the session joins Running.
    const dialog = scene.template("builder-dialog");
    const closed = startDialog(scene, root, cursor, dialog, clicked + 0.1, "background");
    const started = closed - 0.5;
    cursor.hide(closed);
    sessions.update(BUILDER.id, started);
    notify(scene, must(root, "[data-toasts]"), "toast-started", started + 0.2, 3.4);
    scene.endAt(started + 4.4);
  });
}
