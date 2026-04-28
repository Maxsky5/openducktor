# apps/desktop/src-tauri/crates/host-domain/src/runtime/registry/

## Responsibility
Runtime registry contracts and built-in runtime definitions.

## Design
- `mod.rs`: registry facade, stable public re-exports, `RuntimeDefinition`, `RuntimeRegistry`, and built-in registry accessors.
- `kind.rs`: runtime kind identifier newtype.
- `capabilities.rs`: runtime capability enums, capability structs, required workflow scopes, and capability-level validation.
- `descriptor.rs`: runtime descriptor shape plus descriptor-level validation for read-only blocked tools and ODT workflow aliases.
- `startup.rs`: runtime startup readiness timing config.
- `odt_tools.rs`: Rust mirror of canonical ODT workflow tool names.
- `opencode.rs`: built-in OpenCode runtime descriptor and alias generation.
- `tests.rs`: registry, descriptor, fixture parity, and validation tests.

## Integration
The parent runtime module re-exports the public registry surface for host-domain consumers. Keep submodules private and preserve serialized descriptor shape when changing this module.
