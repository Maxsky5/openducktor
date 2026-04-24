# apps/desktop/src/components/features/repository/

## Responsibility
Repository selection and branch switching UI, including the open-repository modal and folder picker.

## Design Patterns
The folder pairs selector models with narrow dialogs so repository, branch, and folder operations stay reusable across shell entry points.

## Data & Control Flow
Workspace state and branch lists are reduced into selector options, then selection actions call back into workspace operations.

## Integration Points
`AppShell`, workspace state operations, the branch selector model, and the repository switch/open modal flows.
