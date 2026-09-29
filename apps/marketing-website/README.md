# OpenDucktor marketing website

## Local development

This private Bun workspace builds a static Astro site. It has no server adapter, Worker script, API routes, storage bindings, React hydration, or connection to the local OpenDucktor host. See [ADR 0009](../../docs/adr/0009-build-the-public-website-with-astro-and-cloudflare-workers-static-assets.md).

Run these commands from the repository root after `bun install`:

```sh
bun run marketing:dev
bun run --filter @openducktor/marketing-website build
bun run --filter @openducktor/marketing-website preview
```

Astro prints the local address. The output is `apps/marketing-website/dist/`. The build recreates the ignored `public/` directory from the sources in [the asset record](ASSETS.md). It generates the sharing image and copies the favicon and the font and icon licenses. Do not put hand-edited files in `public/`. The current Astro CLI can leave its preview process running; use `bunx astro preview stop` from this workspace when finished.

Root `build`, `typecheck`, and `test` discover this workspace. Root formatting runs Oxfmt and the website's Prettier Astro plugin. Oxlint checks the website's TypeScript; `astro check` checks the templates. TypeScript 6 stays local to this workspace because the Astro checker does not support the repository's TypeScript 7 compiler.

## Build modes

| Target | Origin | Output policy |
|---|---|---|
| `local`, the default | Optional | No indexing; no sitemap; omit absolute URL metadata without an origin. |
| `preview` | Optional production origin | No indexing in HTML, response headers, or robots; no sitemap. Never use the preview URL as the origin. |
| `production` | Required real HTTPS production origin | Canonical and sharing URLs, sitemap, and robots use this origin. |

The header shows the latest public stable release. The build and the dev server read it once from the GitHub API, so they need the network. Set `GITHUB_TOKEN` when the unauthenticated rate limit stops a build; CI passes the workflow token. After a stable release becomes public, `Marketing website release` builds `main` again.

Set `MARKETING_BUILD_TARGET` and `MARKETING_SITE_ORIGIN` in the environment. Production rejects an absent origin, non-HTTPS URLs, credentials, ports, non-root paths, queries, fragments, IP addresses, local domains, reserved example domains, and known preview domains. No production domain is selected in the repository. The test-only origin in unit tests is not a deployment default.

## Cloudflare commands

