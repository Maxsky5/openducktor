import { must } from "../../motion/dom";
import { pop } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { typeText } from "../../motion/text";
import { composerActivity, composerDraft } from "../../replicas/shell/composer";
import { pointer } from "../../replicas/shell/cursor";
import { composerMenu } from "../../replicas/studio/composer-menu";
import { follow, transcript } from "../../replicas/transcript/rows";
import { FILE_QUERY, MESSAGE, SKILL, SKILLS, SLASH_QUERY } from "./sample";

/**
 * The typed parts of the draft, in their order. A chip follows each query. `end` is the typed text
 * of the draft after the last chip.
 */
const TYPED = ["slash-query", "after-command", "file-query", "after-file", "skill-query", "end"];
const CHIPS = ["slash", "file", "skill"];

/**
 * The visitor writes one message with the three references of the composer. `/` opens the slash
 * menu, and the query filters it. `@` searches the files, and `$` lists the skills. Each pick
 * becomes a chip in the draft. Send posts the message, and the transcript shows the command as
 * text and the file and the skill as chips. The markup holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const track = must(root, "[data-track]");
  const composer = composerDraft(scene, root);
  const { editor, button: send } = composer;
  const piece = (name: string): HTMLElement =>
    name === "end" ? composer.typed : must(editor, `[data-piece="${name}"]`);
  const row = (name: string): HTMLElement => must(track, `[data-row="${name}"]`);
  const setActivity = composerActivity(root);
  const rows = transcript(scene, root);
  const cursor = pointer(scene, root);
  const slash = composerMenu(root, "slash");
  const files = composerMenu(root, "file");
  const skills = composerMenu(root, "skill");
  follow(scene, track);

  // Start: the earlier turn ended, and the draft is empty.
  for (const name of ["message", "read", "answer"]) row(name).hidden = true;
  setActivity("idle");

  /** Puts the caret at the end of the typed part `name`. */
  const caret = (name: string): void => {
    for (const typed of TYPED) piece(typed).toggleAttribute("data-typing", typed === name);
  };
  /** Enter picks the active row: the query goes, and its chip takes its place. */
  const pick = (query: string, chip: string, next: string): void => {
    piece(query).textContent = "";
    const added = piece(chip);
    added.hidden = false;
    scene.run(pop(added, 1.08));
    caret(next);
  };

  // `/` opens the slash menu with the whole catalog. Each letter of the query filters it.
  const typing = 0.9;
  scene.at(typing - 0.4, () => caret("slash-query"));
  composer.draft(typing);
  composer.ready(typing);
  scene.at(typing, () => slash.open());
  const keyAt = (index: number): number => typing + (index === 0 ? 0 : 0.6 + 0.2 * index);
  for (const index of SLASH_QUERY.split("").keys()) {
    scene.at(keyAt(index), () => {
      const text = SLASH_QUERY.slice(0, index + 1);
      piece("slash-query").textContent = text;
      slash.filter(text.slice(1));
    });
  }
  const queried = keyAt(SLASH_QUERY.length - 1);
  const commandPicked = queried + 1.4;
  scene.at(commandPicked, () => {
    slash.close();
    pick("slash-query", "slash", "after-command");
  });
  const commandTyped = typeText(
    scene,
    piece("after-command"),
    MESSAGE.afterCommand,
    commandPicked + 0.35,
    { charsPerSecond: 22 },
  );

  // `@` searches the files. The reference menu opens with the results.
  scene.at(commandTyped, () => caret("file-query"));
  const fileQueried = typeText(scene, piece("file-query"), FILE_QUERY, commandTyped + 0.1, {
    charsPerSecond: 7,
  });
  scene.at(fileQueried + 0.15, () => files.open());
  const filePicked = fileQueried + 1.3;
  scene.at(filePicked, () => {
    files.close();
    pick("file-query", "file", "after-file");
  });
  const fileTyped = typeText(scene, piece("after-file"), MESSAGE.afterFile, filePicked + 0.35, {
    charsPerSecond: 16,
  });

  // `$` lists the skills. The arrow key moves to the skill, and Enter picks it.
  const listed = fileTyped + 0.3;
  scene.at(fileTyped, () => caret("skill-query"));
  scene.at(listed, () => {
    piece("skill-query").textContent = "$";
    skills.open();
  });
  scene.at(listed + 0.8, () => skills.activate(SKILLS.findIndex(({ name }) => name === SKILL)));
  const skillPicked = listed + 1.6;
  scene.at(skillPicked, () => {
    skills.close();
    pick("skill-query", "skill", "end");
  });

  // Send posts the message. The transcript shows the command as text, and the references as chips.
  const sent = cursor.click(() => send, skillPicked + 0.3, 0.7);
  scene.at(sent, () => {
    caret("");
    for (const typed of TYPED) piece(typed).textContent = "";
    for (const chip of CHIPS) piece(chip).hidden = true;
    setActivity("working");
  });
  composer.send(sent);
  cursor.hide(sent + 0.35);
  rows.show(row("message"), sent + 0.1);

  // The agent reads the file and answers.
  const read = rows.tool(row("read"), sent + 0.7, 0.6);
  const answered = rows.say(row("answer"), read + 0.3);
  scene.at(answered, () => setActivity("idle"));
  scene.endAt(answered + 2.2);
};
