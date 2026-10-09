import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "./drizzle/meta/_journal.json";

test("upgrades saved choices without changing session data or task JSON order", () => {
  const database = new Database(":memory:");
  const sql = (tag: string) =>
    readFileSync(new URL(`./drizzle/${tag}.sql`, import.meta.url), "utf8");
  try {
    for (const entry of journal.entries.slice(0, -1)) database.exec(sql(entry.tag));
    const sessions = [
      { id: "codex-on", runtimeKind: "codex", fastMode: 1, speed: "priority" },
      { id: "codex-off", runtimeKind: "codex", fastMode: 0, speed: "standard" },
      { id: "claude-on", runtimeKind: "claude", fastMode: 1, speed: "fast" },
      { id: "claude-off", runtimeKind: "claude", fastMode: 0, speed: "standard" },
      { id: "unknown", runtimeKind: "claude", fastMode: null, speed: null },
    ];
    const metadata = {
      execution_target_json: JSON.stringify({ kind: "local_repo_root", workingDirectory: "/repo" }),
      role_snapshot_json: JSON.stringify({ name: "Builder" }),
      selected_model_json: JSON.stringify({
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "model",
      }),
      generated_title: "Generated title",
      manual_title: "Keep title",
      created_at_ms: 100,
      last_activity_at_ms: 200,
      updated_at_ms: 300,
      archived_at_ms: 400,
    };
    const insert = database.query(`INSERT INTO workspace_sessions
      (id, runtime_kind, external_session_id, execution_target_json, role_snapshot_json,
       selected_model_json, generated_title, manual_title, created_at_ms, last_activity_at_ms,
       updated_at_ms, archived_at_ms, fast_mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const session of sessions)
      insert.run(
        session.id,
        session.runtimeKind,
        session.id,
        metadata.execution_target_json,
        metadata.role_snapshot_json,
        metadata.selected_model_json,
        metadata.generated_title,
        metadata.manual_title,
        metadata.created_at_ms,
        metadata.last_activity_at_ms,
        metadata.updated_at_ms,
        metadata.archived_at_ms,
        session.fastMode,
      );
    const taskSessions = [
      {
        sessionId: "codex",
        runtimeKind: "codex",
        fastMode: true,
        selectedModel: { modelId: "model" },
      },
      { sessionId: "claude", runtimeKind: "claude", fastMode: true },
      { sessionId: "off", runtimeKind: "codex", fastMode: false },
      { sessionId: "unknown", runtimeKind: "claude", fastMode: null },
      { sessionId: "legacy", runtimeKind: "codex", lastActivityAt: "keep" },
    ];
    database
      .query(`INSERT INTO tasks
      (id, title, status, issue_type, priority, qa_required, labels_json, agent_sessions_json, created_at_ms, updated_at_ms)
      VALUES ('task', 'Keep task', 'open', 'task', 2, 1, '[]', ?, 100, 300)`)
      .run(JSON.stringify(taskSessions));
    database.exec(sql("0007_session_speed"));
    for (const session of sessions)
      expect(
        database.query("SELECT * FROM workspace_sessions WHERE id = ?").get(session.id),
      ).toEqual({
        id: session.id,
        runtime_kind: session.runtimeKind,
        external_session_id: session.id,
        ...metadata,
        speed: session.speed,
      });
    const task = database
      .query<{ agent_sessions_json: string; title: string; updated_at_ms: number }, []>(
        "SELECT agent_sessions_json, title, updated_at_ms FROM tasks",
      )
      .get()!;
    expect(JSON.parse(task.agent_sessions_json)).toEqual([
      {
        sessionId: "codex",
        runtimeKind: "codex",
        speed: "priority",
        selectedModel: { modelId: "model" },
      },
      { sessionId: "claude", runtimeKind: "claude", speed: "fast" },
      { sessionId: "off", runtimeKind: "codex", speed: "standard" },
      { sessionId: "unknown", runtimeKind: "claude", speed: null },
      taskSessions[4],
    ]);
    expect(task.title).toBe("Keep task");
    expect(task.updated_at_ms).toBe(300);
    expect(
      database
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'workspace_sessions'",
        )
        .all()
        .map((row) => row.name),
    ).toEqual(
      expect.arrayContaining([
        "idx_workspace_sessions_runtime_identity",
        "idx_workspace_sessions_active_updated",
      ]),
    );
    expect(() => database.run("UPDATE workspace_sessions SET speed = ' '")).toThrow();
    database.run("UPDATE workspace_sessions SET speed = 'future-speed' WHERE id = 'codex-on'");
    expect(
      database.query("SELECT speed FROM workspace_sessions WHERE id = 'codex-on'").get(),
    ).toEqual({ speed: "future-speed" });
  } finally {
    database.close();
  }
});
