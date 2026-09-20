---
status: accepted
date: 2026-09-20
---

# Build the public website with Astro and Cloudflare Workers Static Assets

## Context

OpenDucktor needs a public marketing website. The website will contain static pages and does not need server-side rendering, API routes, or a long-running server.

The website belongs to the same product and contributor workflow as the desktop app. The root Bun workspace already includes every directory under `apps/*`.

## Decision

Add the website as a private Astro workspace at `apps/marketing-website` in this repository.

Use Astro's static output. The build must produce portable files in `dist/` and must not require a server runtime.

Deploy `dist/` with Cloudflare Workers Static Assets. Do not add a Worker script, server-side rendering, Pages Functions, or another dynamic request path. A later need for server code must revisit this decision.

Use Cloudflare Workers instead of Cloudflare Pages because Cloudflare directs new projects to Workers. Static asset requests are free and unlimited under the current pricing policy, and Cloudflare does not charge extra to store those assets.

## Options we rejected

- Vanilla JavaScript without a site framework. It would require local conventions for page templates, reusable components, content, asset handling, and builds that Astro already provides.
- Next.js with static export. The website does not need React as its page model or the server features that drive most of the framework's value.
- A separate repository. The website has no separate owner, access boundary, or release process that would offset the extra repository setup and cross-repository coordination.
- Cloudflare Pages. It can host the site, but Cloudflare now names Workers as its main platform and tells new projects to start there.

## Consequences

The marketing website uses the repository's Bun toolchain and takes part in root workspace checks. Its deployment workflow can use path filters so unrelated desktop changes do not deploy it.

The generated site remains portable because the production artifact contains static files. Moving to another static host does not require a framework rewrite.

Dynamic behavior must run in the browser or use an external service. Adding Cloudflare compute or storage changes the operating model and may add usage charges.

## References

- [Astro output configuration](https://docs.astro.build/en/reference/configuration-reference/#output)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
- [Cloudflare Static Assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Cloudflare guidance for new projects](https://developers.cloudflare.com/pages/get-started/)
