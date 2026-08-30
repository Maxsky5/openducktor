# TypeScript Toolchain

OpenDucktor uses TypeScript 7.0.2 and Bun 1.3.14. Keep the root `packageManager` field and every workflow `BUN_VERSION` pin in sync when Bun changes.

## Editor And Tool Support

TypeScript 7 does not ship the legacy `tsserver` binary or its stable compiler API. Editors must use a TypeScript 7-aware language server instead of starting `node_modules/typescript/lib/tsserver.js`. The repository does not import `typescript` as a runtime or build API; it uses the package through the `tsc` command only.

## TypeScript 7 Migration Review

The TypeScript 7 migration removed `baseUrl` from the shared, Electron, frontend, and web TypeScript configs. Each remaining `paths` entry is relative to its owning config. Frontend modules consumed as source by another workspace package use relative imports for their own runtime dependencies so Bun does not need the consumer's `@/` alias to load them.

TypeScript 7 defaults `types` to an empty array. The MCP config declares `node` and `bun-types`, and the Core config declares `node`, because those projects use those runtime globals.

The MCP declaration review emitted the package once with TypeScript 5.9.3 and once with TypeScript 7.0.2, then compared every generated `.d.ts` file. All files were byte-identical except `odt-task-store.d.ts`. Its diff only reordered object properties and union members; it added or removed no API member or union value. No tracked snapshot or release check depends on declaration order.

The browser terminal transport copies each outgoing `Uint8Array` with `frame.slice()` before `WebSocket.send`. This creates an `ArrayBuffer`-backed view at the browser boundary and leaves incoming `ArrayBuffer` frames unchanged.

## Verification Baseline

Run `bun install`, `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run deps:unused:deps`, and `bun run deps:unused:exports` from the repository root after a TypeScript or Bun change.

On the TypeScript 7.0.2 migration branch, warm typecheck took 3.06 seconds against the TypeScript 5.9 baseline of 12.5–12.7 seconds. Warm build took 2.57 seconds against the 12.0 second baseline. These figures cover the full workspace commands on the same local checkout and are not CI service-level targets.
