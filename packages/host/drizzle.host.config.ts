import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./src/adapters/sqlite/drizzle-host",
  schema: [
    "./src/adapters/sqlite/sqlite-host-database-schema.ts",
    "./src/adapters/sqlite/sqlite-workspace-session-schema.ts",
    "./src/adapters/sqlite/sqlite-host-settings-schema.ts",
    "./src/adapters/sqlite/sqlite-runtime-settings-schema.ts",
    "./src/adapters/sqlite/sqlite-global-prompt-schema.ts",
  ],
});
