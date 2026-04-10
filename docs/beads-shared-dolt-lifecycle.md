# Beads, Dolt, And OpenDucktor

## Overview

OpenDucktor uses **Beads** to store tasks and workflow metadata locally for each repository.
Beads itself uses **Dolt** as its database engine.

That means OpenDucktor needs two things to work well:

- a Beads attachment for each repository
- a Dolt database that Beads can read and write

The important design choice is that OpenDucktor does **not** run one Dolt process per repository.
Instead, it runs **one shared local Dolt server per OpenDucktor config directory** and gives each repository its own database inside that server.

This gives us:

- low process count
- predictable startup and shutdown
- one place to manage Dolt runtime state
- per-repo isolation without exposing Dolt internals to users

## What Beads Does

Beads is the task store.

In OpenDucktor, Beads is responsible for:

- tasks
- task status
- labels and priorities
- task metadata
- agent-authored documents such as spec, plan, and QA reports

OpenDucktor treats Beads as the persisted source of truth for task workflow state.

## Why Dolt Is Involved

Beads stores its structured task data in Dolt.

OpenDucktor therefore has to make sure a Dolt database exists for each repository and that Beads can connect to it.

We use Dolt because it is the database backend Beads is built around. OpenDucktor does not use Dolt for its own sake; it uses Dolt because Beads needs it.

## How OpenDucktor Embeds Them

OpenDucktor wraps Beads and Dolt behind its own lifecycle.

From the user point of view:

- you open a repository in OpenDucktor
- OpenDucktor makes sure the Beads attachment exists
- OpenDucktor makes sure the shared Dolt server is running
- OpenDucktor makes sure the repository's Dolt database exists inside that shared server
- after that, task reads and writes go through Beads normally

Users should not have to choose between Dolt modes or understand how Dolt is started.

## Storage Layout

For a config directory such as `~/.openducktor` or a custom `OPENDUCKTOR_CONFIG_DIR`, OpenDucktor stores Beads and Dolt under one managed root:

```text
<config-root>/
  beads/
    <repo-id>/
      .beads/
        metadata.json
        config.yaml
        backup/
        interactions.jsonl
    shared-server/
      server.json
      server.lock
      dolt-config.yaml
      .doltcfg/
      dolt/
        <database-name>/
```

There are two kinds of state here.

### Durable state

This is the part we want to survive app restarts:

- each repository's `.beads/` attachment
- the attachment metadata
- the attachment backup
- task interaction data

### Runtime state

This is the part OpenDucktor can recreate:

- the shared Dolt server process
- `server.json`
- `server.lock`
- the generated Dolt config file
- the live shared-server `dolt/` data root

That difference matters a lot.

If the shared server state is wiped, that should not mean the repository itself has to be reinitialized from scratch.

## One Repository, Two Names

OpenDucktor derives two different identifiers from the same repo path.

### Attachment id

Example:

```text
fairnest-265440cf
```

This is used for the filesystem directory under `beads/`.

It is meant to be short and stable.

### Dolt database name

Example:

```text
odt_fairnest_265440cf59ae
```

This is used inside the shared Dolt server.

It is more explicit and uses a longer hash suffix to reduce collisions.

The two names often look similar because they come from the same canonical repo path, but they serve different purposes and should not be confused.

## Shared Dolt Server Model

There is one shared Dolt server per config root.

If you run OpenDucktor against:

- `~/.openducktor`
- `~/.openducktor-local`

those are treated as two different environments and each gets its own shared Dolt server.

The server listens on `127.0.0.1` and uses a deterministic port derived from the config root. That keeps the route stable for one config directory while preventing different config roots from colliding with each other.

## How The Shared Dolt Server Starts

OpenDucktor starts the shared Dolt server lazily.

It does **not** start it as soon as the application launches. It starts it when something actually needs Beads storage.

The server command is:

```sh
dolt sql-server --config <shared-server-root>/dolt-config.yaml
```

OpenDucktor also performs a health check before treating the server as ready.

That check includes:

1. opening a TCP connection to the chosen port
2. running:

```sh
dolt --host 127.0.0.1 --port <port> --no-tls -u root -p '' sql -q "show databases"
```

This makes sure the server is not just listening, but actually ready to answer Dolt SQL requests.

## How Ownership Works

OpenDucktor records which app process currently owns the shared Dolt server.

If a healthy shared server already exists, a later app instance reuses it.

If the original owner process is gone but the server is still healthy, the new app instance adopts ownership.

This prevents two problems:

- starting unnecessary duplicate Dolt servers
- leaving a reused server orphaned forever because no current process believes it owns it

## How OpenDucktor Talks To Beads

OpenDucktor runs Beads commands with an explicit environment that points Beads at:

- the repository's durable attachment directory
- the shared Dolt host and port
- the shared Dolt user

The important point is that OpenDucktor does **not** run Beads commands from the repository root.

