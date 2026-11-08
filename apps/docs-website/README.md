# OpenDucktor docs website

This private Bun workspace builds the public user documentation at `https://doc.openducktor.dev`. It uses Next.js App Router, Fumadocs, and Fumadocs MDX with a static export. Cloudflare Static Assets serves the export. After deployment, no Next.js server, Worker script, request handler, API route, or storage binding runs.

The pages are for people who use OpenDucktor. Engineering rules stay in the repository `docs/` folder. When a page needs developer details, link to the repository file and label it as developer guidance.

## Local development

Run these commands from the repository root after `bun install`:

```sh
bun run docs:dev
bun run --filter @openducktor/docs-website build
bun run --filter @openducktor/docs-website worker:dev
```

`docs:dev` starts the development server. `worker:dev` serves the `out/` export in the local Workers runtime, as Cloudflare serves it. Check client navigation, search, and the demonstrations in the export too, because the development server does not serve the static export.

Before `dev` and `build`, the asset step `scripts/prepare-assets.ts` writes the ignored `public/` folder: the favicon from `packages/frontend/src/assets/`, the licenses of the Fontsource and Lucide packages, and the scene stylesheets of [Product demonstrations](#product-demonstrations). Run the asset step again after a change to the styles of a scene. The asset step owns `public/`, so keep hand-written files in other folders.

## Write a page

Each page is one MDX file in `content/`. The file name sets the URL: `content/mobile.mdx` publishes `/mobile/`, and `content/index.mdx` publishes the Overview at `/`. `content/meta.json` sets the navigation groups and the reading order, so add each new page there.

A subpage goes in a folder that has the name of its parent page. `content/coding-sessions/index.mdx` publishes `/coding-sessions/`, and `content/coding-sessions/terminals.mdx` publishes `/coding-sessions/terminals/`. The `meta.json` of the folder lists the subpages in order, without `index`.

The frontmatter has a `title`, a one-sentence `description`, and an `icon`. The build stops when a page has no description. The `icon` names a Lucide icon, such as `Smartphone`, or a brand logo: `GitHub`, `GitLab`, or `AzureDevOps`. `iconByName` in `lib/icons.ts` resolves the name, and an unknown name stops the build. The layout shows the title as the page heading and the icon in the navigation. The description goes only to the page metadata, the search results, the link previews, and `llms.txt`, so the first paragraph of the page is its introduction. `full: true` gives a page the full content width.

Write for a developer who learns OpenDucktor:

- Start with one or two sentences that say what the feature does for the reader.
- Give each main task a goal heading, two to five numbered steps in `<Steps>`, and the visible result.
- Put a screenshot, a demonstration, or a diagram beside each main procedure.
- Keep each paragraph to one to three sentences.
- Put option details in the Settings reference and edge cases in Troubleshooting, and link to them from the guide.
- Write in ASD-STE100 Simplified Technical English, as the documentation rules in `AGENTS.md` require.
- Call OpenCode, Codex, and Claude Code "harnesses".
- Use bold only for an exact UI label that the reader must find, such as **Start Spec**.
- Link other pages with root-relative URLs and a trailing slash, for example `/settings-reference/#notifications`.
- Give a heading a stable ID when other pages link to it: `## Notifications [#notifications]`. Keep the ID when you change the heading text.
- Use the components `<Steps>`, `<Tabs>`, `<Callout>`, `<Accordions>`, `<Cards>`, and `<Card>`. `components/mdx.tsx` gives the Fumadocs components, and its own `<Steps>`, which shows a small number badge on each step. `<Callout type="warn">` is for actions that delete work or weaken security. The `icon` of a `<Card>` is a name, as in the frontmatter.
- Use the site components of the table below, and the media components of [Screenshots](#screenshots).
- Put a message that the reader sends to an agent in `` <AgentMessage>{`...`}</AgentMessage> ``, not in a code block. Its lines wrap at the page width, and it has a copy button.

| Component | Result |
|---|---|
| `` <AgentMessage>{`...`}</AgentMessage> `` | A message that the reader sends to an agent, with a copy button. |
| `<Action>Start Builder</Action>` | A button label of the app, as a small key. |
| `<Status of="backlog" />` | A board lane, with the label and the color of `lib/lanes.ts`. |
| `<IconList>` and `<IconItem icon="..." title="...">` | The icon buttons of a screen, each with its Lucide icon and what it does. |
| `<ProductDemo id="..." />` | An animated product scene. See [Product demonstrations](#product-demonstrations). |
| `<Diagram name="workflow" />` | A diagram of `DIAGRAMS` in `components/diagrams/catalog.ts`. An unknown name stops the build. See [Diagrams](#diagrams). |

`publishedPages` in `lib/pages.ts` lists the published pages from the `meta.json` files with the Fumadocs loader, nested folders included. It stops when a `meta.json` entry names no file. After `next build`, `scripts/finish-export.ts` checks the export with this list. The build fails when a published page, its link preview image, `llms.txt`, or `llms-full.txt` is missing, when a link opens no published page, or when a link opens a section that does not exist. The error lists each problem. The browser tests use the same list.

## Screenshots

The pages show the real app with a fictional sample project, `fieldnotes`, a note-taking app.

| Component | Result |
|---|---|
| `<Screenshot id="..." alt="..." />` | Shows the capture that matches the appearance of the page. A click opens it at full size. A capture more than 2 times taller than wide is a phone screen and shows at phone width. A capture that is taller than wide, such as a dialog, shows narrower than the article. A capture of at most 1000 pixels wide, such as a toast, shows at its own size. No capture shows larger than half its pixel width, because captures are at 2x. |
| `<Screenshot id="..." alt="...">text</Screenshot>` | Shows the text beside a phone screen on a wide page, and under the screenshot on a narrow page. The text of another capture shows under it. |
| `<AnnotatedScreenshot id="..." alt="..." parts={[{ at: "...", title: "...", text: "..." }]} />` | Shows a numbered box around each part, and the list of the parts. The list shows beside a phone screen on a wide page. `at` is the key of the box in `SCREENS[id].parts`. A click opens the capture at full size without the boxes, so its small text is easy to read. The list gives the same information as text. |
| `<ScreenRow>` | Puts phone screenshots side by side. |

Each screenshot has two files in `assets/screens/`: `<id>-light.webp` and `<id>-dark.webp`. `assets/media.ts` registers each id, so a page can use only an id that exists.

To take a new desktop capture:

1. Start the browser app on a separate demo configuration, so that no real workspace shows: `OPENDUCKTOR_CONFIG_DIR=<demo folder>/config bun run browser:dev`.
2. Open the sample repository as the only workspace.
3. Set a 1440 by 900 viewport at 2x scale.
4. Replace personal paths, names, and addresses on the page.
5. Capture the screen in light and dark, and save each as WebP at 2160 pixels wide. Load the page again after you change the appearance, because a theme change does not repaint every component at once.
6. Add the id to `assets/media.ts`.
7. When the screen has an `<AnnotatedScreenshot>`, measure each box again on the new capture, in percent of its width and height. Update `SCREENS[id].parts`, then run `bun run test`. `tests/media.test.ts` fails when a box goes past the capture edge, when a page names a part without a box, or when a box has no page.

The setup wizard shows only when the host has no workspace. To capture it without a new configuration, make the browser answer `workspace_catalog_get` with empty workspace lists. Open the wizard on a copy of the sample repository, and stop before **Open repository**, so that the host saves nothing.

The update prompt shows only in a packaged desktop app. To capture it, render `AppUpdatePrompt` of `packages/frontend` in a page with a test shell bridge that returns the update state, and the CSS of the built web shell.

For a phone capture, install a current release build on an Android emulator, and pair it with the demo host through Remote control. Set the demo mode of the status bar, and save WebP at 720 pixels wide in light and dark.

## Product demonstrations

`<ProductDemo id="..." />` places an animated scene of `@openducktor/product-scenes`, which the website and the app tour also use. The id is the name of the scene, such as `workflow`. `CAPTIONS` in `components/demo/product-demo.tsx` gives the caption of each scene, and `sceneProps` gives the options of the scenes that need them. Read [the scene conventions](../../packages/product-scenes/CONVENTIONS.md) before you add a demonstration.

`components/demo/product-demo.tsx` renders `PageScene` from `@openducktor/product-scenes/react/page`. The static export renders the still frame of each scene. In the browser, `PageScene` plays the scene as the website does:

- A scene loads GSAP and its timeline when it is one screen height or less from the screen.
- A loop scene plays while it shows on the screen, and pauses when it goes off screen.
- The workflow scene is a chapter player. Its tabs select one step, and the steps play one after the other. `demo.css` styles the tabs.
- With reduced motion, a scene keeps its still frame, and the tabs still select a step.
- The header button of `components/motion-control.tsx` pauses and plays every scene.
- Leaving the page stops each scene and removes its listeners.
- When the timeline of a scene does not load, the scene keeps its still frame and shows the `failure` line of `product-demo.tsx` under it: "The animation did not load. Reload the page to try again." The player writes the error to the console. The next visit to the page loads the scene again.

The scenes follow the host contract of the package:

- A page loads only the styles of its scenes. The asset step gets the stylesheet files of the base styles and of each scene from `pageStyles()` of `@openducktor/product-scenes/page-styles`. It bundles each list with Lightning CSS into one file of `public/scene-styles/`, with a hash of the content in the name. It scopes the rules of each scene stylesheet to the view of the scene, because two scene stylesheets on one page can hold the same part stylesheet. `lib/scene-styles.ts` gives the address of each file to `PageScene`, which links the base and the scene stylesheet. React puts the links after the stylesheets of the page, so the scene layers come after the base layers of the page. A page without a demonstration loads no scene style.
- `next.config.ts` makes Turbopack ignore the stylesheet imports of the scene modules, so the page links no stylesheet for each part of a scene.
- `app/layout.tsx` loads Space Grotesk and IBM Plex Mono at weights 400 and 500 with `next/font/local`, from the same Fontsource files. It preloads Space Grotesk and IBM Plex Mono 400.
- The scenes follow `data-theme` on the page root, which `components/appearance.tsx` sets.
- The scenes show the macOS keys, as the website does.

The GSAP license requires its notices in the published code, and the Next.js minifier removes all comments. `scripts/finish-export.ts` therefore puts the GSAP notices back at the start of each chunk that contains GSAP.

## Diagrams

React Flow draws the diagrams in the colors of the site. Each diagram has a wide layout and a phone layout, and a container query shows the one that fits the article. The canvas does not pan or zoom, and pointing to a node lights its lines.

| File | Owns |
|---|---|
| `components/diagrams/spec.ts` | The types of a diagram spec, and of the nodes and edges of its layouts. |
| `components/diagrams/define.ts` | `defineDiagram`, which turns a spec into the nodes and edges of both layouts and stops on a spec that React Flow would draw wrong. |
| `components/diagrams/chain.ts` | `chainDiagram`, which places items in a row or a column with an arrow from each item to the next. |
| `components/diagrams/specs/*.ts` | One file for each diagram topic, such as `workflow.ts` or `git.ts`. |
| `components/diagrams/catalog.ts` | `DIAGRAMS`, the loader of each diagram by name. A page loads only the spec files of its diagrams. `tests/diagrams.test.ts` loads every diagram. |
| `components/diagrams/lazy.tsx`, `components/diagrams/view.tsx` | `<Diagram>` loads React Flow and the spec of its diagram on demand. The server renders each diagram. |
| `components/diagrams/flow-diagram.tsx`, `components/diagrams/nodes.tsx` | `FlowDiagram`, which draws both layouts, and the node types. |
| `components/diagrams/flow.css`, `components/diagrams/nodes.css` | The styles of the diagrams. |
| `lib/lanes.ts` | The label and the color tone of each board lane, for `<Status>` and the diagrams. `components/inline.css` sets the color of each tone. |

To add a diagram, add its spec to a file of `specs/`, and its loader to `DIAGRAMS`. Use `chainDiagram` for a simple row or column of items. Give a diagram with branches or loops its own layout with `defineDiagram`, as `workflow` and `host` do.

## Navigation, search, and appearance

Fumadocs renders the navigation, the section list, and the previous and next links with Next.js links, so a page change keeps the same document. A link loads its page when the reader points at it, focuses it, or touches it, not when it shows: `IntentLink` in `components/intent-link.tsx` replaces the link of Fumadocs. When each visible link loaded its page, the first visit of the Overview loaded 41 page files, about 2 MB, 318 KB compressed. After a new page opens, the page title gets focus. A link or a search result to a section of the same page moves focus to that section. `openSection` in `lib/focus.ts` owns this rule. When the section is a closed accordion item, `Accordions` in `components/accordions.tsx` opens the item and scrolls to it. It also opens the item of the address when the page opens. The browser sends `hashchange` for a plain `#section` link, and `RouteFocus` calls `openSection`. The client router changes the address with `history.pushState` and sends no event, so the search dialog calls `openSection` itself. Back and Forward keep the scroll position that the router restores.

The build writes the search index to `out/search-index.json`. The search dialog loads it when it opens and searches in the browser. When the index does not load, the dialog keeps the query and shows a retry button. Each search result shows text only, because remark-structure keeps the text of each MDX element without its tag. The index keeps no sort data, because the dialog orders the results by relevance.

The header shows the product website, the `githubUrl` link of Fumadocs, and the Install button, in `lib/layout.tsx`. On a narrow page, the menu shows the product website and Install at the top, and GitHub at the bottom. `NavGroup` in `components/nav-group.tsx` draws the group labels of the navigation.

The page root gets `data-hydrated` when the page responds to input. A tap on search before that moment opens search when the page hydrates, so a tap on a slow phone is not lost. The browser tests wait for `data-hydrated`.

## Link previews and llms.txt

Each page has its link preview image, `/og/<page>/image.png`, which `app/og/[...slug]/route.tsx` draws at build time in the colors of the website sharing image. The Overview has `/og/image.png`. `config/site.ts` holds the Open Graph fields of every page, because Next.js replaces the whole `openGraph` object of the layout with the object of a page.

The build also writes `llms.txt`, the list of pages, and `llms-full.txt`, the Markdown of all pages, as the [Fumadocs llms guide](https://fumadocs.dev/docs/next/integrations/llms) shows.

The appearance starts with the system setting. The appearance button in the header changes it for the visit. The site stores no preference, cookie, or search history.

`app/global.css` maps the Fumadocs colors to the page colors of `@openducktor/theme/site-palette.css`, which the marketing website also uses. The header shows the OpenDucktor mark of the app, from `packages/frontend/src/assets/openducktor-mark.svg`.

## Build modes

Set `DOCS_BUILD_TARGET` to `local`, `preview`, or `production`. The default is `local`.

| Target | Output policy |
|---|---|
| `local`, `preview` | The HTML, the response headers, and `robots.txt` block indexing. |
| `production` | Search engines can index the pages. `robots.txt` names the sitemap. |

Canonical URLs and the sitemap always use `https://doc.openducktor.dev`. `@openducktor/build-tools/static-site` writes the `_headers` and `robots.txt` files of this site and of the marketing website. The Content-Security-Policy lets a page load files only from its own origin, and the browser tests fail when a page breaks it. The `_headers` file lets browsers keep the files of `_next/static/` and `scene-styles/` for a year, because their names contain a hash of their content. The pages, the router payloads, and the search index keep the Cloudflare default, which checks them again at each visit.

## Cloudflare commands

The site deploys to two assets-only Cloudflare Workers: `openducktor-docs` for production and `openducktor-docs-preview` for pull requests. Both use `404-page` handling, so an unknown path gets `404.html` with HTTP 404. `tests/wrangler-config.test.ts` keeps each configuration to these fields.

Run these commands from `apps/docs-website`:

| Step | Command | Who runs it |
|---|---|---|
| Build a preview | `DOCS_BUILD_TARGET=preview bun run build` | The workflow for a PR, or you |
| Build production | `DOCS_BUILD_TARGET=production bun run build` | The workflow for `main` |
| Serve the build in the local Workers runtime | `bun run worker:dev` | You |
| Check the upload of both Workers without credentials | `bun run worker:check` | The workflow, or you |
| Check the export in Chromium | `bun run test:browser` | The workflow, or you |
| Publish a PR preview | `wrangler versions upload --preview-alias pr-<number> --config wrangler.preview.json` | The workflow for a PR |
| Publish production | `wrangler deploy --config wrangler.json` | The workflow for `main` |

## Cloudflare setup before first publication

1. Create the two Workers, `openducktor-docs` and `openducktor-docs-preview`, in the Cloudflare account of the `openducktor.dev` zone.
2. Attach the custom domain `doc.openducktor.dev` to `openducktor-docs`.
3. Create one account API token for each Worker, scoped to that Worker only, with the Workers `Editor` role.
4. Create the GitHub environments `docs-preview` and `docs-production`. Give each one a `CLOUDFLARE_ACCOUNT_ID` variable and a `CLOUDFLARE_API_TOKEN` secret with the token of its Worker.
5. Let `docs-production` deploy from `main` only.

## Pull requests and production updates

The `Docs website` workflow starts for pull requests, for pushes to `main`, and by hand. Its `changes` job compares the complete Git diff with the site inputs, and it skips the other jobs when no input changed.

| Job | Secrets | Work |
|---|---|---|
| `build` | None | Builds the export for its target, runs the Wrangler dry run and the Chromium tests, and uploads `out/`. |
| `deploy` | The Cloudflare token of one environment | Downloads `out/` and runs Wrangler. |

A failed build uploads nothing, so the deployed site stays as it was.

General CI checks the formatting, lint, types, and unit tests of this workspace on Linux, macOS, and Windows. Its build command skips this workspace, because the docs workflow builds it when its inputs change. Root commands still build every workspace locally.

Next.js checks types during `next build` with the workspace-local TypeScript 6, because it needs the TypeScript JavaScript API. The required `typecheck` script uses `bun check`. See [Type checking](../../docs/typechecking.md#nextjs-build-check).
