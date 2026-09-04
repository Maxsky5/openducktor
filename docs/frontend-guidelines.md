# Frontend guidelines

Read this guide before you change frontend state, forms, components, or themes.

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

The app uses shadcn semantic tokens with Tailwind CSS v4. Tokens are in `packages/frontend/src/styles.css`.

- Use a component from `packages/frontend/src/components/ui` when one exists.
- Use semantic tokens for structural UI.
- Apply semantic tokens with `className` at the use site.
- Keep base shadcn components free of feature-specific hardcoded colors.
- Make each new UI element work in light and dark themes.
- Do not use hardcoded gray colors or gradient backgrounds for structural UI.

| Purpose | Use |
|---|---|
| Page background | `bg-background` |
| Card or surface | `bg-card` |
| Main text | `text-foreground` |
| Secondary text | `text-muted-foreground` |
| Layout border | `border-border` |
| Input border | `border-input` |
| Subtle surface | `bg-muted` |
| Interactive accent | `bg-primary`, `text-primary-foreground` |
| Destructive action | `bg-destructive`, `text-destructive-foreground` |
| Sidebar | `bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-border` |

## Hardcoded color exceptions

- Use `bg-emerald-*` for success, `bg-sky-*` for information, `bg-amber-*` for a warning, and `bg-rose-*` for an error.
- Use the accent colors in `kanban-theme.ts` for Kanban lane themes.
- Use hardcoded colors for small badges and tags that have semantic meaning.
- Prefer a light background such as `bg-sky-50` and dark text such as `text-sky-700`.
- Add dark-theme classes for each hardcoded color.
