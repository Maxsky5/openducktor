import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./src/adapters/sqlite/drizzle",
  schema: "./src/adapters/sqlite/sqlite-task-store-schema.ts",
});
