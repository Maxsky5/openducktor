# 005 — Name the message composer

- **Status**: TODO
- **Commit**: 38620ea0f
- **Severity**: HIGH
- **Category**: Accessibility
- **Rule**: react-doctor/control-has-associated-label
- **Estimated scope**: 1 production file, 1 existing test file, under 20 lines

## Problem

The primary rich-text composer is a contenteditable textbox with no accessible name:

```tsx
// packages/frontend/src/components/features/agents/agent-chat/agent-chat-composer-editor.tsx:505 — current
{/* biome-ignore lint/a11y/useSemanticElements: the contenteditable root supports inline chips and file references. */}
<div
  ref={editorRef}
  role="textbox"
  aria-multiline="true"
  tabIndex={disabled ? -1 : 0}
  contentEditable={!disabled}
  suppressContentEditableWarning
  spellCheck={false}
  className={cn(/* existing classes */)}
  aria-disabled={disabled}
  // existing handlers
>
```

The visible placeholder is an absolutely positioned child and changes with runtime/read-only state. It is instructional text, not a stable accessible name. Screen-reader users therefore encounter an unnamed primary input.

## Target

Canonical React Doctor recipe:

> Give every interactive control a label screen readers can read.

Prefer visible text when practical; for a control without a stable visible label, use `aria-label` or `aria-labelledby`. A `title` is not an accessible-label substitute. Verify the computed runtime name rather than only checking source text.

For this rich contenteditable, add a stable explicit name:

```tsx
// target
<div
  ref={editorRef}
  role="textbox"
  aria-label="Message composer"
  aria-multiline="true"
  tabIndex={disabled ? -1 : 0}
  contentEditable={!disabled}
  // all existing props and handlers unchanged
>
```

Use exactly `"Message composer"`. Do not derive the label from `placeholder`, the selected agent, disabled state, or runtime state.

Plan 008 later changes the role to `combobox`; it must preserve this exact accessible name.

## Repo conventions to follow

- Preserve the intentional semantic-element suppression: the contenteditable root is required for inline chips and references.
- Use a direct ARIA name rather than hidden DOM when a stable `aria-label` is sufficient.
- Test with a role-and-name query, matching the repository's Testing Library style.

## Steps

1. At `agent-chat-composer-editor.tsx:505`, add `aria-label="Message composer"` next to the existing role.
2. Do not change the placeholder or any editor behavior.
3. In `agent-chat-composer-editor.test.tsx`, add a focused test that renders the existing `EditorHarness` and queries `screen.getByRole("textbox", { name: "Message composer" })`.
4. Assert the named element is the actual editor root returned by the existing test helper.
5. If plan 008 has already changed the role, query `combobox` instead; keep the same accessible name.

## Boundaries

- Do not replace the contenteditable with an input or textarea.
- Do not remove the semantic-element suppression.
- Do not use `title` or the changing placeholder as the label.
- Do not change keyboard, chip, selection, paste, focus, disabled, or placeholder behavior.
- Do not add hidden labeling DOM or new public props.
- Stop if the cited code has materially drifted from commit `38620ea0f`.

## Verification

- **Mechanical**:
  - `npx -y react-doctor@latest . --diff main --yes` clears the selected control-label diagnostic without lowering the score.
  - `bun test packages/frontend/src/components/features/agents/agent-chat/agent-chat-composer-editor.test.tsx --max-concurrency=1`
  - `bun run typecheck`
  - `bun run lint`
- **Behavior check**: Inspect the accessibility tree and confirm the contenteditable is announced as `Message composer` in enabled, disabled, empty, and populated states. Confirm visual layout and placeholder behavior are unchanged.
- **Done when**: the runtime role/name query passes, the diagnostic is clear, and editor behavior remains unchanged.
