# packages/frontend/src/components/features/settings/settings-save/

## Responsibility
Pure settings-save preparation layer that converts editable settings drafts into normalized `SettingsSnapshot` and `RepoConfig` payloads before persistence.

## Design Patterns
- Functional transformation helpers keep save-time normalization outside React hooks and modal components.
- Concern-specific modules prepare autopilot rules, global git settings, prompt overrides, repository config, and full snapshot payloads independently.
- Contract-first shaping uses `@openducktor/contracts` types while delegating reusable prompt/script and repo-default normalization to shared read-model/library helpers.

## Data & Control Flow
`use-settings-modal-save-orchestration.ts` builds or receives a draft snapshot, then calls `prepareSettingsSnapshotForSave()`. Snapshot preparation maps workspace repo configs through `prepareRepoConfigForSave()`, normalizes global git and reusable prompts, deduplicates/repairs autopilot rule action lists against `AUTOPILOT_EVENT_IDS`, and trims repo/worktree/script/prompt data before the host settings mutation receives the payload.

## Integration Points
- Consumed by `../use-settings-modal-save-orchestration.ts`
- Depends on `@openducktor/contracts` settings/autopilot schemas
- Depends on `@/state/read-models/settings-read-model` for reusable prompt and repo script normalization
- Depends on `@/lib/repo-agent-defaults` and `@/lib/target-branch` for repository save-shaping rules
