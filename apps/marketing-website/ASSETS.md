# Website design and asset record

## Design contract

The page must make visitors want to try OpenDucktor, and it must show quickly what the product does.

The opening says what OpenDucktor is: open-source mission control for coding agents. The page title, the description, and the sharing image use the same words. The header shows the version of the latest release next to the brand, and it links to the release notes.

The page shows the product with copies of its real UI in HTML and CSS. It uses no screenshots, bitmap product views, or generated artwork.

The copied views use fictional data that shows each feature clearly.

Each product view plays a short scene while it is on screen. The static markup of a view is the last frame of its scene. Three views hold another frame: the opening holds its first frame, and the prompts and the command palette hold a frame from the middle of their scenes.

A view of a page where agents work uses the full width of the page. Smaller tools can share a row.

The copy states only what the product does. It names the limits that a visitor must know, for example the supported systems and Git hosts.

The page is light by default. The header switch changes the page and the product views together. The page stores no preference.

The site is a static Astro build with no React hydration and no connection to the OpenDucktor host. See [ADR 0009](../../docs/adr/0009-build-the-public-website-with-astro-and-cloudflare-workers-static-assets.md).

## Page structure

| Section               | Product view                                                                                                                  | Scene                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opening               | Kanban board and the session sidebar of all workspaces                                                                        | Agents move sample tasks through the lanes. The sidebar moves each session between Needs you, Running, and Recent when its state changes. A merged pull request closes a task, and a Builder stops to ask a question. The visitor points at its session in the sidebar and answers the question in the session preview, and the Builder goes back to Running. A stage without the sidebar ends on the question.                                                                                                                                                            |
| Workflow              | The session page of one task in five tabs: Spec, Plan, Build, QA, and Review                                                  | Each tab plays one step of the same sample task, from the first question of the Spec agent to the merged pull request. The collapsed sidebar shows the sessions of the task, and the right panel shows the document or the diff of the step. Plan, Build, and QA start where the step before ends, with a click on the action that it shows. The last frame of a step cross fades into the next step.                                                                                                                                                                      |
| Command palette       | Kanban board with the command palette                                                                                         | The visitor searches across the workspaces, opens the actions of a task with Tab, and starts its Planner in the background. Then the visitor answers the question of a waiting Builder in the palette. A key display under the window shows each key. The palette opens, changes, and closes at once, as in the product.                                                                                                                                                                                                                                                   |
| Runtimes              | Settings, with the agent defaults of each role                                                                                | The visitor opens the model picker of the Spec role. No model is a favorite, so the picker opens on the first runtime. The visitor chooses a model from another runtime.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Autopilot             | Kanban board with the empty lanes collapsed                                                                                   | A task goes from Backlog to Human Review, and nobody clicks. Autopilot starts each agent, and a notification shows each new agent session. QA rejects the first build, and the Builder fixes it with the QA report. The task waits for your approval.                                                                                                                                                                                                                                                                                                                      |
| Features              | A workspace session, an MCP client, the System prompts settings, and the session page with the repository actions             | The workspace session creates the missing tasks for a request. The visitor opens one of them from its card and starts its Builder in the background, so the workspace session stays on screen. An MCP client creates a task. The visitor opens the Spec, Plan, Build workflow from the first screen of the prompts, opens its QA Kickoff prompt, and appends instructions to it. The prompt gets the Appended badge, and the final text shows the append after the built-in text. Each repository action runs in a new terminal of the bottom panel, in the task worktree. |
| Local                 | Diagnostics panel                                                                                                             | The checks find the tools on the computer and the workspace files. The host starts one shared runtime of each kind, and the overview says that everything works.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Install               | The desktop app and the browser version, side by side. Each install method has a terminal with its command and a copy button. | The desktop terminals do not move. The browser version terminal types its command once and shows the start log of the web runner. Then it keeps its last frame.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Questions and closing | None                                                                                                                          | The closing shows the duck parade: the OpenDucktor duck leads three ducklings, the coding agents that it runs. They swim in once, then float, and a light scans the visor of the lead duck.                                                                                                                                                                                                                                                                                                                                                                                |

## Product evidence

Builder read the product source for each view and compared the views with the running app.

