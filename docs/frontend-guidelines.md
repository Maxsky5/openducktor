# Frontend guidelines

Read this guide before you change frontend state, forms, components, or themes.

The component and state rules below apply to the shared React app. The Astro workspace at `apps/marketing-website` ([ADR 0009](adr/0009-build-the-public-website-with-astro-and-cloudflare-workers-static-assets.md)) has its own components and CSS tokens. It reads the desktop theme tokens only inside its copies of the product UI, and it does not import the React components or state providers of the app. Read [its README](../apps/marketing-website/README.md) before you change it.

Read [the TanStack Query cache strategy](tanstack-query-cache-strategy.md) before you add or change a frontend read from the host or backend.

## State and files

- Wire state contexts in `packages/frontend/src/state/app-state-provider.tsx`.
- Put domain operations in focused hooks under `packages/frontend/src/state/{lifecycle,operations,tasks}`.
- Put shared types in `packages/frontend/src/types`.
- Put feature constants in `constants.ts`.
- Use operation-specific flags such as `isLoadingTasks` and `isLoadingChecks`.
- Do not use a generic busy flag or a magic string.

## Forms and control flow

- Disable the full form during an async submission.
- Show loading in the submit button.
- Keep pending, error, or success feedback visible.
- Replace nested ternaries with named booleans, helper functions, lookup maps, or explicit `if` and `else` statements.

## Components and themes

The app uses shadcn semantic tokens with Tailwind CSS v4. Theme tokens are in `packages/frontend/src/styles.css`. Dialog motion rules are in `packages/frontend/src/components/ui/dialog.css`.

- Use a component from `packages/frontend/src/components/ui` when one exists.
- Use semantic tokens for structural UI.
- Apply semantic tokens with `className` at the use site.
- Keep base shadcn components free of feature-specific hardcoded colors.
- Make each new UI element work in light and dark themes.
- Use `warning-surface-hover` and `warning-surface-selected` for interactive warning surfaces. Use the matching `info-surface-hover` and `info-surface-selected` tokens for information surfaces. These tokens keep the base state color across hover and selection in both themes.
- Do not use hardcoded gray colors or gradient backgrounds for structural UI.
- Keep `Dialog` mounted while it closes. If a parent mounts the dialog on demand, use `useDialogPresence(open)` in that parent and pass `open` to the dialog.

| Purpose                  | Use                                                              |
| ------------------------ | ---------------------------------------------------------------- |
| Page background          | `bg-background`                                                  |
| Card or surface          | `bg-card`                                                        |
| Main text                | `text-foreground`                                                |
| Secondary text           | `text-muted-foreground`                                          |
| Layout border            | `border-border`                                                  |
| Input border             | `border-input`                                                   |
| Subtle surface           | `bg-muted`                                                       |
| Interactive accent       | `bg-primary`, `text-primary-foreground`                          |
| Destructive action       | `bg-destructive`, `text-destructive-foreground`                  |
| Chat transcript          | `bg-chat-background`                                             |
| Chat input, user message | `bg-chat-surface`, `shadow-chat`                                 |
| Sidebar                  | `bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-border` |

## Hardcoded color exceptions

- Use `bg-emerald-*` for success, `bg-sky-*` for information, `bg-amber-*` for a warning, and `bg-rose-*` for an error.
- Use the accent colors in `kanban-theme.ts` for Kanban lane themes.
- Use hardcoded colors for small badges and tags that have semantic meaning.
- Prefer a light background such as `bg-sky-50` and dark text such as `text-sky-700`.
- Add dark-theme classes for each hardcoded color.
