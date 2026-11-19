// The preview mode of the video page: the scene or the film plays in real time in a browser. Space
// plays and pauses, the right arrow jumps 1 s forward (5 s with Shift), the left arrow loads the
// page again at an earlier time, and the query `t` starts at a time, with `play` to play at once.
// A bar shows the time. The renderer never opens this mode.
import type { SceneVideo } from "./scenes";

/** The last time that `seek` accepts, a little before the end. */
const END_MARGIN = 0.001;

export function startPreview(video: SceneVideo, duration: number, query: URLSearchParams): void {
  const start = Number(query.get("t") ?? 0);
  if (!(start >= 0))
    throw new Error(`Set t to a time in seconds, 0 or more, not ${query.get("t")}.`);
  const bar = document.createElement("div");
  bar.className = "video-preview-bar";
  document.body.append(bar);
  const last = duration - END_MARGIN;
  let now = 0;
  let playing = query.has("play");
  const go = (time: number): void => {
    now = Math.min(last, Math.max(now, time));
    video.seek(now);
  };
  const reload = (time: number): void => {
    query.set("t", Math.max(0, time).toFixed(2));
    if (playing) query.set("play", "");
    else query.delete("play");
    location.search = query.toString();
  };
  go(start);
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    const step = event.shiftKey ? 5 : 1;
    if (event.key === " ") {
      playing = !playing;
      event.preventDefault();
    } else if (event.key === "ArrowRight") go(now + step);
    else if (event.key === "ArrowLeft") reload(now - step);
  });
  let previous = performance.now();
  const tick = (stamp: number): void => {
    if (playing) go(now + (stamp - previous) / 1000);
    if (now >= last) playing = false;
    previous = stamp;
    bar.textContent = `${now.toFixed(2)} / ${duration.toFixed(2)} s ${playing ? "▶" : "❚❚"}`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