Instead, it runs them from the attachment root under the OpenDucktor config directory.

That is deliberate.

It avoids writing Beads side effects or agent integration files into the repository itself.

## What Happens When You Open A Repo

At a high level, OpenDucktor does this:

1. resolve the repository's attachment directory
2. ensure the shared Dolt server is running
3. check whether a Beads attachment already exists
4. if it exists, verify that it points at the expected shared Dolt database
5. if it does not exist, create it
6. if the attachment exists but the shared Dolt database is missing, recreate that database from the attachment backup

That is the normal lifecycle.

## Verification For An Existing Attachment

When an attachment already exists, OpenDucktor verifies two things.

### 1. The attachment metadata

It checks that the attachment says:

- backend is Dolt
- mode is server
- host is the current shared Dolt host
- port is the current shared Dolt port
- user is the current shared Dolt user
- database name is the exact database OpenDucktor expects for this repo

### 2. The Beads CLI can resolve it

OpenDucktor runs:

```sh
bd where --json
```

This confirms that Beads itself can open the attachment and that it resolves to the expected `.beads` directory.

If both checks pass, the repository is ready.

## What Happens For A Brand-New Attachment

If there is no existing Beads footprint yet, OpenDucktor creates one with:

```sh
bd init \
  --server \
  --server-host 127.0.0.1 \
  --server-port <shared-server-port> \
  --server-user root \
  --quiet \
  --skip-hooks \
  --skip-agents \
  --prefix <repo-slug> \
  --database <database-name>
```

Why these flags matter:

- `--server` and the server route flags force shared-server mode
- `--quiet` keeps initialization noise down
- `--skip-hooks` avoids running repository hooks during internal setup
- `--skip-agents` avoids Beads adding agent integration side effects during internal setup
- `--prefix` gives the repo stable Beads issue ids
- `--database` binds the attachment to the exact shared Dolt database OpenDucktor expects

## What Happens If The Shared Database Is Missing

This is the situation where the attachment still exists, but the runtime Dolt database is gone. For example, the `shared-server/` directory was deleted.

OpenDucktor treats that as missing runtime infrastructure, not as repository corruption.

It restores the missing database from the durable attachment backup with:

```sh
dolt backup restore file://<attachment-dir>/backup <database-name>
```

This is why the attachment backup matters.

The attachment is the durable representation of the repo's task store. The shared Dolt database is the live runtime copy that can be recreated from it.

## What Happens If Verification Fails For Other Reasons

If the attachment exists but fails verification for reasons other than a missing shared database, OpenDucktor currently uses:

```sh
bd doctor --fix --yes
```

That is the generic attachment-repair path.

## Everyday Beads Commands OpenDucktor Uses

After initialization, most work is ordinary Beads task I/O.

Examples of commands OpenDucktor runs during normal operation:

- `bd list --all --limit 0 --json`
- `bd list --limit 0 --json`
- `bd list --status closed --closed-after <date> --limit 0 --json`
- `bd show --id <task-id> --json`
- `bd create ...`
- `bd update ...`
- `bd delete --force [--cascade] -- <task-id>`
- `bd config set status.custom spec_ready,ready_for_dev,ai_review,human_review`

The custom status command is needed because OpenDucktor adds workflow states on top of Beads' built-in statuses.

## How MCP Fits In

When OpenDucktor launches its MCP sidecar for OpenCode, it passes only the host bridge context the MCP actually uses:

- repo path
- host bridge URL

The Rust host owns the Beads attachment directory, shared Dolt connection details, attachment verification, repair, and all task reads and writes.

The MCP sidecar no longer connects to Dolt or runs Beads directly. In desktop-managed mode the host injects a loopback `ODT_HOST_URL`, and the MCP forwards task, document, and workflow calls back to the running host. Standalone MCP use auto-discovers running host bridge ports from the local registry and can still use `ODT_HOST_URL` as an explicit override.

## What Happens On App Exit

When OpenDucktor shuts down, it cleans up runtime processes in order:

1. pending OpenCode startup processes
2. dev servers
3. active run children
4. active runtime children
5. the shared Dolt server, if the current app instance owns it

On desktop close, the window is hidden first and cleanup finishes in the background so the UI does not feel frozen while shutdown runs.

## Why This Design Exists

OpenDucktor uses this model because it balances a few goals that matter at the same time:

- Beads stays the persisted task source of truth
- users do not have to think about Dolt internals
- one config root gets one shared Dolt server, not one server per repo
- repositories stay isolated through database naming, not extra processes
- durable repo state and disposable runtime state are kept separate
- repo working trees are not modified by internal Beads setup

In short:

- **Beads** is the task system
- **Dolt** is the database engine behind it
- **OpenDucktor** owns the lifecycle around both so the setup stays lightweight and mostly invisible

## Related Docs

- `docs/architecture-overview.md`
- `docs/external-mcp.md`
- `packages/openducktor-mcp/README.md`
