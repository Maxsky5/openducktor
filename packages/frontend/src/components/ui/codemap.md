# packages/frontend/src/components/ui/

## Responsibility
Shared shadcn-style primitives and small UI helpers: buttons, dialogs, inputs, markdown renderer pieces, document copy/preview affordances, comboboxes, badges, and visual affordances.

## Design Patterns
Mostly thin wrappers around Radix/shadcn primitives with app-specific semantics and theme-aware styling.

## Data & Control Flow
These components are rendered by feature modules and receive pre-normalized props; markdown healing, preview state, and clipboard logic live elsewhere.

## Integration Points
`button.tsx`, `dialog.tsx`, `combobox.tsx`, `copy-icon-button.tsx`, `document-copy-button.tsx`, `markdown-renderer*.tsx`, `markdown-preview-modal.tsx`, `sonner.tsx`, and other low-level UI atoms.
