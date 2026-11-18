// Chapter 6 of the release film: keyboard shortcuts, in two beats of one scene. First, the visitor
// holds Mod: the sessions of the sidebar show their numbers, and Mod+3 opens the third one. Then
// Open Settings shows the dialog, and the visitor records new keys for Fork from message. The held
// keys show large in the caption column, not in the window, so they never cover the app. Each step
// plays at the speed of the app.
import type { Framing, Shot } from "../engine/camera";
import type { Film } from "../engine/film";
import { CAPTIONS } from "./captions";
import {
  BEAT_TRAVEL,
  BESIDE,
  CHAPTER_TRAVEL,
  POINTER,
  partOf,
  playBeat,
  REST,
  shotOf,
  TRAVEL_EASE,
} from "./shots";
import { FRAME } from "./view";

/** The framing of the whole window, and of the Settings dialog, which fills it. */
const WINDOW: Framing = { ...BESIDE, maxZoom: 1 };
/** The largest zoom of the sessions of the sidebar, so their numbers read on a phone. */
const SESSIONS_ZOOM = 2.4;
/**
 * World pixels above the workspace switch and under the Settings row: the New task button above
 * the switch stays out of the frame.
 */
const SESSIONS_MARGIN = 6;
/**
 * Scene seconds from the open of Settings to the click on Keyboard shortcuts: the pointer starts
 * 0.5 s after the open and travels for 0.8 s.
 */
const SECTION_CLICK = 1.3;

/** Plays the chapter from `at`. Returns the time when it ends. */
export function shortcutsChapter(film: Film, at: number): number {
  const { camera, captions, keys } = film;
  const part = (selector: string): (() => HTMLElement) =>
    partOf(film, "keyboard-shortcuts", selector);

  // The sessions of the sidebar, from the workspace switch to the Settings row, large. The right
  // edge of the frame is the edge of the sidebar, so no text of the chat is cut.
  const sessions = (): Shot => {
    const controls = camera.boxOf(part(".sb-controls")());
    const list = camera.boxOf(part(".sb-sessions")());
    const footer = camera.boxOf(part(".sb-footer")());
    const top = controls.y - SESSIONS_MARGIN;
    const bottom = footer.y + footer.height + SESSIONS_MARGIN;
    const zoom = Math.min(SESSIONS_ZOOM, FRAME.height / (bottom - top));
    const right = Math.max(list.x + list.width, footer.x + footer.width);
    return { x: right - FRAME.width / 2 / zoom, y: top + FRAME.height / 2 / zoom, zoom };
  };
  const numbers = playBeat(
    film,
    {
      set: "keyboard-shortcuts",
      caption: CAPTIONS.shortcutSessions.id,
      play: { mark: "hold" },
      shot: sessions,
      lead: 0.45,
      result: { mark: "jump", hold: 0.9 },
      travel: CHAPTER_TRAVEL,
    },
    at,
  );
  const run = numbers.run;
  // The speeds of the scene, in its order. The rest after Mod goes up plays slower, so the camera
  // takes the whole window before Control goes down, and Settings opens in a still frame. The
  // pointer goes faster to its targets, and the rest after the search plays faster.
  run.speed(run.at("mod-up", 0.1), 0.5);
  run.speed(run.at("control", -0.05), 1);
  run.speed(run.at("settings", 0.5), POINTER);
  run.speed(run.at("settings", SECTION_CLICK), 1);
  run.speed(run.at("search", -0.9), POINTER);
  run.speed(run.at("search", -0.3), 1);
  run.speed(run.at("record", -1.15), REST);
  run.speed(run.at("record", -0.75), POINTER);
  run.speed(run.at("record", -0.05), 1);
  // The recorder shows Press keys… for 0.4 s, and the rest before Mod goes down plays faster.
  run.speed(run.at("record", 0.4), REST);
  run.speed(run.at("record-keys-1", -0.05), 1);

  keys.show("command", run.mark("hold"), run.mark("jump"), { exit: "cut" });
  keys.show("command-3", run.mark("jump"), run.at("mod-up", 0.3), {
    enter: "cut",
    pressed: [1],
  });
  const opened = numbers.hand();

  // The camera takes the whole window while the third session holds, and Settings opens.
  camera.move(shotOf(film, part(".ks-window"), WINDOW), opened, BEAT_TRAVEL, TRAVEL_EASE);
  captions.show(CAPTIONS.shortcutKeys.id, opened + 0.45);
  keys.show("control", run.mark("control"), run.mark("settings"), { exit: "cut" });
  keys.show("control-comma", run.mark("settings"), run.at("settings", 0.8), {
    enter: "cut",
    pressed: [1],
  });

  // The camera holds on the whole dialog: a closer framing would put the menu of Settings under
  // the caption column, which cuts its labels.
  // The visitor holds Mod, then Shift, then presses F. The new keys and the Custom badge hold. The
  // scene stops before the pointer leaves for Save settings, 0.9 s after the keys.
  const still = run.at("recorded", 0.85);
  const end = still + 0.55;
  keys.show("command", run.mark("record-keys-1"), run.mark("record-keys-2"), { exit: "cut" });
  keys.show("shift-command", run.mark("record-keys-2"), run.mark("recorded"), {
    enter: "cut",
    exit: "cut",
    pressed: [0],
  });
  keys.show("shift-command-f", run.mark("recorded"), end, { enter: "cut", pressed: [2] });
  captions.hide(CAPTIONS.shortcutKeys.id, end - 0.2);
  run.freeze(still);
  return end;
}
