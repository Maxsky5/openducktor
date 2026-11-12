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

The app uses shadcn semantic tokens with Tailwind CSS v4. Theme tokens are in `packages/theme/src/tokens.css`, which `packages/frontend/src/styles.css` imports. Motion tokens are in `packages/frontend/src/components/ui/motion.css` and `motion.ts`. Dialog motion rules are in `packages/frontend/src/components/ui/dialog.css`.

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
- Pass combined preparation reads to `DialogContent` through `loading`, with a short `loadingLabel` that names the read. Keep the title, description, task or session identity, and close control outside `DialogBody`. The body shows one compact loader for at least 500 ms, then reveals its content and `DialogFooter` together. Hidden children stay mounted so their reads and drafts continue. Pass preparation state, not mutation state. Local form setup and reads with usable cached data do not need a loader. Show forms at once while their option reads run in the fields. Disable confirmation until the required input is ready. Keep ready content visible during retries, searches, validation, and background refreshes. Use the same `loading` input on mobile `SheetScreen`, `SheetFrame`, and `InPlaceSheet`; use `intro` on `SheetScreen` and `InPlaceSheet` for context that must stay visible.
- Put the dismissal button first in `DialogFooter` and the main action last. Add `justify-end` when a footer has one action and no dismissal. Do not repeat `justify-between`; the shared footer sets it.
- Give each modal confirmation button an action icon and a pending spinner. Use the same icon and variant for repeated actions. Close task uses `CircleCheckBig` and `warning`; reset uses `RotateCcw` and `destructive`; delete uses `Trash2` and `destructive`; save uses `Save` and the primary variant.
- Give `motion="instant"` to `DialogContent` and `useDialogPresence(open, "instant")` for a dialog that users open from a key many times a day. The dialog then shows, hides, and resizes at once.
- Use `CssPresenceReveal` for form content that a switch shows. Put the space above the content in its `className` as padding. The reveal clips that space with its height, and an animated dialog follows the reveal height in each frame without a second resize animation. Do not put a margin on the content: the margin stays outside the height, and it goes away in one step when the reveal closes. `motionClassName` gives a feature its own durations and clip margin.
- Show the icon of a file with `FileTypeIcon`. It takes the icon and the color of the file type from `@pierre/trees`, as the file tree shows them, and shows the base file icon for a type without one. Where an icon shows the type of a file, show the change of the file with a letter, such as `M`, `A`, or `D`. The mobile app uses its own icon font, because `@pierre/trees` defines web components when it loads.

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

## Tool calls in the transcript

