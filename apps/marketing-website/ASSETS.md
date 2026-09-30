# Website design and asset record

## Design contract

The page must make visitors want to try OpenDucktor, and it must show quickly what the product does.

The opening says what OpenDucktor is: open-source mission control for coding agents. The page title, the description, and the sharing image use the same words. The header shows the version of the latest release next to the brand, and it links to the release notes.

The page shows the product with copies of its real UI in HTML and CSS. It uses no screenshots, bitmap product views, or generated artwork.

The copied views use fictional data that shows each feature clearly.

Each product view plays a short scene while it is on screen. The static markup of a view is the last frame of its scene.

A view of a page where agents work uses the full width of the page. Smaller tools can share a row.

The copy states only what the product does. It names the limits that a visitor must know, for example the supported systems and Git hosts.

The page is light by default. The header switch changes the page and the product views together. The page stores no preference.

The site is a static Astro build with no React hydration and no connection to the OpenDucktor host. See [ADR 0009](../../docs/adr/0009-build-the-public-website-with-astro-and-cloudflare-workers-static-assets.md).

## Page structure

| Section | Product view | Scene |
|---|---|---|
| Opening | Kanban board | Agents move sample tasks through the lanes. A task in Human Review has a pull request, and another task waits for an answer. |
| Workflow | Agent Studio in five tabs: Spec, Plan, Build, QA, and Review | Each tab plays one step of the same sample task, from the first question of the Spec agent to the merged pull request. Plan, Build, and QA start where the step before ends, with a click on the action that it shows. The last frame of a step cross fades into the next step. |
| Runtimes | Settings, with the agent defaults of each role | The visitor opens the model picker of the Spec role. No model is a favorite, so the picker opens on the first runtime. The visitor chooses a model from another runtime. |
| Autopilot | Kanban board with the empty lanes collapsed | A task goes from Backlog to Human Review, and nobody clicks. Autopilot starts each agent, and a notification shows each new agent session. QA rejects the first build, and the Builder fixes it with the QA report. The task waits for your approval. |
| Features | Workspace chat, an MCP client, the prompt overrides, and Agent Studio with the worktree tools | The chat creates the missing tasks for a request. An MCP client creates a task. A prompt override gets a placeholder check. The dev servers run in the task worktree. |
| Local | Diagnostics panel | The checks find the tools on the computer, start the runtimes, and connect the MCP server. |
| Install | The desktop app and the browser version, side by side. Each install method has a terminal with its command and a copy button. | The desktop terminals do not move. The browser version terminal types its command once and shows the start log of the web runner. Then it keeps its last frame. |
| Questions and closing | None | The closing shows the duck parade: the OpenDucktor duck leads three ducklings, the coding agents that it runs. They swim in once, then float, and a light scans the visor of the lead duck. |

## Product evidence

Builder read the product source for each view and compared the views with the running app.

| Website view | Product source |
|---|---|
| Kanban board | `packages/frontend/src/components/features/kanban` and `packages/frontend/src/pages/kanban` |
| Agent Studio and the worktree tools | `packages/frontend/src/components/features/agents` and `packages/frontend/src/pages/agents` |
| Workspace chat | `packages/frontend/src/components/features/agents/agent-chat` and `packages/frontend/src/pages/workspace-sessions` |
| Settings and prompt overrides | `packages/frontend/src/components/features/settings` |
| Autopilot rules and starts | `packages/frontend/src/features/autopilot` and `packages/frontend/src/features/session-start/session-start-orchestration.ts` |
| Notifications | `packages/frontend/src/features/notifications`. A new or forked session shows "Session started." A resumed session shows no notification. |
| Lane order in the board | `packages/frontend/src/pages/kanban/use-kanban-board-model.ts`. A task that waits for input shows first in its lane. |
| Diagnostics | `packages/frontend/src/components/features/diagnostics` |
| MCP call and result | `packages/openducktor-mcp`. The client window is generic and names no product. |
| Web runner start log | `packages/openducktor-web/src/launcher.ts` and `packages/openducktor-web/src/logger.ts` |

The views follow the product layout, labels, status colors, and controls. The tasks, the repository, the code, and the agent output are fictional. The model and provider names are also fictional, so the page claims no support for a specific model.

The product screenshots in `docs/assets/screenshots/` are research evidence only. The build does not publish them.

The components in `src/replica/` copy the product UI, and each folder in `src/views/` puts them together for one view. The controls in `src/replica/ui/`, such as the button and the switch, copy the components of `packages/frontend/src/components/ui/`. The fictional data is in `src/sample/`. These components do not import React, desktop state, host APIs, or runtime connections.

