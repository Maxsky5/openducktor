import { fileURLToPath } from "node:url";

export const runFixtureProcess = async ({
  args,
  fixtureUrl,
  homeDir,
}: {
  args: string[];
  fixtureUrl: URL;
  homeDir: string;
}): Promise<string> => {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
  delete environment.OPENDUCKTOR_CONFIG_DIR;
  const child = Bun.spawn({
    cmd: [process.execPath, fileURLToPath(fixtureUrl), ...args],
    env: environment,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`Fixture process exited with code ${exitCode}: ${stderr}`);
  }
  return stdout;
};
