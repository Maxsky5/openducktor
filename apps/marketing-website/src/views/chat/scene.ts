import { all, must } from "../../motion/dom";
import { designPixel, fadeIn, growIn, pop, riseIn } from "../../motion/effects";
import { mountLoop } from "../../motion/loop";
import { typeText } from "../../motion/text";
import { activityMarks, contextMeter } from "../../replica/shell/composer";
import { pointer } from "../../replica/shell/pointer";
import { follow, transcript } from "../../replica/transcript/transcript";
import {
  CHAT_SESSION,
  CREATED_TASKS,
  QUERY,
  REQUEST,
  SEARCH,
  SEARCH_USED,
} from "../../sample/chat";
import { contextUse } from "../../sample/sessions";

/**
 * A workspace chat turns one request into Backlog tasks. The visitor picks a reusable prompt
 * from the slash menu and types the request. The agent searches the tasks, then creates the
 * tasks that are missing with the OpenDucktor MCP tools. The markup holds the last frame.
 */
export function mountChat(): void {
  mountLoop(must(document, '[data-scene="chat"]'), (scene) => {
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
    const setActivity = activityMarks(root);
    const setContext = contextMeter(meter);
    const rows = transcript(scene, root);
    const cursor = pointer(scene, root);
    follow(scene, track);

    // Start: a new chat. The transcript is empty and the runtime has reported no context use.
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
    scene.endAt(ended + 3.2);
  });
}
