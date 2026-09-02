# MCP runtime security

This document defines the allowed transport and threat model for `@openducktor/mcp` version 1.

## Allowed transport

Use MCP `stdio` only. `packages/openducktor-mcp/src/index.ts` uses `StdioServerTransport`.

Do not expose `streamable-http`, SSE, WebSocket, Lambda, or a reverse-proxied HTTP endpoint.

## Threat model

- A trusted local OpenDucktor runtime starts the MCP server as a child process.
- The transport is process-local stdio and cannot accept an Internet connection.
- External network headers such as `x-forwarded-for` do not take part in version 1 access decisions.

## Supply chain

- The root `package.json` override must resolve `hono` to `>=4.12.7`.
- CI applies the Hono policy through the single-request `bun run deps:audit` step in `bun run deps:check`. It rejects GHSA-`xh87-mx6m-69f3` or GHSA-`v8w9-8mx6-g223`.

## Add a network transport

Before you add a network transport:

1. Review authentication, authorization, and proxy trust.
2. Review advisories for every transport dependency and code path.
3. Add integration tests that prove spoofed client IP headers cannot bypass authentication.
4. Update this file and [dependency hygiene](dependency-hygiene.md) in the same change.
