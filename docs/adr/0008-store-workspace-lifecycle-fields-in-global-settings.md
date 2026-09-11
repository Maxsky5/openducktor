---
status: accepted
date: 2026-09-11
---

# Store workspace lifecycle fields in the global settings

## Decision

Store three durable fields in the global settings:

- `repoConfig.closed`: a boolean on each workspace. Absent means open.
- `repoConfig.removal`: an optional versioned removal record. Absent means no removal.
- `globalConfig.onboardingCompleted`: an optional boolean. Absent means the host infers the value from the workspace list.

Keep the settings format version at 3. The fields are optional, so an older version 3 file stays valid.

The user approved this shape on 2026-09-11. The user required the format version to stay at 3 because the new fields are backward compatible.

## Consequences

- An older OpenDucktor binary can read a version 3 file. The older binary ignores the new fields when it writes the file. A closed workspace can then appear open. The user accepted this risk.
- A legacy file with workspaces has no `onboardingCompleted` value. The host treats it as complete, so the app does not repeat onboarding after the upgrade.
- The removal record holds recovery data for an incomplete removal: operation ID, phase, worktree choice, removed worktrees, and the last failure. The record stays in the target workspace configuration and leaves with the registration.
- The task store schema and its migration files stay unchanged.

## Alternatives

- Raise the settings format version: rejected by the user because the fields are backward compatible.
- Keep the closed flag in a separate file: rejected because the removal record must leave with the workspace in one settings write.
