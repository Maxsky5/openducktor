import {
  createElement,
  type ReactElement,
  type RefObject,
  use,
  useEffect,
  useRef,
  useState,
} from "react";
import type { SceneTheme, ViewPropsOf } from "../frame/SceneFrame";
import { mountScene } from "../motion/mount";
import type { SceneBuilder } from "../motion/scene";
import { type KeyLabels, MAC_KEYS } from "../replicas/keys";
import type { LoopSceneName, SceneOptions, SceneOptionsProp } from "../registry";
import type { SceneViewLoaders } from "../views";

/** The props of the scene `Name`. */
type ScenePropsOf<Name extends LoopSceneName> = {
  name: Name;
  /** The theme of the scene. Without it, the scene follows `data-theme` of the page root. */
  theme?: SceneTheme;
  /** The keys that the scene shows. The default is the macOS keys. */
  keys?: KeyLabels;
  /**
   * The host draws the frame of the scene. The scene then takes the size of its container, its
   * product window has no border, corners, or shadow, and it shows no pointer of a visitor.
   */
  framed?: boolean;
} & SceneOptionsProp<Name>;

export type SceneProps<Names extends LoopSceneName = LoopSceneName> = {
  [Name in Names]: ScenePropsOf<Name>;
}[Names];

/** The scene that a host asks for. */
type SceneSetup<Name extends LoopSceneName> = {
  theme: SceneTheme | undefined;
  keys: KeyLabels;
  framed: boolean;
  options: SceneOptions<Name>;
};

/** The view and the timeline of a scene, after they load. */
type LoadedScene = {
  /** Renders the view for the setup of a host of the same scene, with its root ref. */
  render(setup: SceneSetup<LoopSceneName>, root: RefObject<HTMLDivElement | null>): ReactElement;
  build: SceneBuilder<string>;
};

/** A promise that keeps its result, which React `use` reads, so a settled load does not suspend. */
type SettledPromise<T> = Promise<T> & {
  status?: "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
};

type MountedSceneProps = {
  name: LoopSceneName;
  load: Promise<LoadedScene>;
  setup: SceneSetup<LoopSceneName>;
};

function MountedScene({ name, load, setup }: MountedSceneProps): ReactElement {
  const { render, build } = use(load);
  const root = useRef<HTMLDivElement>(null);
  // The element stays the same for the life of this component, so React never renders the view
  // again over the DOM that the timeline changes. A new scene, theme, keys, frame, or options
  // mount a new one.
  const [view] = useState(() => render(setup, root));

  useEffect(() => {
    const element = root.current;
    if (!element) throw new Error(`The ${name} scene did not render its root.`);
    const mounted = mountScene(element, build);
    mounted.play();
    return mounted.stop;
  }, [name, build]);

  return view;
}

/** A React player and a preload function that share the cache for these scenes. */
export function createScenePlayer<Names extends LoopSceneName>(
  views: Pick<SceneViewLoaders, Names>,
  scenes: Record<Names, { timeline: () => Promise<SceneBuilder<string>> }>,
) {
  const loads = new Map<Names, Promise<LoadedScene>>();

  /** Loads the view and the timeline of a scene once, so each render gets the same promise. */
  function loadScene<Name extends Names>(name: Name): Promise<LoadedScene> {
    const known = loads.get(name);
    if (known) return known;
    const load: SettledPromise<LoadedScene> = Promise.all([
      views[name](),
      scenes[name].timeline(),
    ]).then(([View, build]) => ({
      render: ({ theme, keys, framed, options }: SceneSetup<Name>, root) => {
        const props: ViewPropsOf<Name> = { theme, keys, framed, ref: root, options };
        return createElement(View, props);
      },
      build,
    }));
    load.then(
      (value) => {
        load.status = "fulfilled";
        load.value = value;
      },
      (reason) => {
        load.status = "rejected";
        load.reason = reason;
      },
    );
    loads.set(name, load);
    return load;
  }

  /**
   * Starts to load the view and the timeline of the scene `name`, and resolves when both load. A
   * `Scene` of that name then renders at once, without its Suspense fallback. The promise rejects
   * when a module does not load.
   */
  async function preloadScene(name: Names): Promise<void> {
    await loadScene(name);
  }

  /**
   * A scene that plays while it is mounted. A host that hides the scene, such as with a hidden
   * `Activity`, stops it through the cleanup of its effects. The scene does not play with reduced
   * motion.
   */
  function Scene(props: SceneProps<Names>): ReactElement {
    const { name, theme, keys = MAC_KEYS, framed = false } = props;
    const options = props.options ?? {};
    const key = `${name}:${theme ?? "page"}:${keys.modifier}:${keys.alt}:${framed}:${JSON.stringify(options)}`;
    return (
      <MountedScene
        key={key}
        name={name}
        load={loadScene(name)}
        setup={{ theme, keys, framed, options }}
      />
    );
  }

  return { Scene, preloadScene };
}