| Website view | Product source |
|---|---|
| Kanban board | `packages/frontend/src/components/features/kanban` and `packages/frontend/src/pages/kanban` |
| Session page, panels, and repository actions | `packages/frontend/src/components/features/agents` and `packages/frontend/src/pages/agents` |
| Sidebar, workspace rail, and session preview | `packages/frontend/src/components/layout/sidebar`. The preview opens 180 ms after the pointer enters a row, to the right of the row, and the Reply here block answers a pending question. |
| Command palette and fuzzy marks | `packages/frontend/src/features/command-palette` |
| Workspace session | `packages/frontend/src/components/features/agents/agent-chat` and `packages/frontend/src/pages/workspace-sessions`. The new-session scene of the documentation also copies `packages/frontend/src/components/layout/sidebar/session-create-split-action.tsx` and `packages/frontend/src/features/session-startup`. `src/copied-new-session.test.ts` in `packages/product-scenes` checks the issue import label, the worktree directory and branch, and the startup origin. The import-session scene of the documentation copies `packages/frontend/src/pages/workspace-sessions/workspace-session-import-dialog.tsx`, `workspace-session-import-search.tsx`, and `workspace-session-import-results.tsx`, and `src/copied-import-session.test.ts` checks its labels. A change of the other labels in the app needs a manual update of the scene. |
| Task details and the start of a session from them | `packages/frontend/src/components/features/task-details` and `packages/frontend/src/pages/kanban/use-kanban-session-start-flow.ts`. The start dialog takes focus, so the sheet closes. Run in background closes the dialog and keeps the current page. The startup notification of `packages/frontend/src/features/session-startup/session-startup-stack.tsx` then shows the steps until the session is ready. `src/copied-startup.test.ts` in `packages/product-scenes` checks its titles, its origin, and its step rows. |
| Settings, prompt appends, and prompt overrides | `packages/frontend/src/components/features/settings` |
| Autopilot rules and starts | `packages/frontend/src/features/autopilot` and `packages/frontend-core/src/sessions/start/session-start-orchestration.ts` |
| Notifications | `packages/frontend/src/features/notifications`. A new or forked session shows "Session started." A resumed session shows no notification. |
| Lane order in the board | `packages/frontend/src/pages/kanban/use-kanban-board-model.ts`. A task that waits for input shows first in its lane. |
| Diagnostics | `packages/frontend/src/components/features/diagnostics` |
| Repository action terminals | `packages/host/src/application/actions` and `packages/host/src/application/terminals/terminal-session-producer.ts`. The host prints each command line in dim text before the shell runs it. |
| Session panels, terminals, and browser tabs | `packages/frontend/src/features/session-panels`, `packages/frontend/src/features/browser`, `packages/frontend/src/features/browser-annotations`, `packages/frontend/src/components/features/agents/session-view-controls.tsx`, `packages/frontend/src/components/features/repository-actions/repo-actions-split-button.tsx`, and `packages/frontend/src/components/features/agents/agent-chat/agent-chat-browser-tool.tsx`. The terminal, browser, annotate, and agent-browser scenes copy these labels: the panel toggle and Run tooltips, New tab, Back to workspace, the Share with agents, Annotate, and Agent badge tooltips, the new tab page, the comment box placeholder, and the Browser card with its Screenshot button and its Input and Output sections. No test reads these labels, so a change in the app needs a manual update of the scene. |
| MCP call and result | `packages/openducktor-mcp`. The client window is generic and names no product. |
| Web runner start log | `packages/openducktor-web/src/launcher.ts` and `packages/openducktor-web/src/logger.ts` |

Seven unit tests in `packages/product-scenes/src/` compare copies with the product source. They compare values that the product exports, or a copied asset file, and do not match code text. `copied-prompts.test.ts` checks the kickoff prompts and the QA Kickoff prompt of the prompts scene. `copied-settings.test.ts` checks the section list, and the role rows, workflow groups, and rows of the prompt screens, the QA Kickoff prompt and its placeholders, and the badge and final text labels of the prompts scene. `copied-palette-match.test.ts` checks the rows and the marks of the palette search. `copied-mark.test.ts` checks the brand mark. `copied-composer.test.ts` checks the slash menu, the skill order, and the steer shortcut of the composer and queue scenes. `copied-browser.test.ts` checks the launcher tab kinds, the browser tab labels, the Shared badge, and the address placeholder. `copied-agent-browser.test.ts` checks the titles of the Browser cards and the Agent badge.

The views follow the product layout, labels, status colors, and controls. The tasks, the repository, the code, and the agent output are fictional. The model and provider names are also fictional, so the page claims no support for a specific model.

The product screenshots in `docs/assets/screenshots/` are research evidence only. The build does not publish them.

The components in `packages/product-scenes/src/replicas/` copy the product UI. Each folder in `packages/product-scenes/src/scenes/` puts them together for one view. The site keeps `src/ui/RuntimeIcon.astro` for the runtime logos outside a view. The controls in `packages/product-scenes/src/replicas/ui/`, such as the button and the switch, copy the components of `packages/frontend/src/components/ui/`. The fictional data is in `packages/product-scenes/src/sample/` and in the `sample.ts` file of each scene. The app tour reads the tasks, the workspaces, and the session titles from the same modules. These components do not import desktop state, host APIs, or runtime connections. The React views of the package render to static HTML at build time, and the page loads no React.

