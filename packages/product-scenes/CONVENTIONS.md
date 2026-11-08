# Product scenes conventions

The package holds the animated copies of the product UI. The website, the app tour, and a frame renderer use them. Read [the asset record](../../apps/marketing-website/ASSETS.md) before you change a product claim, a view, or a scene.

## Layout

| Path | Holds |
|---|---|
| `src/replicas/<area>/` | Stateless React components of one product area, their stylesheets, and their controllers |
| `src/scenes/<name>/` | `view.tsx`, `view.css`, `timeline.ts`, and `sample.ts` of one scene |
| `src/motion/` | GSAP setup, players, the mount with a handle, and the pause control of the page. Only the page players load ScrollTrigger |
| `src/frame/` | `SceneFrame`, the root, stage, and stock of every scene, and `Stock`, one template |
| `src/registry.ts` | Scene names, sizes, and lazy timeline loaders. It loads no React and no text |
| `src/views.ts` | Lazy view loaders for the React entry |
| `src/astro/` | `Scene.astro`, its static view and timeline maps, and its page script |
| `src/react/Scene.tsx` | `<Scene name theme keys framed options />` and `preloadScene` for a React host |
| `styles/` | Layer order, reset of the host base styles, generated theme, Tailwind palette values, replica base, and state rules |
| `video/` | The development tool that renders a loop scene to an MP4 file. See [its README](video/README.md) |

## Rules

1. A view is a pure function of its props: no state, no effects, no event handlers. It renders the static frame, most often the last frame of the scene.
2. Scripts find elements by `data-*` hooks and show states with `data-*` attributes. A script never adds or removes a class.
3. Write `data-x=""` on an HTML element. Write a bare `data-x` (the value `true`) when you pass the hook through a component. Scripts and styles find a hook by its name, not by its value.
4. Put each template of a scene in `<Stock name="...">` with one root element, and pass the stock to `SceneFrame`. The timeline clones it with `scene.template(name)`. Never use `<template>`: React does not fill its content on the client. Scope queries to `scene.stage`, because the stock elements are in the DOM.
5. Name a controller for the part that it moves, such as `cards.ts`, `cursor.ts`, or `nav-list.ts`. Its name must differ from every component name in its folder in more than letter case, because macOS and Windows file systems ignore case.
6. Each stylesheet opens with `@layer <product|replica|views> {` and then `:where(.stage) {`, so its rules apply only inside a scene and keep their specificity. Put `@keyframes` and `@property` after the scoped block. Write a dark rule as `:where([data-theme="dark"]) & .x`, so it follows the page root or the `theme` of the scene. `src/styles.test.ts` checks this.
7. Build a view from the replicas of the product areas. Add a replica only for a part of the product that no replica shows yet, and copy the markup and the classes of the product.
8. Keep each file at 400 lines or fewer. The `max-lines` rule of oxlint checks the code files, and `src/styles.test.ts` checks the stylesheets. Use explicit return types, no barrel files, and ASD-STE100 comments.

## Add a scene

1. Create `src/scenes/<name>/` with `view.tsx`, `view.css`, `timeline.ts` (exports `build`), and `sample.ts`. The view renders the static frame, and the timeline builds each run from it.
2. Add the name to `SCENE_NAMES` and the entry to `SCENES` in `src/registry.ts`, `VIEWS` in `src/views.ts`, and `ASTRO_VIEWS` and `ASTRO_TIMELINES` in `src/astro/`. The `satisfies` checks fail until all five match.
3. Add the options of the scene to `OPTIONS` in `src/scenes.test.ts`, and run `bun run test` in `packages/product-scenes`. The test renders the static view of each registered scene and builds its timeline from it, so it finds a hook or a template that the view does not render.
4. Render `<Scene name="<name>" />` from `@openducktor/product-scenes/astro` in a section of the website, or the React `Scene` in a React host. Play the scene in a browser to its end. A step that adds a tween after the end hold makes the scene grow, and the player reports an error in the console.

## Options and chapter players

- A scene that takes data or settings from its host, such as the release version or the size of the tour frame, exports its options type from `view.tsx` and adds it to `OptionsOf` in `src/registry.ts`. Its view reads the `options` prop. Each host passes `options`, and the type requires them when the scene has options.
- A chapter player, such as `workflow`, exports an object of chapter builders as `build` from `timeline.ts`. Its view renders the `data-chapters` root, and the page styles the tabs. The Astro page script mounts it with `mountChapters`. The React `Scene` takes only loop scenes (`LoopSceneName`).

## Host contract

- Import `@openducktor/product-scenes/styles.css` before any other style of the scenes, unless the page already declares the layers `product, replica, views, state` in this order.
- Declare the layers of the scenes after the base layers of the page. `styles/reset.css` then replaces the base rules of the page, such as Tailwind Preflight, inside a scene. An unlayered rule of the page still wins over the scenes, so keep element rules of the page in a layer.
- Load Space Grotesk, as `Space Grotesk Variable` or `Space Grotesk`, and IBM Plex Mono at weights 400 and 500.
- Wrap the React `Scene` in a Suspense boundary. It loads its view and its timeline on demand. To show a scene without its fallback, wait for `preloadScene(name)` before the first render of the scene. A load failure rejects that promise.
- The React `Scene` plays while it is mounted. To stop it, unmount it or hide it in an `Activity`.
- To put a scene in a frame of the host, set `framed` on the React `Scene`. The scene then fills its container, and it shows no window border and no pointer. Do not style the internals of a scene from the host.

## Public modules

| Export | Holds |
|---|---|
| `./react` | The React `Scene` and `preloadScene` |
| `./astro` | `Scene.astro` for an Astro page |
| `./styles.css` | The base styles of every scene |
| `./keys` | The key labels of macOS (`MAC_KEYS`) and of Windows and Linux (`PC_KEYS`) |
| `./motion/preference` | The reduced motion query and the pause control of the page |
| `./motion/gsap`, `./motion/player`, `./motion/once`, `./motion/text`, `./motion/tokens` | GSAP, the page players with their play zones, and the motion helpers that site animations share with the scenes |
| `./sample/tasks`, `./sample/workspace`, `./sample/chats` | The data of the sample story: the tasks, the workspaces, the task ids, and the session titles. The app tour builds its pictures from them. These modules hold data only and load no React |

Every other module is private. A test of the package can import it by its path.
