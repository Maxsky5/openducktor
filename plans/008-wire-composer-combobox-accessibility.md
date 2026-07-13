# 008 — Wire composer autocomplete as a combobox

- **Status**: TODO
- **Commit**: 38620ea0f
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Rule**: Beyond the scan
- **Estimated scope**: 4 production components, 4 focused test files, roughly 180 lines

## Problem

The composer keeps keyboard focus in its contenteditable editor, but its autocomplete popups are not semantically connected to that control. Reference rows are independently tabbable native buttons and selection is pointer-down-only at the row level:

```tsx
// packages/frontend/src/components/features/agents/agent-chat/agent-chat-composer-reference-menu.tsx:153 — current
<button
  ref={rowRef}
  id={optionId}
  role="option"
  aria-selected={isActive}
  type="button"
  className={referenceMenuRowClassName(isActive)}
  onPointerDown={(event) => {
    event.preventDefault();
    onSelect(subagent);
  }}
>
```

The listbox incorrectly owns active-descendant state and is tabbable:

```tsx
// agent-chat-composer-reference-menu.tsx:89 — current
<div
  id={listboxId}
  role="listbox"
  aria-label="References"
  aria-activedescendant={activeOptionId}
  tabIndex={0}
>
```

The focused editor has no combobox relationship:

```tsx
// packages/frontend/src/components/features/agents/agent-chat/agent-chat-composer-editor.tsx:505 — current
<div
  ref={editorRef}
  role="textbox"
  aria-multiline="true"
  tabIndex={disabled ? -1 : 0}
  contentEditable={!disabled}
  aria-disabled={disabled}
>
```

Slash-command and skill menus similarly lack listbox/option semantics. Existing keydown code already handles Arrow keys, Enter, Tab, and Escape while editor focus remains in place; the missing piece is correct ARIA ownership and removal of popup descendants from the normal Tab sequence.

## Dependencies

- Implement plan **003** first because it changes the reference popup's hidden pending interval.
- Implement plan **005** first and preserve its exact `aria-label="Message composer"`.

## Target

Follow the WAI-ARIA editable combobox pattern:

- DOM focus remains on the contenteditable combobox.
- The combobox owns `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`, and `aria-activedescendant`.
- The popup owns `role="listbox"`.
- Suggestions own `role="option"` and `aria-selected`.
- Popup descendants are not in the normal Tab sequence.

```tsx
// agent-chat-composer-editor.tsx — target shape
<div
  ref={editorRef}
  role="combobox"
  aria-label="Message composer"
  aria-expanded={activePopup !== null}
  aria-controls={activePopup?.listboxId}
  aria-autocomplete="list"
  aria-activedescendant={activePopup?.activeOptionId}
  tabIndex={disabled ? -1 : 0}
  contentEditable={!disabled}
  suppressContentEditableWarning
  spellCheck={false}
  aria-disabled={disabled}
  // existing classes and handlers
>
```

Remove `aria-multiline` unless the chosen role contract is proven to support it. The editor remains behaviorally multiline through existing Shift+Enter handling.

Generate stable listbox IDs in `AgentChatComposerEditor` for reference, slash-command, and skill menus. Pass each ID to its menu. Derive one active-popup descriptor from the popup that is actually mounted:

```ts
type ActiveComposerPopup = {
  listboxId: string;
  activeOptionId?: string;
};
```

Extract or share the reference menu's existing visibility predicate so `aria-expanded` is true only when the listbox is mounted. Do not mount an empty popup during the intentionally hidden pre-loading interval merely to simplify ARIA state.

For each menu:

```tsx
<div id={listboxId} role="listbox" aria-label="References">
  <button
    id={optionId}
    role="option"
    aria-selected={isActive}
    tabIndex={-1}
    type="button"
    onPointerDown={(event) => {
      event.preventDefault();
      onSelect(item);
    }}
  >
    {/* existing row content */}
  </button>
</div>
```