## Motion

The views play with GSAP. The code in `packages/product-scenes/src/motion/` has one job for each file:

| File | Job |
|---|---|
| `preference.ts` | The reduced motion query and the pause control of the header. It has no GSAP, so a page without views, such as the 404 page, does not load GSAP. |
| `player.ts` | The page players: a view builds its first frame when the page loads, plays while it is in its part of the screen, and pauses with the control. An `IntersectionObserver` reports the part of the screen. |
| `playback.ts` | The playback core of every player: the fade from the last frame, and the check of the length of a scene. |
| `loop.ts`, `chapters.ts`, `once.ts` | The three ways to play: a loop, the workflow steps one after the other, and one play of the browser version terminal. `mountLoop` in `player.ts` plays a loop on the page. |
| `scene.ts` | The tools of a scene builder: the fresh stage, the paused timeline, the templates of the view, and the end of the scene. |
| `effects.ts`, `text.ts` | Shared tweens, such as a pop or a height change, and text steps, such as typed input and streamed model output. |
| `frame.ts` | The cover that holds the last frame during a fade, with the scroll offsets of the frame. |
| `dom.ts`, `tabs.ts`, `tokens.ts` | Typed queries that fail loudly, the keyboard pattern of the step tabs, and the named eases of the views. The site scripts, such as the header and the brand links, use their own typed queries in `src/ui/dom.ts`. |
| `offset.ts` | The position of an element in a replica, with the translation that GSAP gives it. |
| `mount.ts` | The mount with a handle: play, pause, seek, duration, and stop, for a host that controls a scene, such as the app tour or a frame renderer. It watches no part of the screen, so the host decides when the scene plays. |

The product parts that move have a controller next to their component, for example `packages/product-scenes/src/replicas/board/cards.ts` for the Kanban board and `packages/product-scenes/src/replicas/studio/studio.ts` for the session page. The `timeline.ts` file of each scene builds the timeline of that view from these parts. The workflow steps have one file each in `packages/product-scenes/src/scenes/workflow/`, and they share `session.ts`. The browser version terminal is site UI: `src/ui/web-runner.ts` plays it.

Each loop restores the static markup and builds a new timeline. DOM changes from one loop cannot stay in the next loop. A copy of the last frame of a loop covers the view and fades out to the background in 0.3 s. Then the first frame of the next loop fades in, also in 0.3 s, so two frames never show on top of each other. The next loop starts when the first frame shows in full.

The session page takes one frame record, and `packages/product-scenes/src/sample/studio.ts` holds the last frame of each workflow step. The markup of a step renders its last frame, and the next step applies the same record at its start, so each step starts where the step before it ends. The transcripts are data in `packages/product-scenes/src/sample/transcripts.ts`, with typed row ids for the scenes.

The scenes follow the GSAP practices of the official GSAP skills:

- `gsap.ts` is the one place that loads GSAP. One `gsap.matchMedia()` context starts the views only when motion is allowed, and its cleanups kill each timeline and tween, stop each observer, and put back the markup.
- A step that measures the layout when it plays makes its tween then. `scene.run()` adds that tween to the scene timeline, so the pause control and the next loop also stop it. Such a tween must end before the end of its scene: the player reports an error when a scene grows while it plays.
- A step with several parts uses one nested timeline with position values, not `delay`.
- The scenes animate transforms and opacity. A step animates a width, a height, or a margin only where the product view reflows, for example when a lane opens.
- The CSS sets no `will-change`. GSAP promotes an element only while a transform tween runs.
- An `IntersectionObserver` tells each view when it enters or leaves its play zone. The browser checks the zone against the current layout, so a view starts and stops at the correct place after the page above it changes height, for example when a workflow step with a longer text takes one more line on a narrow screen.

The header has one control that pauses and resumes all scenes. It shows only when motion is allowed. With this control, visitors can stop the moving content, as WCAG 2.2.2 requires.

When the system asks for reduced motion, no scene plays and the control is hidden. Each view shows its last frame.

Without JavaScript, each view shows its last frame. The workflow steps show one after the other, each with its heading and text.

The desktop terminals show only their command, so a visitor can copy it at once. The browser version terminal keeps its final size while it types, so the page does not move. The pause control shows its last frame at once, because the command is the content. The terminal cursor blinks only while motion plays.

The opening text does not move. The headline and the install actions are visible on first paint. The opening product view is flat on first paint, and scroll does not tilt it.

