# Tech Stack

- Runtime/package manager: Bun, pinned by root `packageManager` to `bun@1.3.11`. Use Bun workspace commands, not npm/yarn/pnpm.
- Language/module system: TypeScript, ESM packages (`"type": "module"`), Node/Bun APIs at host/tooling boundaries.
- Desktop: Electron app in `apps/electron`, Electron `^42.3.3`, electron-builder, Vite renderer.
- Frontend: React `^19.2.7`, React DOM `^19.2.7`, Vite `^8.0.16`, React Router `^7.17.0`, TanStack Query `^5.101.0`, Zustand, Radix/shadcn-style UI, lucide-react, sonner, dnd-kit, xterm.
- Styling: Tailwind CSS v4 with semantic shadcn tokens in `packages/frontend/src/styles.css`; `@tailwindcss/vite` plugin.
- Host: `effect` `^3.21.3`; host internals use Effect for fallible/I/O work and typed error channels.
- Contracts: Zod `^4.4.3` is the public schema source in `packages/contracts`.
- MCP: `@modelcontextprotocol/sdk` `^1.29.0` in `packages/openducktor-mcp`.
- Tooling: TypeScript `^5.7.3`, Biome `^2.4.16`, Bun test, Knip, Husky, commitlint conventional config.
- Frontend tests use Bun plus Testing Library and happy-dom preload (`scripts/bun-test-preload.ts`).