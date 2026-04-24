# apps/desktop/src/state/operations/shared/

## Responsibility
Shared host/runtime mutation helpers used by workspace and agent-orchestrator operations.

## Design Patterns
Pure policy and adapter helpers stay here: permission rules, prompt overrides, runtime catalog, runtime readiness publication, and host access wrappers.

## Data & Control Flow
Feature-specific operations call into these helpers to resolve policy, merge prompt overrides, or publish runtime readiness without duplicating logic.

## Integration Points
`host.ts`, `permission-policy.ts`, `prompt-overrides.ts`, `runtime-catalog.ts`, and `runtime-readiness-publication.ts`.