- A press on a tool call row shows the details of the call. The cards of the ODT workflow and artifact tools work the same way: a press on the card shows the call in the details, and the card keeps only its title, its status, its pull request, and its error or summary line. The details title names the workflow tool and its event, such as `Workflow Event · Build Completed`. The details show the note of a workflow event before its input, and each line of the note stays a separate line.
- A task page or a Workspace Session page shows the details in the Tool call tab of its right panel, beside the transcript, so they cover no row. `usePageToolDetails` and `PageToolDetailsProvider` in `features/session-panels/page-tool-details.tsx` give one `ToolDetailsStore` to the transcripts and to the panel. The layout does not save the tab, and the New tab launcher does not offer it.
- A transcript without session panels, such as a Subagent transcript in a dialog, shows the details beside itself with `AgentChatToolDetailsBeside`. Escape there closes the details and keeps the dialog.
- The details of a shell command show its status, its run facts, its folder, and the command without a first `cd <directory> &&` step.
- Only the output of a shell command scrolls. The output opens at its end, where commands print their result. The output shows live only for a runtime that sends the output of a running command. For the other runtimes, the details say that the output shows when the command ends.
- The output keeps its ANSI colors in the tones of the theme. A plain unified diff gets the colors of `git`. In the output of a failed command, the line that `findFailureLine` finds shows marked.
- A call that the user or a policy declined shows as cancelled, not as failed. The [runtime integration guide](runtime-integration-guide.md#transcript-and-history) gives the status rules of shell calls.
- Keep the transcript row of a call to one line. A failed call adds one error preview line.
- Consecutive tool calls of a turn that show one line each show as one tool run. `groupToolRuns` in `tool-runs.ts` of the frontend core finds the runs, and `readToolRunCallLine` gives the line of each call.
- A run holds shell commands, file reads, lists, searches, and edits, web searches, the ODT tools in `ODT_TASK_READ_TOOL_NAMES`, and the calls of other tools, such as MCP tools.
- Questions, todo updates, computer use, browser tools, the other ODT tools, and subagents keep their own display and stay out of runs.
- A call alone makes a run of one call with its header, so nothing moves when the next call comes.
- Each line of a run shows the icon of its tool, the tool name, and its command or summary. The icon of a failed call is red, and the icon of a cancelled call is orange.
- `readToolCallName` gives the calls of each runtime one common name in the run lines and in the plain tool rows: `bash` for a shell command, and `edit` for a call that edits files, such as `Edit`, `Write`, or `apply_patch`. The tool details show the name of the tool that the agent called.
- Tool row icons sit on the middle of their line, which is the middle of the capital letters. An error line opens under its call, so the icon and the timing stay on the line of the call.
- `ToolCallIcon` shows a spinner in place of the tool icon while the agent writes a call, and moving bars while the call runs. The run lines and the plain tool rows use it.
- A part of a call that a new state brings moves in: a new icon fades and grows in, the command fades in, and an error opens under the call. A part that shows when its row mounts does not move, so a session that loads shows at once.
- The path of a read or an edit shows the icon of its file type before it. An edit line shows its added and removed lines, and its details show the changes of each file. An edit without a change to show, such as a failed edit, shows its input instead, so the reader sees what the agent tried (`hasFileEditChanges`).
- The `groupToolCalls` chat setting turns runs off. Each call then shows as its own tool row with the same details. The mobile app has the same switch in its device preferences.
- The header of a run says when its calls fail or stop. It says that the run runs only while the run is folded, because an open run shows its running calls in their lines.
- The header of a run counts the calls of each kind. The edits count the files that they change, so a patch of five files counts as five edits.
- An open run of more than six calls shows its latest five calls under a bar. The bar shows the earlier calls 25 at a time, and it also hides them again. Calls that the reader showed stay shown while new calls come.
- In a run that shows only its latest calls, a new call comes in at the bottom, and the oldest shown call goes out at the top, under the bar. The run keeps its height.
- The `collapseFinishedToolCalls` chat setting folds a run once all its calls ended and another row follows it. A run that the reader opened or folded keeps that choice.
- A run folds and opens like an accordion with `CssPresenceReveal` and its `tool-run-reveal` motion.
- Each run is one row of the row window: its first row, which shows the whole run. `buildToolRunWindowRows` in `agent-chat-tool-run-layout.ts` gives these rows to the window. A new call, a fold, or a page of earlier calls changes only the height of that row, as a streamed message does. Do not change the row window for tool runs.
- A press on a run control stops the transcript from following its end, so scroll anchoring keeps the run where the reader pressed it.
- Rows that a live session adds come in with a short fade and rise from `useAgentChatRowEntryMotion`. A new run comes in with its header. A run brings in its later calls itself. Rows of a session load, of loaded history, and of a row window move show at once.
- The mobile transcript shows a run as one list item. Its rules are in the [mobile README](../apps/mobile/README.md#transcript-list).

## Command palette

The command palette is in `packages/frontend/src/features/command-palette`. `WorkspaceAppShell` mounts it. Mod+K opens it: Cmd on macOS, and Ctrl on Windows and Linux.

- Run each palette action through its existing handler, dialog, or confirmation. Do not add a second version of an action.
- Run an action of a task, workspace session, or workspace through `useWorkspaceIntentRunner`. It makes the workspace active before the action runs.
- Run a task action on the current page. Only an action that opens a session goes to another page.
- Open the task details through `onOpenTaskDetails` of the task workflow actions. `TaskWorkflowActionsProvider` shows the shared details sheet. The Kanban page, Agent Studio, and the palette use it. The sheet closes when the page changes.
- Run a declared workflow action through `runAction`. `resolveTaskActionDestination` in `packages/frontend-core/src/tasks/workflow/task-action-destination.ts` gives its client operation, and `createTaskActionRunner` runs it for every client and surface. Desktop and mobile give only their own handlers, such as routes or dialogs. A surface adds its session options, and a surface that must keep focus, such as the non-modal details sheet, adds its own confirmations. The runner builds the continuation of a confirmed event.
- An event action whose event has the `worktree.reset` host effect opens the Reset Implementation confirmation. The confirmation sends the event ID with `taskApplyEvent`, and names the state that the event gives.
- An event action with a following launch that has the `human_feedback` context opens the human feedback form. The form does not depend on a host effect.
- Remove Worktree is a core task action, not a workflow action. The details read the worktree and own its confirmation, so only the details show it.
- Other command owners give the task card that their host command returned to `onCommitted`. `continueTaskWorkflow` selects the following launch from that card. Do not read the task list after a command: the task stream updates every task view.
- A pull request approval starts no following launch, because the approval event runs only when the pull request merges.
- Build every workflow rail with `buildWorkflowRail` in `packages/frontend-core/src/tasks/presentation/workflow-rail.ts`. A surface gives only the session of each role. Agent Studio, session previews, and mobile choose that session differently.
- Use `useHumanReviewFeedback` in `packages/frontend-core/src/tasks/workflow/use-human-review-feedback.ts` for every human feedback form.
- A feedback event with a following launch selects that launch with `launchAfterEvent`, in the state that the event gives. The launch request carries `beforeStartAction` with the event ID, so the host commits the event only after the launch passes its checks. A canceled start keeps the form, its message, and the task state.
- A feedback launch that an available event action starts next also sends the event of that action in `beforeStartAction`.
- A feedback event without a following launch commits the event alone with `taskApplyEvent`.
- Open the Reset Task and Delete confirmations through `onConfirmTaskAction`. `TaskWorkflowActionsProvider` shows them on any page, with the same dialogs as the task details sheet.
- Open the Rename and Archive dialogs of a workspace session through `useSessionMenu`. The sidebar and the palette share these dialogs. Workspace session actions other than Open session do not make the workspace active.
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
