# apps/desktop/src/components/ui/

## Responsibility
Shared shadcn-style primitives and small UI helpers: buttons, dialogs, inputs, markdown renderers, comboboxes, badges, and visual affordances.

## Design Patterns
Mostly thin wrappers around Radix/shadcn primitives with app-specific semantics and theme-aware styling.

## Data & Control Flow
These components are rendered by feature modules and receive pre-normalized props; stateful logic lives elsewhere.

## Integration Points
`button.tsx`, `dialog.tsx`, `combobox.tsx`, `markdown-renderer*.tsx`, `sonner.tsx`, and other low-level UI atoms.
