# MCP runtime security

This document defines the allowed transport and threat model for `@openducktor/mcp` version 1.

## Allowed transport

Use MCP `stdio` only. `packages/openducktor-mcp/src/index.ts` uses `StdioServerTransport`.

Do not expose `streamable-http`, SSE, WebSocket, Lambda, or a reverse-proxied HTTP endpoint.

## Threat model

- A trusted local OpenDucktor runtime starts the MCP server as a child process.
- The transport is process-local stdio and cannot accept an Internet connection.
- External network headers such as `x-forwarded-for` do not take part in version 1 access decisions.

## Browser tool callers

Managed sessions get the `odt_browser_*` tools. The MCP process sends the runtime session ID of each browser call to the host bridge. [External MCP](external-mcp.md#browser-tools) lists the source of this ID for each runtime.

- The bridge trusts this ID as it trusts `workspaceId`, because only a process with the bridge token can call the bridge.
- The host resolves the ID only to a task or an active Workspace Session of the same workspace and runtime kind.
- Agent tools open no network endpoint and give no CDP access.

## Electron DevTools endpoint

The Electron app connects the bundled DevTools frontend of each browser tab through a WebSocket endpoint. It is the only network endpoint of the browser feature in Electron.

- It listens only on `127.0.0.1`, on an ephemeral port.
- Its path requires a random secret that Electron main creates at each start. No agent, MCP process, or bridge client receives the secret. Only the DevTools frontend URL of a browser tab holds it.
- It accepts a connection only with the origin `devtools://devtools` and only for a live browser tab.
- Each connection is a `devtools` client of the CDP proxy. It reaches only its linked tab and the child targets of that tab. It cannot reach other targets, change the whole browser, or pass certificate errors.
- No engine opens a Chromium remote debugging port, so no other CDP endpoint exists on the machine.

## Web runner preview proxy

A web runner app on the host machine shows user tabs in iframes. Each dev server origin gets one preview proxy, which serves its pages on another port.

- It listens only on `127.0.0.1`, or on `::1` for an app at `[::1]`, on an ephemeral port. A remote client cannot reach it.
- `POST /browser/frame-source` starts it. That route needs the app token header and an `Origin` of `http://localhost`, `http://127.0.0.1`, or `http://[::1]`.
- It forwards only to the one dev server origin that it serves. A dev server origin is `localhost`, a `.localhost` name, an address in `127.0.0.0/8`, or `[::1]`.
- It accepts only `localhost`, `127.0.0.1`, or `[::1]` with its port in the `Host` header. This check stops DNS rebinding, which the `Host` checks of a dev server do not stop.
- It removes `X-Frame-Options` and sets `frame-ancestors` to the app origins, so only the app can frame the pages. Other directives of the page stay.
- It removes the web runner session cookie from each request, so the dev server never gets it. That cookie is `HttpOnly`, so page scripts cannot read it.
- Its pages run on its own origin, so they cannot reach the app origin or the host API.
- It gives a page no access that the page did not have on its own port.

The same route also checks the frame rules of a site outside the host.

- The host sends one `GET` request to the address that the user typed or that a page linked to, and follows its redirects. It reads only the response headers and returns `direct` or `refused`, never the page.
- The request has no cookies and no credentials of the user.
- The iframe of each tab has a sandbox without `allow-top-navigation`, so a framed page cannot navigate the app. A framed page has its own origin, so it cannot reach the app origin or the host API.

## Supply chain

- The root `package.json` override must resolve `hono` to `>=4.12.7`.
- CI applies the Hono policy through the single-request `bun run deps:audit` step in `bun run deps:check`. It rejects GHSA-`xh87-mx6m-69f3` or GHSA-`v8w9-8mx6-g223`.

## Add a network transport

Before you add a network transport:

1. Review authentication, authorization, and proxy trust.
2. Review advisories for every transport dependency and code path.
3. Add integration tests that prove spoofed client IP headers cannot bypass authentication.
4. Update this file and [dependency hygiene](dependency-hygiene.md) in the same change.
