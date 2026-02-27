# Hexagonal Architecture Compliance and Test Hardening Plan (Verified)

## Objective
Align workflow policy/runtime behavior across layers and harden contract tests so policy drift and boundary regressions fail fast.

## Scope
- Core role/tool policy and tool normalization.
- MCP workflow schemas, registrations, and transition policy.
- Rust host workflow rules and command boundary behavior.
- Adapter boundary contracts (`adapters-tauri-host`, `adapters-opencode-sdk`).
- Documentation/runtime parity for workflow contracts.

This plan does **not** change business rules. It enforces existing rules consistently.

## Verification Snapshot (2026-02-27)
- `bun run --filter @openducktor/core test`: pass (15/15)
- `bun run --filter @openducktor/openducktor-mcp test`: pass (27/27)
- `bun run --filter @openducktor/adapters-tauri-host test`: pass (15/15)
- `bun run --filter @openducktor/adapters-opencode-sdk test`: pass (53/53)
- `cd apps/desktop/src-tauri && cargo test -p host-application`: pass (116/116)

## Corrected Findings
1. Previous status checkboxes were inaccurate:
   - `packages/core/src/services/workflow-contract-fixture.json` is not present.
   - `packages/core/src/types/agent-orchestrator.contract.test.ts` is not present.
   - `packages/openducktor-mcp/src/workflow-policy.contract.test.ts` is not present.
2. Source-of-truth references were partly wrong:
   - Role/tool allowlist is canonical in `packages/core/src/types/agent-orchestrator.ts`.
   - MCP tool registration is defined in `packages/openducktor-mcp/src/index.ts` (not `lib.ts`).
   - Transition rules are implemented in `packages/openducktor-mcp/src/workflow-policy.ts` and `apps/desktop/src-tauri/crates/host-application/src/app_service/workflow_rules.rs`.
   - `packages/core/src/services/odt-workflow-tools.ts` is tool normalization/selection logic, not transition rules.
3. Existing tests are good but still fragmented:
   - Strong behavior tests exist in MCP store tests, host app service tests, and adapter tests.
   - No single cross-layer invariant fixture currently proves policy/transition parity across TS and Rust.
4. Docs/runtime drift exists and should be treated as contract risk:
   - `docs/task-workflow-transition-matrix.md` omits currently supported `set_plan` from `ready_for_dev`.
   - The same doc uses non-`odt_*` tool names while runtime contracts are `odt_*`.

## Planned Work (Priority Order)

### P1 — Introduce a canonical workflow contract fixture
- Add a single fixture that captures:
  - role -> allowed tools
  - tool list (canonical `odt_*`)
  - transition matrix (including task/bug skip paths)
  - `set_spec` and `set_plan` allowed statuses
  - epic-subtask replacement allowed statuses
- Place it in a location consumable by TS tests and Rust tests (JSON is preferred).

Deliverables:
- One canonical, test-owned fixture used by all parity tests.

### P2 — Add cross-layer role/tool parity tests
- Add `packages/core/src/types/agent-orchestrator.contract.test.ts`:
  - assert `AGENT_ROLE_TOOL_POLICY` equals canonical fixture.
- Add MCP parity tests (recommended in `packages/openducktor-mcp/src/index.test.js`):
  - assert tool registration list in `index.ts` exactly matches `ODT_TOOL_SCHEMAS` keys.
  - assert schema keys and canonical fixture tool list are identical.

Deliverables:
- Fail-fast on tool rename/removal/allowlist drift across core and MCP.

### P3 — Add cross-layer transition parity tests
- Add `packages/openducktor-mcp/src/workflow-policy.contract.test.ts`:
  - assert transition acceptance/rejection parity against canonical fixture.
  - assert set_spec/set_plan and epic-subtask guards parity with fixture.
- Add Rust parity tests under `apps/desktop/src-tauri/crates/host-application`:
  - compare `allows_transition`, `can_set_spec_from_status`, `can_set_plan`, and `can_replace_epic_subtask_status` against the same fixture.

Deliverables:
- TS and Rust transition policy cannot diverge silently.

### P4 — Harden boundary and guardrail tests where coverage is still weak
- Extend existing test files instead of introducing parallel duplicate suites:
  - `packages/adapters-tauri-host/src/index.test.ts`
  - `packages/adapters-opencode-sdk/src/index.test.ts`
  - `apps/desktop/src-tauri/src/lib.rs` tests
- Focus additions:
  - explicit host command deserialization failures -> stable error envelope
  - MCP registration coverage for every schema tool
  - alias normalization rejection edge cases (malformed prefixed tool IDs)

Deliverables:
- Better boundary guarantees with less test duplication.

### P5 — Add docs/runtime contract parity checks (new)
- Update:
  - `docs/task-workflow-transition-matrix.md`
  - `docs/task-workflow-actions.md` (if needed for naming consistency)
- Align docs to current runtime behavior:
  - `set_plan` allowed from `ready_for_dev` for all supported issue types
  - canonical `odt_*` workflow tool names (or explicit alias section)
- Add a lightweight check/test that validates documented statuses/tools against the canonical fixture.

Deliverables:
- Documentation cannot drift away from runtime contracts unnoticed.

### P6 — Validation matrix and CI alignment
- Required non-frontend checks from AGENTS for this work:
  - `bun run typecheck`
  - `bun run test`
  - `cd apps/desktop/src-tauri && cargo check`
  - `cd apps/desktop/src-tauri && cargo test`
- Keep package-focused runs for faster iteration:
  - `bun run --filter @openducktor/core test`
  - `bun run --filter @openducktor/openducktor-mcp test`
  - `bun run --filter @openducktor/adapters-tauri-host test`
  - `bun run --filter @openducktor/adapters-opencode-sdk test`
  - `cd apps/desktop/src-tauri && cargo test -p host-application`

Deliverables:
- Test evidence captured in PR checklist with command output summary.

## Acceptance Criteria
- Any policy/transition drift across core, MCP, and host fails tests immediately.
- MCP tool registration and schema keys are guaranteed to match canonical fixture.
- Adapter boundary tests cover both success and error-path mapping.
- Docs and runtime contract are kept in sync by automated checks.
- Required AGENTS validation commands pass.

## Implementation Status (Verified 2026-02-27)
- [x] Baseline focused suites currently pass (core, MCP, adapters, host-application).
- [x] Canonical shared fixture implemented and consumed by TS + Rust tests.
- [x] Cross-layer role/tool parity tests implemented.
- [x] Cross-layer transition parity tests implemented.
- [x] Docs/runtime parity checks implemented.
- [x] AGENTS validation matrix executed successfully (`bun run typecheck`, `bun run test`, `cargo check`, `cargo test`).

## Risks and Mitigations
- Risk: brittle tests from overspecified fixtures.
  - Mitigation: fixture should encode behaviorally relevant policy only.
- Risk: duplicate constants continue to drift.
  - Mitigation: all policy assertions must consume one fixture.
- Risk: TS/Rust serialization differences for fixture ingestion.
  - Mitigation: use behavior-based assertions and normalize parsed values.
