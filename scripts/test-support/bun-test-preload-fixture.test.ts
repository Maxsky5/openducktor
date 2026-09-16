import { expect, test } from "bun:test";

test("uses a temporary config directory", () => {
  const configDir = process.env.OPENDUCKTOR_CONFIG_DIR;
  expect(configDir).toBeTruthy();
  console.log(`test config: ${configDir}`);
});
