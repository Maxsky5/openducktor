# 006 — Name the compact workflow menu

- **Status**: TODO
- **Commit**: 38620ea0f
- **Severity**: HIGH
- **Category**: Accessibility
- **Rule**: react-doctor/control-has-associated-label
- **Estimated scope**: 1 production file, 1 focused test file, under 30 lines

## Problem

The normal workflow-menu trigger contains visible `More` text, but Kanban enables `compactMenuTrigger`, which removes the text and leaves only a chevron:

```tsx
// packages/frontend/src/components/features/kanban/task-workflow-action-group.tsx:118 — current
<PopoverTrigger asChild>
  <Button
    type="button"
    size={size}
    variant="outline"
    className={cn(
      compactMenuTrigger ? "px-2.5" : "px-3",
      expandPrimary ? "shrink-0" : "",
      "h-9 shadow-sm",
    )}
  >
    {compactMenuTrigger ? null : <MoreHorizontal className="size-3.5" />}
    {!compactMenuTrigger ? "More" : null}
    <ChevronDown className="size-3.5 opacity-80" />
  </Button>
</PopoverTrigger>
```

```tsx
// packages/frontend/src/components/features/kanban/kanban-task-card.tsx:435 — current
<TaskWorkflowActionGroup
  task={task}
  // existing props
  size="sm"
  expandPrimary
  compactMenuTrigger
/>
```

The recurring task-card action menu is therefore an unnamed icon-only button.

## Target

Canonical React Doctor recipe:

> Give every interactive control a label screen readers can read.

For icon-only controls, use an action-oriented `aria-label`; a tooltip or `title` does not replace the accessible name.

```tsx
// target
<Button
  type="button"
  aria-label={compactMenuTrigger ? "Open workflow actions menu" : undefined}
  size={size}
  variant="outline"
  className={cn(
    compactMenuTrigger ? "px-2.5" : "px-3",
    expandPrimary ? "shrink-0" : "",
    "h-9 shadow-sm",
  )}
>
  {compactMenuTrigger ? null : <MoreHorizontal className="size-3.5" />}
  {!compactMenuTrigger ? "More" : null}
  <ChevronDown className="size-3.5 opacity-80" />
</Button>
```

This keeps the normal trigger's computed name as `More` and names only the compact form.

## Repo conventions to follow

- Keep the existing Shadcn `Button` and Radix `PopoverTrigger` composition.
- Keep semantic-token styling and the compact visual layout unchanged.
- Test the computed name with Testing Library's role/name query.
- Reuse a deterministic multi-action task fixture from `packages/frontend/src/components/features/kanban/kanban-task-workflow.test.ts:129`.

## Steps

1. Add the conditional `aria-label` to the `Button` in `task-workflow-action-group.tsx`.
2. Do not place the label on the decorative chevron.
3. Create `task-workflow-action-group.test.tsx` if no focused component test exists.
4. Render a task that produces the overflow menu with `compactMenuTrigger` and assert `screen.getByRole("button", { name: "Open workflow actions menu" })`.
5. Render noncompact mode separately and assert the trigger remains discoverable as `More`.
6. Keep menu contents, order, and activation behavior unchanged.

## Boundaries

- Do not add visible text to compact mode.
- Do not add a tooltip or `title` as a substitute.
- Do not rename the normal `More` trigger.
- Do not add a public label prop; this component owns the meaning of compact mode.
- Do not change Popover semantics, alignment, action ordering, variants, or classes.
- Stop if the cited code has materially drifted from commit `38620ea0f`.

## Verification

- **Mechanical**:
  - `npx -y react-doctor@latest . --diff main --yes` clears the selected control-label diagnostic without lowering the score.
  - `bun test packages/frontend/src/components/features/kanban/task-workflow-action-group.test.tsx --max-concurrency=1`
  - `bun run typecheck`
  - `bun run lint`
- **Behavior check**: Inspect a Kanban card and task-details footer. Confirm the compact button is announced as `Open workflow actions menu`, the normal trigger is announced as `More`, and both open the same menu without visual changes.
- **Done when**: both role/name assertions pass, the diagnostic is clear, and workflow behavior is unchanged.
