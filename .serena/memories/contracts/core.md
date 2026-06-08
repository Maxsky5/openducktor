# Contracts Core

- Location: `packages/contracts`; public TypeScript/Zod contract source for runtime schemas, IPC/host payloads, task schemas, config schemas, git schemas, MCP schemas, and shared exported types.
- Zod remains the public schema source until an ADR changes it. Do not duplicate public contracts in Effect Schema.
- Contract changes should be made here first, then propagated through core/host/adapters/frontend.
- Task action and task status schemas live in `packages/contracts/src/task-schemas.ts`.
- Host-visible runtime/run payloads live in `packages/contracts/src/run-schemas.ts` and runtime descriptors/capabilities in `packages/contracts/src/agent-runtime-schemas.ts`.
- `RuntimeInstanceSummary` is live runtime-instance metadata only; do not reintroduce top-level endpoint/port or duplicate capabilities there.
- Request-scoped agent operations use `runtimeConnection` objects, not raw shared runtime endpoint strings. Adapter-local client inputs are built at adapter boundaries.
- Persisted session records/documents must not store live runtime route data such as runtime endpoint, base URL, runtime transport, or transient live interaction state.