## Motion

The views play with GSAP and its ScrollTrigger plugin. The code in `src/motion/` has one job for each file:

| File | Job |
|---|---|
| `preference.ts` | The reduced motion query and the pause control of the header. It has no GSAP, so a page without views, such as the 404 page, does not load GSAP. |
| `player.ts` | The shared player: a view builds its first frame when the page loads, plays while it is in its part of the screen, and pauses with the control. |
| `loop.ts`, `chapters.ts`, `once.ts` | The three ways to play: a loop, the workflow steps one after the other, and one play of the browser version terminal. |
| `scene.ts` | The tools of a scene builder: the fresh stage, the paused timeline, the templates of the view, and the end of the scene. |
| `effects.ts`, `text.ts` | Shared tweens, such as a pop or a height change, and text steps, such as typed input and streamed model output. |
| `frame.ts` | The cover that holds the last frame during a cross fade, with the scroll offsets of the frame. |
| `dom.ts`, `tabs.ts`, `tokens.ts` | Typed queries that fail loudly, the keyboard pattern of the step tabs, and the named eases of the views. `dom.ts` has no GSAP, so the header and the brand links use it on every page. |
| `offset.ts` | The position of an element in a replica, with the translation that GSAP gives it. |

The product parts that move have a controller next to their component, for example `src/replica/board/board.ts` for the Kanban board and `src/replica/studio/studio.ts` for the Agent Studio window. The `scene.ts` file of each view builds the timeline of that view from these parts. The workflow steps have one file each in `src/views/workflow/`, and they share `session.ts`.

Each loop restores the static markup and builds a new timeline. DOM changes from one loop cannot stay in the next loop. The last frame of a loop cross fades into the first frame of the next loop. A copy of the last frame covers the view and fades out, so the product window does not go blank. The next loop starts when the cross fade ends.

The Agent Studio window takes one frame record, and `src/sample/studio.ts` holds the last frame of each workflow step. The markup of a step renders its last frame, and the next step applies the same record at its start, so each step starts where the step before it ends. The transcripts are data in `src/sample/transcripts.ts`, with typed row ids for the scenes.

The scenes follow the GSAP practices of the official GSAP skills:

- `gsap.ts` registers ScrollTrigger once. One `gsap.matchMedia()` context starts the views only when motion is allowed, and its cleanups kill each timeline, tween, and trigger and put back the markup.
- A step that measures the layout when it plays makes its tween then. `scene.run()` adds that tween to the scene timeline, so the pause control and the next loop also stop it. Such a tween must end before the end of its scene: the player reports an error when a scene grows while it plays.
- A step with several parts uses one nested timeline with position values, not `delay`.
- The scenes animate transforms and opacity. A step animates a width, a height, or a margin only where the product view reflows, for example when a lane opens.
- The CSS sets no `will-change`. GSAP promotes an element only while a transform tween runs.
- A workflow step with a longer text changes the page height on a narrow screen. Then the chapter player calls `ScrollTrigger.refresh()`, so the views below start and stop at the correct place.

The header has one control that pauses and resumes all scenes. It shows only when motion is allowed. With this control, visitors can stop the moving content, as WCAG 2.2.2 requires.

When the system asks for reduced motion, no scene plays and the control is hidden. Each view shows its last frame.

Without JavaScript, each view shows its last frame. The workflow steps show one after the other, each with its heading and text.

The desktop terminals show only their command, so a visitor can copy it at once. The browser version terminal keeps its final size while it types, so the page does not move. The pause control shows its last frame at once, because the command is the content. The terminal cursor blinks only while motion plays.

The opening text does not move. The headline and the install actions are visible on first paint. The opening product view is flat on first paint, and scroll does not tilt it.

The duck mark hops once on the water when the page opens, and it bobs when the visitor points at or focuses a brand link. A light scans its visor now and then. CSS plays these animations, and `src/ui/brand.ts` only starts them. The duck stays in view the whole time. Reduced motion keeps it still. A hop or a bob that starts plays to its end, and the pause control stops the light and the next bobs.

## Theme and typography

`scripts/product-theme.ts` extracts the light and dark token blocks from `packages/frontend/src/styles.css`. `src/replica/Replica.astro` imports them as the CSS module `virtual:openducktor/product-theme.css`, so Astro bundles and hashes them with the styles of the product views. A missing or changed block stops the build with an actionable error. The output includes no desktop selectors, Tailwind runtime, or JavaScript.

The website styles use their own page tokens. The product views use the semantic tokens of the product, which apply only inside the root of each copied UI.

