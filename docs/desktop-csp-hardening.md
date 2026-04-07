# Desktop CSP Hardening

This document defines the current Content Security Policy baseline for the desktop app, the attachment preview allowances that depend on it, and the remaining hardening roadmap.

## Current Baseline

`apps/desktop/src-tauri/tauri.conf.json` defines both `app.security.csp` and `app.security.devCsp`.

Production CSP constraints:

- `default-src 'self'`
- `base-uri 'none'`
- `frame-ancestors 'none'`
- `object-src 'none'`
- `form-action 'self'`
- `script-src 'self'`
- `style-src 'self' 'unsafe-inline'`
- `img-src 'self' data: blob: asset: http://asset.localhost`
- `media-src 'self' data: blob: asset: http://asset.localhost`
- `connect-src ipc: http://ipc.localhost http://127.0.0.1:*`

Development CSP retains the same baseline for media loading, with only dev-specific allowances for Vite/HMR (`'unsafe-eval'`, `localhost`, and `ws://` endpoints).

A desktop contract test enforces this baseline in `apps/desktop/src/lib/tauri-csp.contract.test.ts`.

## Attachment Preview Allowances

The desktop attachment preview flow intentionally uses two different transports:

- Composer previews use `blob:` object URLs created from in-memory draft `File` objects in `apps/desktop/src/components/features/agents/agent-chat/use-agent-chat-attachment-preview.ts`.
- Transcript previews resolve staged local attachment paths through `apps/desktop/src/lib/local-attachment-files.ts` and convert the validated path with Tauri's asset protocol.

That means `img-src` and `media-src` must allow both:

- `blob:` for pre-send composer previews
- `asset:` and `http://asset.localhost` for staged transcript previews after send

These allowances are intentionally limited to media directives only. The CSP does not broaden `script-src` or add generic fallback transports for attachment rendering.

## Attachment Preview Verification Matrix

The bundled attachment preview fix was validated manually against the real desktop app in all supported desktop targets:

- `bun run tauri:dev`: composer image preview before send, transcript thumbnail after send, and transcript preview dialog render all passed.
- `bun run tauri:dev:cef`: composer image preview before send, transcript thumbnail after send, and transcript preview dialog render all passed.
- Packaged default desktop build produced by `bun run tauri:build`: composer image preview before send, transcript thumbnail after send, and transcript preview dialog render all passed.
- Packaged CEF desktop build produced by `bun run tauri:build:cef`: composer image preview before send, transcript thumbnail after send, and transcript preview dialog render all passed.

Negative-path preview failures remain covered by automated tests in the attachment preview helper, hook, and chip suites.

## Remaining Risk

`connect-src` still allows `http://127.0.0.1:*` in production.

Reason: the WebView currently talks directly to the local OpenCode runtime over loopback HTTP (dynamic port), so wildcard localhost is required for runtime features.

Security impact: if an XSS bug is introduced later, attacker-controlled JavaScript could attempt requests to arbitrary loopback services.

## Phase 2 Tightening Plan

1. Move OpenCode runtime network calls behind typed Tauri host commands so the WebView no longer calls loopback HTTP directly.
2. Keep runtime/network policy in host/domain layers, with frontend using IPC adapters only.
3. Narrow production `connect-src` to IPC-only transports after migration (`ipc:` and `http://ipc.localhost`).
4. Add/extend contract tests so wildcard loopback in production fails CI.

## Change Control

Any change to CSP, runtime transport boundaries, or host-command coverage must update this document in the same change.