The site deploys to two assets-only Cloudflare Workers: `openducktor-marketing` for production and `openducktor-marketing-preview` for pull requests. Neither Worker has a script, `run_worker_first`, or a binding, so Cloudflare serves every request from the static assets. Cloudflare bills only requests that run a Worker script. Static asset requests are free and unlimited. `tests/wrangler-config.test.ts` keeps each configuration to these fields. The build stays far below the static assets limits of 20,000 files for each version and 25 MiB for each file. The generated `_headers` file lets browsers keep the files of `_astro/` for a year, because Astro puts a hash of the content in each file name, so a changed file gets a new name at the next deployment. The pages and the files at the root keep the Cloudflare default, which checks them again at each visit. See [Cloudflare Static Assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

Run these commands from `apps/marketing-website`:

| Step | Command | Who runs it |
|---|---|---|
| Build a preview | `MARKETING_BUILD_TARGET=preview bun run build` | The workflow for a PR, or you |
| Build production | `MARKETING_BUILD_TARGET=production MARKETING_SITE_ORIGIN=<origin> bun run build` | The workflow for `main` |
| Serve the build in the local Workers runtime | `bun run worker:dev` | You |
| Check the upload of both Workers without credentials | `bun run worker:check` | The workflow, or you |
| Apply the address settings of the preview Worker | `wrangler triggers deploy --config wrangler.preview.json` | The workflow for a PR |
| Publish a PR preview | `wrangler versions upload --preview-alias pr-<number> --config wrangler.preview.json` | The workflow for a PR |
| Publish production | `wrangler deploy --config wrangler.json` | The workflow for `main` |

## Cloudflare setup before first publication

1. Add the zone of the production origin to the Cloudflare account. Set the GitHub repository variable `MARKETING_SITE_ORIGIN` to that HTTPS origin. Do not use an environment variable, because the `build` job has no environment.
2. Create the two Workers, `openducktor-marketing` and `openducktor-marketing-preview`, in the Cloudflare dashboard. Each publication applies the workers.dev and preview URL settings of its Wrangler configuration.
3. Attach the custom domain to `openducktor-marketing`.
4. Create one account API token for each Worker, scoped to that Worker only, with the Workers `Editor` role. See [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/).
5. Create the GitHub environments `marketing-preview` and `marketing-production`. Each one needs a `CLOUDFLARE_ACCOUNT_ID` variable and a `CLOUDFLARE_API_TOKEN` secret with the token of its Worker. Let `marketing-production` deploy from `main` and from the `v*` release tags only. `marketing-preview` deploys from pull request branches, so it cannot have a branch rule.

## Pull requests and production updates

The `Marketing website` workflow starts when a change touches the site, when a stable release becomes public, or by hand. Its `build` job has no secrets: it builds the site for its target, runs the Wrangler dry run and the Chromium tests, and uploads `dist/`. Its `deploy` job receives the Cloudflare token of one environment. It installs the locked dependencies without scripts, downloads `dist/`, and runs Wrangler. It runs no build step.

A pull request from this repository first applies the address settings of `wrangler.preview.json`, because a version upload does not apply them. Then it publishes the alias `pr-<number>` of the preview Worker. The pull request shows the alias URL as its `marketing-preview` deployment. The job fails when Cloudflare gives no preview URL. A pull request from a fork builds and runs the tests, but it gets no preview, because GitHub gives no secrets to its workflow. A push to `main` and a stable release publish production. A newer run for the same pull request or for `main` cancels the older one, so an older build does not replace a newer site.

A pull request can change this workflow and its Wrangler configuration, so a collaborator with write access could read the preview token. That token can change only the preview Worker, so production stays safe.

Preview URLs are public. Do not include private content in a PR build. Closing a PR does not revoke a published preview URL. See [Cloudflare preview URL limits](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/).

## Failure handling

| Failure | Maintainer action |
|---|---|
| Missing or invalid `MARKETING_SITE_ORIGIN` | Set the real HTTPS origin in the repository variables and run the workflow again. |
| Missing Cloudflare variable or token | Configure the GitHub environment and run the failed job again. |
| Wrangler refuses the token | Give the token the Workers `Editor` role on its Worker. |
| The site does not answer on its domain | Attach the domain to `openducktor-marketing` in Cloudflare. |
| Cloudflare gave no preview URL | Register a workers.dev subdomain for the Cloudflare account, then run the failed job again. |

## Verification

Run all five repository checks before completion:

```sh
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

`bun run lint` also runs Stylelint on the website stylesheets. The website tests also check that each source file has 400 lines or fewer, and that each custom property that a stylesheet reads has a definition.

For focused work, run the website's `test`, `typecheck`, and `lint:css` scripts. Browser review must cover light and dark appearances, 320-pixel width, keyboard navigation, disabled JavaScript, reduced motion, the pause control, successful and failed copy operations, each product view and scene, the visible theme switch, and unknown routes. Validate Cloudflare routing locally with `bun run worker:dev` after a preview build. Live deployment also requires the account, domain, token, and GitHub setup above; local checks cannot prove those are configured.

The website build workflow also runs Chromium regressions against the built files. To run them locally, use these commands from `apps/marketing-website`:

```sh
bunx playwright install chromium
bun run build
bun run test:browser
```

The browser suite owns a temporary preview server on port 4398 and fails if that port is occupied. It checks both themes at desktop and phone sizes, the tabs keyboard pattern, the copy buttons and a failed copy, the pause control, the install terminals, reduced motion, 200% text size, text contrast, FAQ disclosures, third-party requests, the GSAP license notices, and operation without JavaScript. It does not stop an existing development or preview server.

## Product views

The page shows the product with copies of its UI and fictional data. Read [the design and asset record](ASSETS.md) before you change a product claim, a view, or a scene.

The page sections are in `src/sections/`. Each animated view has a folder in `src/views/` with its markup and its scene script. The copied product UI is in `src/replica/`, the fictional data is in `src/sample/`, and the shared motion code is in `src/motion/`. The site UI, such as the brand mark and the command blocks, is in `src/ui/`.

The static markup of a view is the last frame of its scene. Visitors without JavaScript or with reduced motion see that frame. Change the markup and the scene together.

Each product view has `role="img"` and a text alternative. Keep `aria-hidden="true"` on the root of the copied UI. Update the text alternative when the scene changes.

The copied UI uses the product colors, so some of its text is below a contrast of 4.5:1, as in the product. The text alternative carries the meaning of the view. The page text outside the product views must reach 4.5:1, and the browser suite checks it.

`scripts/product-theme.ts` reads the desktop theme at build time. `src/replica/Replica.astro`, the root of each copied UI, imports it as the CSS module `virtual:openducktor/product-theme.css`. The product tokens apply only inside that root, so they do not change the page tokens. The page starts in light mode. Its header switch changes the page and the product views together without storing data.

## Styles

Each component imports its own stylesheet, which has the same name and folder as the component. A page loads only the styles of the components that it renders. `src/styles/` holds only the page tokens, the base element styles, and the state rules.

Each stylesheet puts its rules in one cascade layer. The layout declares the layer order in the first style element of the page, from `src/styles/layers.ts`. A later layer wins over an earlier layer, whatever the selector specificity:

1. `base`: the page tokens, the element defaults, and the page layout.
2. `site`: the components in `src/ui/` and the sections in `src/sections/`.
3. `product`: the product theme, the base of the copied UI in `src/replica/replica.css`, and the shared product controls in `src/replica/ui/`.
4. `replica`: the copied product components in `src/replica/`.
5. `views`: the views in `src/views/`, which size the copied UI for each scene.
6. `state`: `[hidden]` and the motion preference, which win over every other rule.

A shared product control, such as `src/replica/ui/Button.astro`, takes the variant and the size of the product component as props. It writes them as `data-variant` and `data-size`. A component that uses the control changes it with its own class, as the product does with `className`.

A class only styles an element. Scripts find elements by their `data-*` hooks, and they show a state with a `data-*` attribute, such as `data-active` or `data-activity="working"`. The markup sets the state of the static frame with the same attributes. In the markup, `src/replica/flag.ts` writes a boolean state, and a script sets it with `toggleAttribute`. A script never adds or removes a class.

Keep code snippets in frontmatter strings, so template formatting cannot change their whitespace.

Astro 7 renders templates with `compressHTML: "jsx"`. A line break between text and an inline element, such as `<code>`, then renders no space. End the text line with `{" "}` in that case. Prettier can make new line breaks of this kind, so `tests/astro-whitespace.test.ts` checks the templates.

The Astro configuration keeps the legal comments in the page scripts, because the GSAP license forbids the removal of its notices. Do not remove this setting.
