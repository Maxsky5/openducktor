# Dependency hygiene

Dependabot proposes version updates and security fixes. Knip finds unused dependencies and exports. Both checks run because neither replaces the other.

## Pull request gate

Run the full gate with:

```sh
bun run deps:check
```

The gate runs on pull requests and pushes to `main`. It includes:

- `bun run deps:audit`, which applies the high-severity and Hono policies to one audit response
- `bun run deps:unused:deps`
- `bun run deps:unused:exports`

The workflow is `.github/workflows/dependency-hygiene.yml`.

## Unused code checks

`bun run deps:unused:deps` runs Knip for dependencies in all `@openducktor/*` workspaces.

`bun run deps:unused:exports` runs Knip for exports in those workspaces. Use `bun run deps:unused:exports:report` only when a workflow must publish a report despite findings. Do not use the report command as a blocking gate.

- Add a short reason beside each intentional Knip exclusion.
- Do not export production code only for a test. Test it through public behavior or keep the helper in test code.
- Remove `export` when a symbol is used only in its own file.

## Security checks

`bun run deps:audit` fails when one `bun audit --json` response reports a high or critical advisory. It also fails if GHSA-`xh87-mx6m-69f3` or GHSA-`v8w9-8mx6-g223` returns. `hono` must resolve to `>=4.12.7`.

The audit request fails with a transport error after 30 seconds instead of waiting for Bun's default idle timeout.

## Update reports

Dependabot reads `.github/dependabot.yml`. It checks the Bun workspace and GitHub Actions each week. It groups patch and minor updates.

`bun run deps:outdated` lists packages that can be updated. `.github/workflows/dependency-hygiene-report.yml` publishes this list and the unused-export report each week.

## Update rules

- Put routine patch and minor updates in a dependency refresh pull request.
- Put each major update in a separate pull request. Read its release notes and run focused tests.
- Process an urgent security advisory at once.
- After an update, run `bun run typecheck`, `bun run test`, and `bun run build`.
