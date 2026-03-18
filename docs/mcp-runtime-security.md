# MCP Runtime Security Assumptions

This document defines allowed runtime transports and threat assumptions for `@openducktor/mcp`.

## Allowed Transports (V1)

- Allowed: MCP `stdio` transport only.
- Not allowed: network transports (`streamable-http`, SSE, WebSocket, Lambda adapters, reverse-proxied HTTP endpoints).

Current implementation uses `StdioServerTransport` in
`packages/openducktor-mcp/src/index.ts`.

## Threat Assumptions (V1)

- The MCP server is launched as a local child process by a trusted OpenDucktor runtime.
- Transport channel is process-local stdio, not internet-reachable.
- Request metadata from external network boundaries (for example `x-forwarded-for`) is not part of auth decisions in V1.

## Supply-Chain Guardrails

- `hono` is pinned via root `package.json` override to `^4.12.2` or later.
- CI runs `bun run deps:audit:hono`, which wraps `bun audit --json` and fails on GHSA-`xh87-mx6m-69f3` regression.

## Change Control for Future Transport Expansion

Before enabling any network-facing transport:

1. Complete a security design review for authn/authz and proxy trust boundaries.
2. Reassess dependency advisories for transport framework code paths.
3. Add integration tests that verify spoofed client-IP headers cannot bypass authentication.
4. Update this document and `docs/dependency-hygiene.md` in the same change.
