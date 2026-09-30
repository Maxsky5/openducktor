import { must } from "../../motion/dom";
import { designPixel, pop } from "../../motion/effects";
import { mountLoop } from "../../motion/loop";
import { stream, typeText } from "../../motion/text";
import { addCard, boardOf, laneCount, setLaneCount } from "../../replica/board/board";
import { transcript } from "../../replica/transcript/transcript";
import { PROMPT } from "../../sample/mcp";

/**
 * An MCP client creates a task with odt_create_task. The MCP server sends the call to the running
 * app. The host saves the task and publishes external_task_created, so the board shows the card
 * with no notification. The markup holds the last frame.
 */
export function mountMcp(): void {
  mountLoop(must(document, '[data-scene="mcp"]'), (scene) => {
    const root = must(scene.stage, "[data-root]");
    const client = must(root, "[data-mcp-client]");
    const prompt = must(root, "[data-prompt]");
    const call = must(root, "[data-call]");
    const callHead = must(call, "[data-call-line]");
    const args = must(call, "[data-args]");
    const result = must(root, "[data-result]");
    const board = boardOf(scene);
    const lane = board.lane("open");
    const card = board.card("new");
    const hits = [must(result, "[data-hit]"), must(card, "[data-task-id]")];
    const rows = transcript(scene, root);

    // The client keeps its final height, so the board stays still while the log fills.
    client.style.minHeight = `calc(${client.offsetHeight / designPixel(root)} * var(--u))`;

    // Start: the client waits for a request, and the Backlog lane holds the cards before the new one.
    card.remove();
    setLaneCount(lane, laneCount(lane));
    call.hidden = true;
    result.hidden = true;
    prompt.toggleAttribute("data-typing", true);

    const typed = typeText(scene, prompt, PROMPT, 0.6, { charsPerSecond: 26 });
    const sent = typed + 0.4;
    scene.at(sent, () => prompt.removeAttribute("data-typing"));

    // The model writes the tool arguments. The call runs while the host saves the task.
    const called = sent + 0.5;
    scene.at(called, () => rows.reveal(call));
    const written = stream(scene, args, called + 0.15, 30);
    scene.at(written, () => callHead.toggleAttribute("data-running", true));

    // The result and the board show the same task at the same time.
    const saved = written + 0.6;
    scene.at(saved, () => {
      callHead.removeAttribute("data-running");
      rows.reveal(result);
      for (const hit of hits) hit.toggleAttribute("data-lit", true);
    });
    addCard(scene, must(lane, "[data-lane-body]"), card, saved);
    scene.at(saved + 0.1, () => scene.run(pop(must(lane, "[data-lane-count]"), 1.12)));
    scene.endAt(saved + 3.6);
  });
}
