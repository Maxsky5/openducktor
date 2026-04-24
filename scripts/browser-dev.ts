const child = Bun.spawn({
  cmd: ["bun", "run", "--filter", "@openducktor/web", "dev"],
  cwd: new URL("..", import.meta.url).pathname,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
});

process.exit(await child.exited);
