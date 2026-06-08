# Frontend Core

- Location: `packages/frontend`; shared React/Vite UI consumed by Electron and web runner.
- State provider root: `packages/frontend/src/state/app-state-provider.tsx`; providers compose runtime, workspace, tasks, checks, spec, delegation, and autopilot state.
- Server/host-owned reads use TanStack Query. Query keys/options live under `packages/frontend/src/state/queries`; render paths use `useQuery`/related hooks, imperative reads use QueryClient APIs.
- Local UI state, form drafts, modal visibility, streaming transcript assembly, pending permissions/questions, and live tool output are not TanStack Query cache state.
- Domain operations live in focused hooks under `packages/frontend/src/state/{lifecycle,operations,tasks}` and feature modules; use operation-specific loading flags.
- Shared types belong under `packages/frontend/src/types`; feature constants beat magic strings.
- Styling: use shadcn components from `packages/frontend/src/components/ui`; use semantic Tailwind tokens (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `border-input`, etc.).
- Hardcoded colors are acceptable only for status indicators, kanban lane themes, and small semantic badges/tags.
- Avoid native browser-styled controls when a project UI component exists.
- Form submissions: disable the full form scope, show in-button loading, preserve pending/error/success feedback.
- Frontend tests using Query must provide isolated query clients. Components/hooks using app-state hooks need explicit minimal providers even with `renderToStaticMarkup`.