Remove `aria-activedescendant` and `tabIndex` from the listbox. Keep pointer-down selection to preserve editor focus. Keyboard selection continues through the existing editor keydown state machine, so a second row-level keyboard handler is not needed.

## Repo conventions to follow

- Keep the rich contenteditable; do not replace it with the generic button/popover `components/ui/combobox.tsx`.
- Preserve the current selection restoration and keydown precedence in `agent-chat-composer-editor-keydown.ts`.
- Keep stable IDs generated with React `useId` in the owning editor.
- Keep loading/error/empty feedback visible but outside the option sequence.

## Steps

1. In `AgentChatComposerEditor`, create stable IDs for reference, slash-command, and skill listboxes.
2. Share the reference popup visibility calculation between editor and menu so the editor reports expansion only when the popup is mounted.
3. Derive the currently visible popup's listbox ID and active option ID. Preserve the existing rule that only one autocomplete popup is active.
4. Change the editor role to `combobox`, preserve `aria-label="Message composer"`, and add the target ARIA properties.
5. Pass the owned listbox IDs into `AgentChatComposerReferenceMenu`, `AgentChatComposerSlashMenu`, and `AgentChatComposerSkillMenu` as required props.
6. In the reference menu, remove local listbox ID generation, listbox `aria-activedescendant`, and listbox tab stop. Add `tabIndex={-1}` to file and subagent option buttons.
7. In slash and skill menus, add listbox roles/labels, deterministic option IDs, `role="option"`, `aria-selected`, and `tabIndex={-1}`.
8. Keep `onPointerDown(event.preventDefault())` and the current `onSelect` callbacks for pointer users.
9. Do not rewrite `agent-chat-composer-editor-keydown.ts`; retain Arrow navigation, Enter/Tab acceptance, Escape close, Shift+Enter newline, and submit fallback.
10. Update `agent-chat-composer-editor.test.tsx` to assert collapsed/expanded state, controls ID, active descendant changes, focus retention, Enter/Tab acceptance without submit, and cleanup after close for reference, slash, and skill popups.
11. Update each menu's focused test to assert supplied listbox ID, roles, option IDs, selection state, and `tabIndex={-1}`. Reference loading/error/empty states should mount a controlled listbox only when visibly open.

## Boundaries

- Do not replace the contenteditable or introduce a second keyboard state machine.
- Do not move focus into popup options.
- Do not add row `onClick` while leaving rows tabbable; the target pattern removes them from Tab order and routes keyboard activation through the combobox.
- Do not change filtering, ranking, trigger syntax, active-index logic, or visual styling.
- Do not turn loading/error/empty feedback into selectable options.
- Do not derive the accessible name from the placeholder; preserve plan 005's exact label.
- Do not add dependencies.
- Stop if the cited code has materially drifted from commit `38620ea0f`.

## Verification

- **Mechanical**:
  - `bun test packages/frontend/src/components/features/agents/agent-chat/agent-chat-composer-editor.test.tsx packages/frontend/src/components/features/agents/agent-chat/agent-chat-composer-reference-menu.test.tsx packages/frontend/src/components/features/agents/agent-chat/agent-chat-composer-slash-menu.test.tsx packages/frontend/src/components/features/agents/agent-chat/agent-chat-composer-skill-menu.test.tsx --max-concurrency=1`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run --filter @openducktor/frontend test`
  - `npx -y react-doctor@latest . --diff main --yes` does not lower the score.
- **Behavior check**: With keyboard only, open `@`, `/`, and skill popups; confirm focus stays on `Message composer`, Arrow keys announce/change the active option, Enter and Tab insert without submitting, Escape closes, and the next ordinary Tab after closure skips popup rows. Verify pointer selection still restores/retains editor focus. Inspect with a screen reader for combobox name, expanded state, and active-option announcements.
- **Done when**: focus ownership and ARIA relationships match the target, popup rows are not Tab stops, all existing selection behavior remains intact, and checks pass.
