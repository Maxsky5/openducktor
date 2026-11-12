# Product scenes conventions

The package holds the animated copies of the product UI. The website, the app tour, and a frame renderer use them. Read [the asset record](../../apps/marketing-website/ASSETS.md) before you change a product claim, a view, or a scene.

## Layout

| Path | Holds |
|---|---|
| `src/replicas/<area>/` | Stateless React components of one product area, their stylesheets, and their controllers |
| `src/scenes/<name>/` | `view.tsx`, `view.css`, `timeline.ts`, and `sample.ts` of one scene |
| `src/motion/` | GSAP setup, players, the mount with a handle, the pause control of the page, and the play state on the root of a view. Only the page players watch the play zone of a view |
| `src/frame/` | `SceneFrame`, the root, stage, and stock of every scene, and `Stock`, one template |
| `src/test-support/` | The helpers of the tests: `importProduct` and `readProduct`, which the `copied-*` tests use to compare a replica with the product source from the repository root, and the IntersectionObserver of the player tests |
| `src/registry.ts` | Scene names, sizes, and lazy timeline loaders. It loads no React and no text |
| `src/views.ts` | Lazy view loaders for the React entry |
| `src/astro/` | `Scene.astro`, its static view and timeline maps of the website scenes, and its page script |
| `src/react/Scene.tsx` | `<Scene name theme keys framed options />` and `preloadScene` for a React host that controls when a scene plays, such as the app tour |
| `src/react/PageScene.tsx`, `src/react/ScenePlayer.tsx`, `src/react/page-views.ts` | `<PageScene name theme keys options failure stylesheet />` for a page that a React server renders, such as the documentation, its client player, and its static view map of every scene |
| `styles/` | Layer order, reset of the host base styles, generated theme, Tailwind palette values, replica base, state rules, and the generated stylesheets of `PageScene` in `page/` |
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
9. A scene imports only from its own folder, `src/replicas`, `src/sample`, `src/motion`, and `src/frame`. Move the code that two scenes share to a replica or to `src/sample`. The `no-restricted-imports` rule of oxlint checks this.
10. Use the stage widths of the replicas for a layout change: `width <= 500px` for a phone stage, `width <= 959px` for a tablet stage, and `width <= 699px` and `700px <= width <= 1100px` for the one-column and the tablet layouts of `StudioWindow.css`. Some stylesheets of the website scenes keep other widths, because a change moves their layout. Do not add a new width.

## Shared parts

Build these parts from their replicas. Do not copy their markup, their styles, or their steps into a scene.

| Part | Replica |
|---|---|
| A session page | `SessionPane` and `SessionPage` in `replicas/studio/SessionPage.tsx`, `SessionWindow` for a workspace session with the open sidebar, and `StudioWindow` for the full task session |
| The top bar of a session | `SessionHeader`, `TaskTitle`, and `SplitAction` in `replicas/studio/SessionHeader.tsx`, and `WorkspaceSessionHeader` |
| The right panel tabs and the bottom panel | `PanelTabs`, `BottomPanelFrame`, and `TerminalLines` |
| A draft that a scene types | `ComposerDraft` in the view and `composerDraft` of `replicas/shell/composer.ts` in the timeline. The phone rules of the composer and the transcript are in their replicas |
| A dialog that opens over a window | `modal` of `replicas/studio/modal.ts`, and `progressDialog` for a dialog with the startup progress |
| One pane of a window on a phone stage | `pane` of `AppWindow`, which a timeline switches with `data-pane`. `pinned` keeps the full sidebar on a tablet stage |
| Inline code and highlighted code | `InlineCode` and `Paragraph` in `replicas/ui/InlineCode.tsx`, and `HighlightedCode` in `replicas/studio` |

## Add a scene

1. Create `src/scenes/<name>/` with `view.tsx`, `view.css`, `timeline.ts` (exports `build`), and `sample.ts`. The view renders the static frame, and the timeline builds each run from it.
2. Add the name to `SCENE_NAMES` and the entry to `SCENES` in `src/registry.ts`, and `VIEWS` in `src/views.ts`.
3. For a scene of the website, add the name to `SITE_SCENE_NAMES` in `src/registry.ts`, and add the entries to `ASTRO_VIEWS` and `ASTRO_TIMELINES` in `src/astro/`. `PAGE_VIEWS` in `src/react/page-views.ts` gets the view from `ASTRO_VIEWS`.
4. For a scene that only the documentation shows, add the view to `PAGE_VIEWS` in `src/react/page-views.ts` only. The Astro maps do not hold it, so the website loads none of its styles and none of its timeline.
5. The `satisfies` checks fail until the maps match the names.
6. For a scene with options, add its options to `OPTIONS` in `src/scenes.test.ts`. The type check fails until `OPTIONS` holds them. A scene without options needs no entry. Run `bun run test` in `packages/product-scenes`. The test renders the static view of each registered scene and builds its timeline from it, so it finds a hook or a template that the view does not render.
7. Render `<Scene name="<name>" />` from `@openducktor/product-scenes/astro` in a section of the website, or the React `Scene` in a React host. Play the scene in a browser to its end. A step that adds a tween after the end hold makes the scene grow, and the player reports an error in the console.

