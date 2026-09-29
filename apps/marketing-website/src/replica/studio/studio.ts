// The Agent Studio window of StudioWindow.astro: the workflow rail, the quick action, the composer,
// the task panel, and the session transcript. A scene applies a frame at build time, then
// patches the window at the time of each change.
import { all, data, must } from "../../motion/dom";
import { fadeIn, pop } from "../../motion/effects";
import type { Scene } from "../../motion/scene";
import { EASE } from "../../motion/tokens";
import { modelName } from "../../sample/models";
import { contextUse, type Session } from "../../sample/sessions";
import {
  type Focus,
  type RailTones,
  ROLES,
  type RoleId,
  type StudioFrame,
} from "../../sample/studio";
import { type SessionId, type TurnId } from "../../sample/transcripts";
import { activityMarks, contextMeter } from "../shell/composer";
import type { Activity } from "../vocabulary";
import { pointer } from "../shell/pointer";
import { notify } from "../shell/toast";
import { follow, transcript } from "../transcript/transcript";
import { studioPanels } from "./panels";
import { studioRequests } from "./requests";

/** A change of the window at one time. Only the fields that change are present. */
export type StudioChange = Partial<StudioFrame> & { activity?: Activity };

/** The controller of the Agent Studio window in the stage of `scene`. */
export function studioWindow<Template extends string>(scene: Scene<Template>) {
  const root = must(scene.stage, "[data-studio]");
  const track = must(root, "[data-track]");
  const split = must(root, "[data-split]");
  const actionLabel = must(root, "[data-action]");
  const steps = all(root, "[data-step]");
  const marks = activityMarks(root);
  const setContext = contextMeter(must(root, "[data-meter]"));
  const cursor = pointer(scene, root);
  const rows = transcript(scene, root);
  const resetFollow = follow(scene, track);
  const panels = studioPanels(scene, root);

  const setTones = (tones: RailTones): void => {
    steps.forEach((step, index) => {
      const tone = tones[index];
      if (!tone) throw new Error(`The workflow rail has no step ${index + 1}.`);
      step.dataset.tone = tone;
      // The chevron before a step takes the tone of that step. The first step has none.
      const link = root.querySelector(`[data-link="${data(step, "step")}"]`);
      link?.setAttribute("data-tone", tone);
    });
  };
  const setSelected = (role: RoleId): void =>
    steps.forEach((step, index) =>
      step.setAttribute("aria-pressed", String(ROLES[index] === role)),
    );
  const setActivity = (activity: Activity): void => {
    marks(activity);
    split.toggleAttribute("data-disabled", activity !== "idle");
  };
  const setSession = (session: Session): void => {
    must(root, "[data-model]").textContent = modelName(session);
    must(root, "[data-effort]").textContent = session.effort;
  };
  const setFocus = (focus: Focus): void => {
    root.dataset.focus = focus;
  };

  /** Shows a frame at build time. The window is idle, as at the end of a step. */
  const apply = (frame: StudioFrame, activity: Activity = "idle"): void => {
    setTones(frame.tones);
    setSelected(frame.selected);
    actionLabel.textContent = frame.action;
    setActivity(activity);
    split.toggleAttribute("data-disabled", frame.actionDisabled || activity !== "idle");
    setSession(frame.session);
    setContext(contextUse(frame.session));
    panels.setTab("document", frame.documentTab);
    panels.setTab("ci_checks", frame.checksTab);
    panels.setPanel(frame.panel);
    setFocus(frame.focus);
    if (frame.panelSize) root.dataset.panelSize = frame.panelSize;
    else delete root.dataset.panelSize;
  };

  /** Changes the window at `at`. A changed step pops, and a new action or panel fades in. */
  const patch = (at: number, change: StudioChange): void =>
    scene.at(at, () => {
      const { tones } = change;
      if (tones) {
        const changed = steps.filter((step, index) => step.dataset.tone !== tones[index]);
        setTones(tones);
        for (const step of changed) scene.run(pop(step, 1.06));
      }
      if (change.selected) setSelected(change.selected);
      if (change.activity) setActivity(change.activity);
      if (change.action) {
        actionLabel.textContent = change.action;
        scene.run(fadeIn(actionLabel, 0.35));
      }
      if (change.actionDisabled !== undefined)
        split.toggleAttribute("data-disabled", change.actionDisabled);
      if (change.session) setSession(change.session);
      if (change.documentTab !== undefined) panels.showTab("document", change.documentTab);
      if (change.checksTab !== undefined) panels.showTab("ci_checks", change.checksTab);
      if (change.panel) {
        panels.setPanel(change.panel);
        scene.run(fadeIn(panels.panel(change.panel)));
      }
      if (change.focus) setFocus(change.focus);
    });

  /**
   * Fills the context meter of `session` in steps, as token usage arrives with each response. The
   * meter goes from `from` percent at `at` to the use of the session at `until`.
   */
  const context = (session: Session, from: number, at: number, until: number): void => {
    const value = { used: from };
    scene.timeline.to(
      value,
      {
        used: session.used,
        duration: until - at,
        ease: EASE.batches,
        onUpdate: () => setContext(contextUse(session, value.used)),
      },
      at,
    );
  };

  // Transcript: one session shows at a time, and each turn wraps its rows.
  /** A row of a turn in the transcript. */
  const row = (turn: TurnId, id: string): HTMLElement =>
    must(track, `[data-turn="${turn}"] [data-row="${id}"]`);
  /** Hides the rows of `turns` at build time, so the scene can show them one by one. */
  const hideTurns = (...turns: TurnId[]): void => {
    for (const turn of turns)
      for (const item of all(track, `[data-turn="${turn}"] > *`)) item.hidden = true;
  };
  const setSessionShown = (id: SessionId): void => {
    for (const item of all(track, "[data-session]")) item.hidden = data(item, "session") !== id;
  };
  /** Shows the transcript of another session, as a switch of the session tab does. */
  const switchSession = (id: SessionId, at: number): void =>
    scene.at(at, () => {
      setSessionShown(id);
      resetFollow();
      scene.run(fadeIn(track));
    });

  /** Clicks the quick action of the header. Returns the time of the click. */
  const quickAction = (at: number): number =>
    cursor.click(() => must(root, "[data-quick-action]"), at, 1);

  return {
    root,
    track,
    apply,
    patch,
    context,
    row,
    hideTurns,
    setSessionShown,
    switchSession,
    rows,
    cursor,
    quickAction,
    panels,
    requests: studioRequests(scene, root, cursor),
    notify: (name: Template, at: number, hold: number): void =>
      notify(scene, must(root, "[data-toasts]"), name, at, hold),
  };
}

/** The controller of a Studio window whose view has the templates `Template`. */
export type Studio<Template extends string = never> = ReturnType<typeof studioWindow<Template>>;
