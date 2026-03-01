# Desktop CSP Hardening

This document defines the current Content Security Policy baseline for the desktop app and the remaining hardening roadmap.

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
- `img-src 'self' data:`
- `connect-src ipc: http://ipc.localhost http://127.0.0.1:*`

Development CSP retains the same baseline, with only dev-specific allowances for Vite/HMR (`'unsafe-eval'`, `localhost`, and `ws://` endpoints).

A desktop contract test enforces this baseline in `apps/desktop/src/lib/tauri-csp.contract.test.ts`.

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
