# Configure a Git provider during workspace creation

## Setup flow

Workspace creation uses four stages: Repository, Git provider, Workspace details, and Models. First-workspace onboarding and the Open repository dialog use the same flow. Reopening an existing workspace keeps its saved provider settings.

Select an existing local Git repository. OpenDucktor checks all fetch and effective push URLs. It detects GitHub at `github.com` and supported Azure DevOps Services and Server URLs. It leaves distinct identities or providers unselected. Enter a custom GitHub host or an unsupported clone alias manually.

Review the detected identity before you continue. An enabled integration must pass connection, repository access, and remote mapping checks. Detection alone does not prove that the integration is ready. Several remotes can identify one repository while failing its publish mapping check.

Retry detection keeps manual provider choices, repository details, and the enabled state. Use detected repository accepts the displayed identity while keeping the enabled state.

Choose Skip Git provider setup or No provider to create the workspace without an integration. A disabled provider can retain valid details without authentication. Correct or clear partly entered identity fields and mappings. You can change provider settings later in Settings.

## Azure connections

Azure DevOps Services supports Microsoft device-code sign-in and personal access tokens. Azure DevOps Server uses a personal access token. An HTTP Server connection requires consent for its exact collection address before OpenDucktor sends credentials. Changing the address clears that consent.

The work item area is optional for workspace creation. Work item imports need an area. Load areas after you connect, or set the area later in Settings.

## Saving and cancellation

Provider setup does not register a workspace. The host holds the setup session, staged credentials, and Microsoft token cache in memory. Cancel, skip, disable, or an identity change releases the connection owned by that setup. A cleanup failure keeps setup open for retry.

The final action saves workspace details, provider settings, and model defaults together through the existing settings service. It then transfers accepted Azure credentials to the existing protected workspace scope. It does not replace credentials that already exist in that scope.

If credential transfer fails after the settings write, the workspace already exists. The form shows the saved progress and retries the same workspace. Read saved creation progress after an uncertain transport response. Do not start a second creation to recover the first one.

Setup sessions last only for the current host process. A host restart clears unsaved setup credentials. A workspace saved before a later failure remains registered; review its connection in Settings.

## Implementation boundaries

The `workspace_provider_setup_*` command family owns temporary setup operations. Reads use TanStack Query without background polling. Microsoft sign-in updates use `openducktor://workspace-provider-setup-updated` through the existing Electron IPC and browser SSE transports. Setup IDs, configuration revisions, fingerprints, and attempt IDs keep each update tied to its owner.

The flow uses existing repository configuration and protected credential formats. It adds no durable setup record, database migration, Git remote change, or public ODT tool.
