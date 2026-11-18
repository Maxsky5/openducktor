import { afterAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Each film renders its static view, and its builder builds the master timeline from that markup:
// each scene of its sets, each move of the camera, each caption, and the titles. A caption that
// shows while another one shows, a set without a scene, or a missing mark fails the build. The
// document has no layout, so the test does not play the film. A browser checks the play with the
// video tool.

GlobalRegistrator.register();
// The test loads no stylesheet, so it gives each element the design pixel that a build reads.
const designPixel = document.createElement("style");
designPixel.textContent = "* { --u: 1px; }";
document.head.append(designPixel);
Object.defineProperty(HTMLElement.prototype, "offsetParent", {
  configurable: true,
  get(this: HTMLElement) {
    return this.parentElement;
  },
});
const [{ createElement }, { renderToStaticMarkup }, { mountFilm }, { FILMS, FILM_NAMES }, views] =
  await Promise.all([
    import("react"),
    import("react-dom/server"),
    import("./films/engine/film"),
    import("./films/registry"),
    import("./films/views"),
  ]);
const [{ MAC_KEYS }, { SCENES }, { all, data }] = await Promise.all([
  import("./replicas/keys"),
  import("./registry"),
  import("./motion/dom"),
]);

/** The most words of a caption sub. */
const SUB_WORDS_MAX = 12;

/** The most characters of a caption title line, so the line fits the caption column. */
const TITLE_LINE_MAX = 19;

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test.each([...FILM_NAMES])("the %s film builds its timeline from its view", async (name) => {
  const View = await views.FILM_VIEWS[name]();
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(createElement(View, { keys: MAC_KEYS }));
  document.body.append(holder);
  try {
    const root = holder.querySelector("[data-film]");
    if (!(root instanceof HTMLElement)) throw new Error(`The ${name} film has no root.`);
    const builders = new Map(
      await Promise.all(
        all(root, "[data-set]").map(async (set) => {
          const scene = data(set, "set");
          const entry = Object.entries(SCENES).find(([key]) => key === scene)?.[1];
          if (!entry || !("timeline" in entry)) throw new Error(`The set ${scene} has no scene.`);
          return [scene, await entry.timeline()] as const;
        }),
      ),
    );
    const film = mountFilm(root, FILMS[name].size, builders, await FILMS[name].timeline());
    expect(film.duration).toBeGreaterThan(30);
  } finally {
    holder.remove();
  }
});

test("each caption title line of the release film fits the caption column", async () => {
  const { CAPTIONS } = await import("./films/release-1-2-2/captions");
  const long = Object.values(CAPTIONS)
    .flatMap((caption) => caption.title.map((line) => line.replaceAll("*", "")))
    .filter((line) => line.length > TITLE_LINE_MAX);
  expect(long).toEqual([]);
});

test("each caption sub of the release film has 12 words or fewer, so a viewer reads it in time", async () => {
  const { CAPTIONS } = await import("./films/release-1-2-2/captions");
  const long = Object.values(CAPTIONS)
    .map((caption) => caption.sub)
    .filter((sub) => sub.split(" ").length > SUB_WORDS_MAX);
  expect(long).toEqual([]);
});
