# packages/frontend/src/components/layout/sidebar/

## Responsibility

Sidebar chrome for workspace context, branch switching, navigation, activity summaries, app branding, and theme toggling.

## Design/Patterns

Small presenter components render agent activity read models and read-only workspace state; no separate sidebar model layer remains.

## Data & Control Flow

Workspace and session snapshots are reduced into counts and labels, then rendered as sidebar cards and navigation affordances.

## Integration Points

`AppShell`, `agent-activity-card`, `branch-switcher`, `sidebar-navigation`, `app-brand`, `theme-toggle`, `state/read-models/agent-activity-read-model`, and `agent-sessions-store`.