The duck mark hops once on the water when the page opens, and it bobs when the visitor points at or focuses a brand link. A light scans its visor now and then. CSS plays these animations, and `src/ui/brand.ts` only starts them. The duck stays in view the whole time. Reduced motion keeps it still. A hop or a bob that starts plays to its end, and the pause control stops the light and the next bobs.

## Theme and typography

`packages/product-scenes/scripts/build-theme.ts` writes the light and dark token blocks of `packages/theme/src/tokens.css` to `packages/product-scenes/styles/theme.css`, scoped to the root of each copied UI. A test fails when the file does not match its source, and a missing or changed block stops the script with an actionable error. The output includes no desktop selectors, Tailwind runtime, or JavaScript.

The website styles use their own page tokens. The product views use the semantic tokens of the product, which apply only inside the root of each copied UI.

`packages/product-scenes/src/replicas/studio/highlight.ts` colors the sample TypeScript at build time. It covers only the sample code and adds no client script.

The default is light for all system settings. The header switch changes the page and all product views. A reload restores light.

| Asset                 | Source and license                                                                                  | Publication                                                                                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Space Grotesk         | `@fontsource-variable/space-grotesk`, SIL Open Font License 1.1                                     | Self-hosted WOFF2 with a Latin preload and `/space-grotesk-license.txt`.                                                                                                                                                  |
| IBM Plex Mono         | `@fontsource/ibm-plex-mono`, SIL Open Font License 1.1                                              | Self-hosted Latin WOFF2 at weights 400 and 500, as in the desktop app. The page preloads weight 400 and publishes `/ibm-plex-mono-license.txt`.                                                                           |
| GSAP                  | `gsap` 3.15, GreenSock standard no-charge license                                                   | Bundled in the page scripts. The license forbids the removal of its notices, so the build keeps them.                                                                                                                     |
| Duck mark and favicon | Website-owned `artwork/favicon.svg`, and `src/ui/Brand.astro` with the geometry of `src/ui/duck.ts` | A rubber duck with a night vision visor, on the violet tile of the app icon. The header, the footer, the favicon, and the sharing image use it.                                                                           |
| Product brand mark    | `packages/frontend/src/assets/openducktor-mark.svg`, repository Apache 2.0 license                  | The product views copy the app sidebar, so they show the mark of the app. `packages/product-scenes/src/replicas/shell/openducktor-mark.svg` is an unmodified copy, and a test of the package compares it with the source. |
| GitHub mark           | [GitHub Brand Toolkit](https://brand.github.com/)                                                   | Inline mark on the header and opening links to the project repository. It identifies the link destination.                                                                                                                |
| Runtime brand marks   | `packages/frontend/src/components/features/agents/agent-runtime-icon.tsx`                           | Static SVG geometry and brand colors in `packages/product-scenes/src/replicas/ui/RuntimeIcon.tsx` and `src/ui/RuntimeIcon.astro`. They identify the coding runtimes.                                                      |
| Icons                 | `@lucide/astro` and `lucide-react` at the same version, ISC and inherited Feather MIT notices       | Static inline SVG and `/lucide-license.txt`.                                                                                                                                                                              |
| Sharing image         | Website-owned `artwork/open-graph.svg`                                                              | Generated 1200 by 630 PNG with factual copy and the light palette.                                                                                                                                                        |

Asset preparation recreates the ignored `public/` directory, so removed designs cannot stay in the output. The CI path filters include the product scenes and the shared product theme, because they change the build.

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

| Reference                        | Observed treatment                                                                                                       | Application                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [bb](https://getbb.app/)         | A compact header, centered opening, direct install actions, and a large product view with readable conversation content. | Give the product view enough width. Put the install action near the opening.                                           |
| [T3 Code](https://t3.codes/)     | Large centered type, a wide workspace, and small code-based explanations below it.                                       | Use a clear opening and a substantial UI example. Do not copy floating agent logos, grid decoration, or social claims. |
| [Emdash](https://emdash.com/)    | Fine rules, restrained colors, distinct section labels, and focused UI examples for individual capabilities.             | Separate content with rules and use native UI to explain task context.                                                 |
| [21st.dev](https://21st.dev/)    | Earlier study: large typography, a dense preview collection, and a clear distinction between links and controls.         | Keep interactions explicit. Do not import a template.                                                                  |
| [Orca](https://www.onorca.dev/)  | Earlier study: a centered introduction and selectable product views.                                                     | Keep the product near the opening and allow visitors to choose a view.                                                 |
| [Superset](https://superset.sh/) | Earlier study: strong download actions and selectable product views; animated text could disappear during entry.         | Keep essential text visible on first paint. Use no autoplay or entrance sequence for the headline.                     |

Research screenshots remain local evidence and are not published assets.
