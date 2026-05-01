# packages/frontend/src/state/operations/shared/

## Responsibility
Shared host/runtime mutation helpers used by workspace and agent-orchestrator operations.

## Design Patterns
Pure policy and adapter helpers stay here: permission rules, prompt overrides, runtime catalog, runtime readiness publication, runtime attachment retry, and host access wrappers.

## Data & Control Flow
Feature-specific operations call into these helpers to resolve policy, merge prompt overrides, publish runtime readiness, or retry runtime attachment without duplicating logic.

## Integration Points
`host.ts`, `permission-policy.ts`, `prompt-overrides.ts`, `runtime-catalog.ts`, `runtime-readiness-publication.ts`, and `runtime-attachment-retry.ts`.
