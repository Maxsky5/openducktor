# packages/frontend/src/components/layout/sidebar/

## Responsibility
Sidebar-specific chrome for workspace context, branch switching, navigation, activity summaries, and theme toggling.

## Design Patterns
Small presenter components render agent activity read models from `state/read-models` and read-only workspace state.

## Data & Control Flow
Workspace and session snapshots are reduced into counts/titles, then rendered as sidebar cards and navigation affordances.

## Integration Points
`AppShell`, `useShellAgentActivity`, `WorkspaceRail`, `BranchSwitcher`, `SidebarNavigation`, `ThemeToggle`, `state/read-models/agent-activity-read-model`, and `agent-sessions-store`.
