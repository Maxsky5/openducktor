import path from "node:path";

export const resolveSqliteHostDatabasePath = (configDir: string): string =>
  path.join(configDir, "database.sqlite");