`src/replica/studio/highlight.ts` colors the sample TypeScript at build time. It covers only the sample code and adds no client script.

The default is light for all system settings. The header switch changes the page and all product views. A reload restores light.

| Asset | Source and license | Publication |
|---|---|---|
| Space Grotesk | `@fontsource-variable/space-grotesk`, SIL Open Font License 1.1 | Self-hosted WOFF2 with a Latin preload and `/space-grotesk-license.txt`. |
| IBM Plex Mono | `@fontsource/ibm-plex-mono`, SIL Open Font License 1.1 | Self-hosted Latin WOFF2 at weights 400 and 500, as in the desktop app. The page preloads weight 400 and publishes `/ibm-plex-mono-license.txt`. |
| GSAP | `gsap` 3.15, GreenSock standard no-charge license | Bundled in the page scripts. The license forbids the removal of its notices, so the build keeps them. |
| Duck mark and favicon | Website-owned `artwork/favicon.svg`, and `src/ui/Brand.astro` with the geometry of `src/ui/duck.ts` | A rubber duck with a night vision visor, on the violet tile of the app icon. The header, the footer, the favicon, and the sharing image use it. |
| Product brand mark | `packages/frontend/src/assets/openducktor-mark.svg`, repository Apache 2.0 license | The product views copy the app sidebar, so they show the mark of the app, copied without modification. |
| GitHub mark | [GitHub Brand Toolkit](https://brand.github.com/) | Inline mark on the header and opening links to the project repository. It identifies the link destination. |
| Runtime brand marks | `packages/frontend/src/components/features/agents/agent-runtime-icon.tsx` | Static SVG geometry and brand colors in `src/replica/shell/RuntimeIcon.astro`. They identify the coding runtimes. |
| Icons | `@lucide/astro`, ISC and inherited Feather MIT notices | Static inline SVG and `/lucide-license.txt`. |
| Sharing image | Website-owned `artwork/open-graph.svg` | Generated 1200 by 630 PNG with factual copy and the light palette. |

Asset preparation recreates the ignored `public/` directory, so removed designs cannot stay in the output. The CI path filters include the shared product theme and brand mark, because they change the build.

## Interaction and accessibility

The workflow steps use the tabs pattern. The arrow keys wrap, Home and End select the first and last tab, and one tab is in the tab order.

A workflow tab has a short name, for example "01 Spec". The step text is its description.

Each product view has `role="img"` and a text alternative that tells what the scene shows. The copied UI in the view has `aria-hidden="true"`, so a screen reader does not read its headings and controls. The views contain no focusable elements.

The install terminals are real text. A screen reader can read each command and the start log of the web runner.

A copy button copies the full command from `data-command`, also while the terminal types it. A status message tells the visitor if the copy worked. If the copy failed, the message tells the visitor to select the command and copy it. An install terminal shows this message under its screen.

The questions use `details` and `summary` elements, so they work with a keyboard and without JavaScript.

Page text outside the product views has a contrast of 4.5:1 or more. Large text has 3:1 or more.

Text sizes use rem units. At 200% text size, the page has no horizontal scroll at widths from 320 pixels. The header actions and the workflow tabs wrap to more lines.

## Reference study

Builder inspected rendered pages at the following URLs on 2026-09-20. These pages informed composition and hierarchy. No page text, source code, logo, or artwork was copied.

| Reference | Observed treatment | Application |
|---|---|---|
| [bb](https://getbb.app/) | A compact header, centered opening, direct install actions, and a large product view with readable conversation content. | Give the product view enough width. Put the install action near the opening. |
| [T3 Code](https://t3.codes/) | Large centered type, a wide workspace, and small code-based explanations below it. | Use a clear opening and a substantial UI example. Do not copy floating agent logos, grid decoration, or social claims. |
| [Emdash](https://emdash.com/) | Fine rules, restrained colors, distinct section labels, and focused UI examples for individual capabilities. | Separate content with rules and use native UI to explain task context. |
| [21st.dev](https://21st.dev/) | Earlier study: large typography, a dense preview collection, and a clear distinction between links and controls. | Keep interactions explicit. Do not import a template. |
| [Orca](https://www.onorca.dev/) | Earlier study: a centered introduction and selectable product views. | Keep the product near the opening and allow visitors to choose a view. |
| [Superset](https://superset.sh/) | Earlier study: strong download actions and selectable product views; animated text could disappear during entry. | Keep essential text visible on first paint. Use no autoplay or entrance sequence for the headline. |

Research screenshots remain local evidence and are not published assets.
