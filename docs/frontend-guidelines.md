# Frontend guidelines

Read this guide before you change frontend state, forms, components, or themes.

The component and state rules below apply to the shared React app. The Astro workspace at `apps/marketing-website` ([ADR 0009](adr/0009-build-the-public-website-with-astro-and-cloudflare-workers-static-assets.md)) has its own components and CSS tokens. It reads the desktop theme tokens only inside its copies of the product UI, and it does not import the React components or state providers of the app. Read [its README](../apps/marketing-website/README.md) before you change it.

Read [the TanStack Query cache strategy](tanstack-query-cache-strategy.md) before you add or change a frontend read from the host or backend.

## State and files

- Wire state contexts in `packages/frontend/src/state/app-state-provider.tsx`.
- Put client behavior that another client also needs in `packages/frontend-core`: host reads and cache sync, session projection, history, notification policy, recovery, and drafts. Read [the frontend core](architecture-overview.md#frontend-core) first. Keep presentation, routing, and browser APIs in the frontend.
- Reach the host through the client connection: `useHostClient`, `useHostConnection`, or `useClientConnection` in React, and `connectionHost(queryClient)` in a query function. Do not add a module-level host client or query client.
- Put domain operations in focused hooks under `packages/frontend/src/state/{lifecycle,operations,tasks}`.
- Put shared types in `packages/frontend/src/types`, or in `packages/frontend-core/src/types` when the frontend core uses them.
- Put feature constants in `constants.ts`.
- Use operation-specific flags such as `isLoadingTasks` and `isLoadingChecks`.
- Do not use a generic busy flag or a magic string.

## Forms and control flow

- Disable the full form during an async submission.
- Show loading in the submit button.
- Keep pending, error, or success feedback visible.
- Replace nested ternaries with named booleans, helper functions, lookup maps, or explicit `if` and `else` statements.

## Components and themes

The app uses shadcn semantic tokens with Tailwind CSS v4. Theme tokens are in `packages/frontend/src/styles.css`. Motion tokens are in `packages/frontend/src/components/ui/motion.css` and `motion.ts`. Dialog motion rules are in `packages/frontend/src/components/ui/dialog.css`.

- Use a component from `packages/frontend/src/components/ui` when one exists.
- Use semantic tokens for structural UI.
- Apply semantic tokens with `className` at the use site.
- Keep base shadcn components free of feature-specific hardcoded colors.
- Make each new UI element work in light and dark themes.
- Show focus with the neutral `ring` color only. Do not use the primary color, an opacity modifier, or a glow.
- Give a focused field or select trigger with an input border the `border-ring` border and no ring. `Input`, `Textarea`, and the default `Combobox` trigger apply it. A `Button` select trigger also needs `focus-visible:ring-0`. A field inside a group that draws the border, such as an input with an attached button, uses `embedded` and puts `focus-within:border-ring` or `has-[input:focus-visible]:border-ring` on the group.
- Give every other focused control a 2px `ring-ring` ring. `Button`, `Checkbox`, `RadioGroupItem`, `Switch`, `Slider`, and segmented items apply it. A checked fill or a selected border hides a border change.
- Mark a target that the user navigated to, such as the message of a transcript jump, with one short neutral pulse in `--highlight-pulse`. Nothing stays after the pulse. Do not use a tint, a brand color, an outline, or the focus ring for it.
- Use `--motion-ease-out` for UI that enters, leaves, or settles. In JavaScript, use `MOTION_EASE_OUT` from `components/ui/motion.ts`, because the Web Animations API cannot read a CSS variable. Give `MOTION_EASE_OUT_POINTS` to the `motion` library. Do not declare a new copy of a curve.
- Use `warning-surface-hover` and `warning-surface-selected` for interactive warning surfaces. Use the matching `info-surface-hover` and `info-surface-selected` tokens for information surfaces. These tokens keep the base state color across hover and selection in both themes.
- Do not use hardcoded gray colors or gradient backgrounds for structural UI.
- Keep `Dialog` mounted while it closes. If a parent mounts the dialog on demand, use `useDialogPresence(open)` in that parent and pass `open` to the dialog.
- Pass combined preparation reads to `DialogContent` through `loading`, with a short `loadingLabel` that names the read. Keep the title, description, task or chat identity, and close control outside `DialogBody`. The body shows one compact loader for at least 500 ms, then reveals its content and `DialogFooter` together. Hidden children stay mounted so their reads and drafts continue. Pass preparation state, not mutation state. Local form setup and reads with usable cached data do not need a loader. Show forms at once while their option reads run in the fields. Disable confirmation until the required input is ready. Keep ready content visible during retries, searches, validation, and background refreshes. Use the same `loading` input on mobile `SheetScreen`, `SheetFrame`, and `InPlaceSheet`; use `intro` on `SheetScreen` and `InPlaceSheet` for context that must stay visible.
- Put the dismissal button first in `DialogFooter` and the main action last. Add `justify-end` when a footer has one action and no dismissal. Do not repeat `justify-between`; the shared footer sets it.
- Give each modal confirmation button an action icon and a pending spinner. Use the same icon and variant for repeated actions. Close task uses `CircleCheckBig` and `warning`; reset uses `RotateCcw` and `destructive`; delete uses `Trash2` and `destructive`; save uses `Save` and the primary variant.
- Give `motion="instant"` to `DialogContent` and `useDialogPresence(open, "instant")` for a dialog that users open from a key many times a day. The dialog then shows, hides, and resizes at once.

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

## Command palette

The command palette is in `packages/frontend/src/features/command-palette`. `WorkspaceAppShell` mounts it. Mod+K opens it: Cmd on macOS, and Ctrl on Windows and Linux.

- Run each palette action through its existing handler, dialog, or confirmation. Do not add a second version of an action.
- Run an action of a task, chat, or workspace through `useWorkspaceIntentRunner`. It makes the workspace active before the action runs.
- Run a task action on the current page. Only an action that opens a session goes to another page.
- Open the task details through `onOpenTaskDetails` of the task workflow actions. `TaskWorkflowActionsProvider` shows the shared details sheet. The Kanban page, Agent Studio, and the palette use it. The sheet closes when the page changes.
- Run a declared workflow action through `runAction`. `resolveTaskActionDestination` in `packages/frontend-core/src/tasks/workflow/task-action-destination.ts` gives its client operation, and `createTaskActionRunner` runs it for every client and surface. Desktop and mobile give only their own handlers, such as routes or dialogs. A surface adds its session options, and a surface that must keep focus, such as the non-modal details sheet, adds its own confirmations. The runner builds the continuation of a confirmed event.
- An event action whose event has the `worktree.reset` host effect opens the Reset Implementation confirmation. The confirmation sends the event ID with `taskApplyEvent`, and names the state that the event gives.
- An event action with a following launch that has the `human_feedback` context opens the human feedback form. The form does not depend on a host effect.
- Remove Worktree opens the task details from every other surface, because the details read the worktree and own its confirmation.
- Other command owners give the task card that their host command returned to `onCommitted`. `continueTaskWorkflow` selects the following launch from that card. Do not read the task list after a command: the task stream updates every task view.
- A pull request approval starts no following launch, because the approval event runs only when the pull request merges.
- Build every workflow rail with `buildWorkflowRail` in `packages/frontend-core/src/tasks/presentation/workflow-rail.ts`. A surface gives only the session of each role. Agent Studio, session previews, and mobile choose that session differently.
- Use `useHumanReviewFeedback` in `packages/frontend-core/src/tasks/workflow/use-human-review-feedback.ts` for every human feedback form.
- A feedback event with a following launch selects that launch with `launchAfterEvent`, in the state that the event gives. The launch request carries `beforeStartAction` with the event ID, so the host commits the event only after the launch passes its checks. A canceled start keeps the form, its message, and the task state.
- A feedback launch that an available event action starts next also sends the event of that action in `beforeStartAction`.
- A feedback event without a following launch commits the event alone with `taskApplyEvent`.
- Open the Reset Task and Delete confirmations through `onConfirmTaskAction`. `TaskWorkflowActionsProvider` shows them on any page, with the same dialogs as the task details sheet.
- Open the Rename and Archive dialogs of a chat through `useSessionMenu`. The sidebar and the palette share these dialogs. Chat actions other than Open chat do not make the workspace active.
- Add an app action to `useCommandPaletteActions`. Give it other words in `keywords`, so that search finds it.
- Use `useCommandPalettePageCommand` for a command that exists only on one page, such as the panel toggles of a session page.
- The shortcut does nothing while a `Dialog` or `Sheet` is open. `hasOpenDialog` in `components/ui/open-dialogs.ts` reports this state.
- Keep the Recent list device-local. It is UI state in the storage of the client connection, not task data. A remote host keeps it in connection memory.
- Show the core Close Task and Reset Task from `coreTaskActions(task)` in the palette task actions, not as workflow actions.
- Show and hide the palette and its workspace list without motion.

## Hardcoded color exceptions

- Use `bg-emerald-*` for success, `bg-sky-*` for information, `bg-amber-*` for a warning, and `bg-rose-*` for an error.
- Use the accent colors in `kanban-theme.ts` for Kanban lane themes.
- Use hardcoded colors for small badges and tags that have semantic meaning.
- Prefer a light background such as `bg-sky-50` and dark text such as `text-sky-700`.
- Add dark-theme classes for each hardcoded color.
