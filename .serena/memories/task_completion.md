# Task Completion

- Before finishing code work, run the narrowest decisive checks for touched areas, then broaden when contracts/shared behavior/user-facing workflows changed.
- Root checks: `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` when blast radius justifies full validation.
- Focused checks use Bun filters, e.g. `bun run --filter @openducktor/frontend test`, `bun run --filter @openducktor/host typecheck`, `bun run --filter @openducktor/electron lint`.
- Frontend changes require relevant frontend tests for touched behavior. Use isolated Query clients/providers in tests that need them.
- Host/core/adapters/MCP changes require deep tests around typed errors, ports, command routing, lifecycle, and contract boundaries.
- Contract/schema changes require updating consumers across contracts -> core/host/adapters -> frontend and running focused typecheck/tests for all affected workspaces.
- Browser-mode UI validation: ask the user to start `bun run browser:dev`, then connect with browser automation. Do not start `browser:dev` yourself.
- When chasing flakes, run verification sequentially, not in parallel, to avoid Bun process/resource contention hiding the real failure.
- Use Conventional Commits for commits.
- After Serena onboarding/memory changes, run `serena memories check` from the project root to check memory references.