## Options and chapter players

- A scene that takes data or settings from its host, such as the release version or the size of the tour frame, exports its options type from `view.tsx` and adds it to `OptionsOf` in `src/registry.ts`. Its view reads the `options` prop. Each host passes `options`, and the type requires them when the scene has options.
- A chapter player, such as `workflow`, exports an object of chapter builders as `build` from `timeline.ts`. Its view renders the `data-chapters` root, and the page styles the tabs. The Astro page script and the React `PageScene` mount it with `mountChapters`. The React `Scene` takes only loop scenes (`LoopSceneName`).

## Host contract

- Import `@openducktor/product-scenes/styles.css` before any other style of the scenes, unless the page already declares the layers `product, replica, views, state` in this order.
- Declare the layers of the scenes after the base layers of the page. `styles/reset.css` then replaces the base rules of the page, such as Tailwind Preflight, inside a scene. An unlayered rule of the page still wins over the scenes, so keep element rules of the page in a layer.
- Load Space Grotesk, as `Space Grotesk Variable` or `Space Grotesk`, and IBM Plex Mono at weights 400 and 500.
- Wrap the React `Scene` in a Suspense boundary. It loads its view and its timeline on demand. To show a scene without its fallback, wait for `preloadScene(name)` before the first render of the scene. A load failure rejects that promise.
- The React `Scene` plays while it is mounted. To stop it, unmount it or hide it in an `Activity`.
- `PageScene` renders the static frame on the server and needs no Suspense boundary. It uses the static views of `PAGE_VIEWS`. Do not import `styles.css`. At build time, `pageStyles()` of `@openducktor/product-scenes/page-styles` gives the stylesheet files of the base styles and of each scene, from the stylesheet imports of the views. Bundle the files of each entry into one stylesheet, serve the results, and give their addresses to `stylesheet`. Each scene links the base stylesheet and its own stylesheet with a React `precedence`, so a page loads only the styles of the scenes that it shows, after the styles of the host. Two scene stylesheets can hold the same part stylesheet, so scope each rule of a scene stylesheet to `:where([data-page-scene="<name>"])`, the wrapper of the view, as `apps/docs-website/scripts/prepare-assets.ts` does. The views also import their own stylesheets. A bundler that links each imported stylesheet as one more file of the page, such as Turbopack, must ignore the stylesheet imports of the package, as `apps/docs-website/next.config.ts` does.
- In the browser, `PageScene` plays as a scene of the website: in its play zone, with the pause control of the page, and with the reduced motion setting. It loads GSAP, its player, and its timeline when the view is one screen height or less from the screen. With reduced motion, a loop scene loads nothing and keeps its static frame, and a chapter player loads for its tabs. The unmount stops it and removes its listeners.
- When the timeline of a `PageScene` does not load, the static frame stays, the `failure` node of the host shows under it, and the error goes to the error handler of the page. A later mount loads the timeline again.
- To put a scene in a frame of the host, set `framed` on the React `Scene`. The scene then fills its container, and it shows no window border and no pointer. Do not style the internals of a scene from the host.

## Public modules

| Export | Holds |
|---|---|
| `./react` | The React `Scene` and `preloadScene` |
| `./react/page` | The React `PageScene` for a page that a React server renders |
| `./astro` | `Scene.astro` for an Astro page. It renders only the scenes in `SITE_SCENE_NAMES` |
| `./styles.css` | The base styles of every scene |
| `./page-styles` | `pageStyles()`, a build-time function that runs in Bun: the stylesheet files of `PageScene`, for the base styles and for each scene. A host bundles them |
| `./keys` | The key labels of macOS (`MAC_KEYS`) and of Windows and Linux (`PC_KEYS`) |
| `./motion/preference` | The reduced motion query and the pause control of the page |
| `./motion/state` | `PLAYER_ROOT`, the root of a view that a page player plays, and `MOTION_STATE`, the values of its `data-motion`: `running` while the view plays, and `paused` out of its play zone or while the visitor pauses motion. A root without `data-motion` has no player that plays it |
| `./motion/gsap`, `./motion/player`, `./motion/once`, `./motion/text`, `./motion/tokens` | GSAP, the page players with their play zones, and the motion helpers that site animations share with the scenes |
| `./sample/tasks`, `./sample/workspace`, `./sample/chats` | The data of the sample story: the tasks, the workspaces, the task ids, and the session titles. The app tour builds its pictures from them. These modules hold data only and load no React |
| `./vocabulary` | The words of the product that the replicas show, such as `LANE_TITLES`, the titles of the board lanes. A test checks the lane titles against the built-in workflow. The module holds data only and loads no React |

Every other module is private. A test of the package can import it by its path.
