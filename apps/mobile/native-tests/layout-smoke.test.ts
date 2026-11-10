import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";

const { values } = parseArgs({
  options: {
    platform: { type: "string" },
    device: { type: "string" },
    session: { type: "string" },
    workspace: { type: "string" },
    "empty-workspace": { type: "string" },
    "task-title": { type: "string" },
    "chat-title": { type: "string" },
    output: { type: "string" },
    profile: { type: "string" },
  },
});
const platform = values.platform;
assert(platform === "ios" || platform === "android", "Set --platform ios or android.");
for (const key of [
  "device",
  "session",
  "workspace",
  "empty-workspace",
  "task-title",
  "chat-title",
  "output",
] as const) {
  assert(values[key], `Set --${key}. See README.md#native-layout-smoke-check.`);
}
const device = values.device!;
assert(
  platform !== "android" || device.startsWith("emulator-"),
  "Use an isolated Android emulator.",
);
const output = resolve(values.output!);
await mkdir(output, { recursive: false });
const app = "com.openducktor.mobile";
type Rect = { x: number; y: number; width: number; height: number };
type Node = {
  index: number;
  parentIndex?: number;
  depth: number;
  ref: string;
  kind: string;
  label?: string;
  value?: string;
  rect: Rect;
  hittable?: boolean;
  selected?: boolean;
};
const results: { profile: string; checkpoint: string }[] = [];
let profile = "setup";

async function run(...args: string[]): Promise<{ nodes?: Node[]; visible?: boolean }> {
  const child = Bun.spawn(["agent-device", ...args, "--session", values.session!, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(45_000),
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(code, 0, `${args[0]} failed: ${stderr || stdout}`);
  const result = JSON.parse(stdout);
  assert(result.success, JSON.stringify(result.error));
  return result.data;
}
async function snapshot(): Promise<Node[]> {
  const { nodes } = await run("snapshot", "-i");
  assert(nodes, "Native snapshot returned no nodes.");
  return nodes;
}
function find(nodes: Node[], predicate: (node: Node) => boolean): Node {
  const node = nodes.find(
    (n) => n.hittable !== false && n.rect.width > 0 && n.rect.height > 0 && predicate(n),
  );
  assert(node, `Missing native target in ${profile}.`);
  return node;
}
async function press(label: string): Promise<void> {
  await run("press", `label=${JSON.stringify(label)} hittable=true`, "--settle");
}
async function prefix(label: string): Promise<void> {
  const raw = await run("snapshot", "-i", "--raw");
  assert(raw.nodes, "Native snapshot returned no nodes.");
  const node = find(raw.nodes, (n) => n.kind === "button" && n.label?.startsWith(label) === true);
  await run("press", `role=button label=${JSON.stringify(node.label)} hittable=true`, "--settle");
}
async function wait(label: string): Promise<void> {
  await run("wait", `label=${JSON.stringify(label)}`, "10000");
}
async function capture(checkpoint: string): Promise<void> {
  await writeFile(
    resolve(output, `${profile}-${checkpoint}.json`),
    JSON.stringify(await snapshot(), null, 2),
  );
  const pngPath = resolve(output, `${profile}-${checkpoint}.png`);
  await run("screenshot", pngPath);
  const png = Buffer.from(await Bun.file(pngPath).arrayBuffer());
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (checkpoint !== "failed") {
    const expectedLandscape =
      profile.endsWith("landscape-left") !== (checkpoint === "rotated-board");
    assert.equal(
      width > height,
      expectedLandscape,
      `${checkpoint}: expected ${expectedLandscape ? "landscape" : "portrait"}, captured ${width}x${height}.`,
    );
  }
  results.push({ profile, checkpoint });
  await writeFile(resolve(output, "checks.json"), JSON.stringify(results, null, 2));
  console.log(`${profile}: ${checkpoint}`);
}
async function workspace(name: string): Promise<void> {
  await prefix("Workspace ");
  const raw = await run("snapshot", "-i", "--raw");
  const row = raw.nodes?.find((n) => n.kind === "button" && n.label?.startsWith(`${name}, `));
  assert(row, `QA workspace ${name} is not open on the host.`);
  await scrollTo(row.label!);
  await prefix(`${name}, `);
  await wait(`Workspace ${name}`);
}
async function scrollTo(label: string): Promise<void> {
  if (platform === "android") {
    await run(
      "scroll",
      "down",
      "--until",
      `label=${JSON.stringify(label)} hittable=true`,
      "--settle",
    );
    return;
  }
  // Default iOS scrolling can select the board behind a sheet. Use the target's own scroll area.
  for (let pass = 0; pass < 8; pass++) {
    const raw = await run("snapshot", "-i", "--raw");
    assert(raw.nodes, "Native snapshot returned no nodes.");
    const target = raw.nodes
      .filter((n) => n.label === label && n.kind !== "text")
      .sort((a, b) => b.depth - a.depth)[0];
    assert(target, `Missing scroll target ${label}.`);
    const nodes = new Map(raw.nodes.map((n) => [n.index, n]));
    let parent = nodes.get(target.parentIndex!);
    while (parent && parent.kind !== "scroll-area") parent = nodes.get(parent.parentIndex!);
    const inside =
      !parent ||
      (target.rect.x >= parent.rect.x - 1 &&
        target.rect.y >= parent.rect.y - 1 &&
        target.rect.x + target.rect.width <= parent.rect.x + parent.rect.width + 1 &&
        target.rect.y + target.rect.height <= parent.rect.y + parent.rect.height + 1);
    if (target.hittable && inside && target.rect.width > 0 && target.rect.height > 0) return;
    assert(parent, `Scroll area for ${label} is missing.`);
    const { x, y, width, height } = parent.rect;
    const above = target.rect.y < y;
    const overflow = above ? y - target.rect.y : target.rect.y + target.rect.height - y - height;
    // The native scroll view consumes about 10 points before it starts moving.
    const distance = Math.ceil(Math.min(height * 0.6, Math.max(1, overflow) + 12));
    await run(
      "gesture",
      "pan",
      String(Math.round(x + width * 0.92)),
      String(Math.round(y + height * (above ? 0.2 : 0.8))),
      "0",
      String(above ? distance : -distance),
      "600",
    );
    await run("wait", "stable", "300", "5000");
  }
  throw new Error(`Could not reach ${label} in its native scroll area.`);
}
async function board(): Promise<void> {
  await wait(`Start Builder for ${values["task-title"]}`);
  const nodes = await snapshot();
  const title = find(nodes, (n) => n.label === `Workspace ${values.workspace}`);
  const search = find(nodes, (n) => n.label === "Search");
  const center = (r: Rect) => r.y + r.height / 2;
  assert(
    Math.abs(center(title.rect) - center(search.rect)) < search.rect.height / 2,
    "Workspace picker must share the native header row with Search.",
  );
  find(nodes, (n) => n.label === "Filters");
  if (platform === "android") {
    const action = find(nodes, (n) => n.label === `Start Builder for ${values["task-title"]}`);
    const children = nodes.filter((n) => n.parentIndex === action.index && n.kind === "text");
    assert(children.length > 0, "Android must expose the rendered action text geometry.");
    const top = Math.min(...children.map((n) => n.rect.y));
    const bottom = Math.max(...children.map((n) => n.rect.y + n.rect.height));
    assert(
      Math.abs((top + bottom) / 2 - center(action.rect)) <= 2,
      `Task action content is not vertically centered: button=${JSON.stringify(action.rect)}, content=${top}..${bottom}`,
    );
  }
}
async function inputField(): Promise<Node> {
  return find(await snapshot(), (n) => ["search", "text-field", "text-view"].includes(n.kind));
}
async function replaceInput(text: string): Promise<void> {
  if (platform === "ios") {
    await run("fill", `@${(await inputField()).ref}`, text, "--settle");
    return;
  }
  // agent-device 0.21.36 fill enables auto-rotation. ADB keeps the real keyboard and rotation lock.
  const input = (...args: string[]) => {
    const result = Bun.spawnSync(["adb", "-s", device, "shell", "input", ...args]);
    assert.equal(result.exitCode, 0, result.stderr.toString());
  };
  assert.match(text, /^[a-zA-Z0-9 .-]*$/, "The ADB test strings must use plain ASCII.");
  input("keycombination", "113", "29");
  input("keyevent", "67");
  if (text) input("text", text.replaceAll(" ", "%s"));
}
async function openDetails(): Promise<void> {
  const card = find(
    await snapshot(),
    (n) => n.kind === "button" && n.label?.startsWith(`${values["task-title"]}, `) === true,
  );
  // The card's center overlaps its footer action in landscape. Its title has no separate AX node.
  await run(
    "press",
    String(card.rect.x + card.rect.width / 2),
    String(card.rect.y + card.rect.height / 4),
    "--settle",
  );
  await scrollTo(`Edit ${values["task-title"]}`);
  await wait(`Edit ${values["task-title"]}`);
}
async function keyboardVisible(): Promise<void> {
  if (platform === "android") {
    assert((await run("keyboard", "status")).visible, "The real Android keyboard must be visible.");
  } else {
    assert(
      (await run("snapshot")).nodes?.some((n) => n.kind === "keyboard"),
      "The native iOS keyboard must be visible.",
    );
  }
}
async function selectLane(name: string): Promise<void> {
  // Regular iOS snapshots can merge a tab's label into its scroll ancestors at large text.
  const raw = await run("snapshot", "-i", "--raw");
  const tabs = raw.nodes?.filter(
    (n) =>
      n.label?.startsWith(`${name}, `) &&
      n.hittable !== false &&
      n.rect.width > 0 &&
      n.rect.height > 0,
  );
  const tab = tabs?.sort((a, b) => b.depth - a.depth)[0];
  assert(tab, `Missing ${name} tab.`);
  await run("press", `@${tab.ref}`, "--settle");
  const selected = await run("snapshot", "-i", "--raw");
  assert(
    selected.nodes?.some((n) => n.label?.startsWith(`${name}, `) && n.selected),
    "The selected lane must change.",
  );
}
async function search(): Promise<void> {
  const card = find(
    await snapshot(),
    (n) => n.kind === "button" && n.label?.startsWith(`${values["task-title"]}, `) === true,
  );
  await press("Search");
  await replaceInput("odt-layout-smoke-no-match");
  await keyboardVisible();
  await capture("search-keyboard");
  // Android's landscape IME can own the screen. Submit before checking the board behind it.
  await run("keyboard", "enter");
  await wait("Clear the search and filters");
  await run("wait", "absent", `label=${JSON.stringify(card.label)}`, "10000");
  await capture("search-results");
  await run("press", `@${(await inputField()).ref}`, "--settle");
  await replaceInput("");
  await run("keyboard", platform === "android" ? "dismiss" : "enter");
  await press(platform === "ios" ? "close" : "Close search");
  await board();
}
async function chat(): Promise<void> {
  await press("Sessions");
  await press(values.workspace!);
  await prefix(`${values["chat-title"]}, `);
  await wait("Send message");
  const field = await inputField();
  assert(!field.value, "Use a dedicated QA chat with an empty draft.");
  try {
    await run("press", `@${field.ref}`, "--settle");
    await replaceInput("Layout smoke draft. Do not send.");
    await run("wait", "text", "Layout smoke draft. Do not send.", "10000");
    await run("wait", "stable", "300", "5000");
    await keyboardVisible();
    if (platform === "ios") {
      const nodes = await snapshot();
      const field = find(nodes, (n) => n.kind === "text-view" && n.label === "Message");
      const header = find(nodes, (n) => n.kind === "navigation-bar");
      assert(
        field.rect.y >= header.rect.y + header.rect.height - 1,
        "The message field must fit below the header while the keyboard is open.",
      );
      const predictions = nodes.find((n) => n.label === "Typing Predictions");
      assert(predictions, "Enable the native iOS predictive keyboard for this fixture.");
      const send = find(nodes, (n) => n.label === "Send message");
      const gap = predictions.rect.y - send.rect.y - send.rect.height;
      assert(gap >= -1 && gap <= 24, `Unexpected composer gap above the keyboard: ${gap}.`);
    }
    await capture("composer-keyboard");
    if (platform === "ios") {
      const keyboard = await run("snapshot");
      const key = find(keyboard.nodes!, (n) => n.kind === "key" && n.label?.toLowerCase() === "x");
      await run("press", `role=key label=${JSON.stringify(key.label)}`, "--settle");
      const continued = `Layout smoke draft. Do not send.${key.label}`;
      await run("wait", "text", continued, "10000");
      assert.equal((await inputField()).value, continued);
    }
  } finally {
    if (platform === "ios") await keyboardVisible();
    await replaceInput("");
  }
  // Back dismisses Android's real keyboard before leaving the screen.
  if (platform === "android") await run("keyboard", "dismiss");
  assert(!(await inputField()).value, "The QA draft must be empty after cleanup.");
  await capture("composer-cleared");
  await run("back", "--in-app", "--settle");
  await press("Tasks");
  await board();
}

await run(
  "open",
  app,
  "--foreground",
  "--platform",
  platform,
  platform === "ios" ? "--udid" : "--serial",
  device,
  "--no-test-ime",
);
if (platform === "android") {
  const ime = Bun.spawnSync([
    "adb",
    "-s",
    device,
    "shell",
    "settings",
    "get",
    "secure",
    "default_input_method",
  ]);
  assert.equal(ime.exitCode, 0, "Could not read the Android input method.");
  assert(
    !ime.stdout.toString().includes("agentdevice"),
    "Close the previous agent-device session to restore its real keyboard, then run with a fresh --session.",
  );
}
try {
  for (const theme of ["light", "dark"]) {
    for (const size of ["large", "accessibility-large"]) {
      for (const orientation of ["portrait", "landscape-left"]) {
        profile = `${theme}-${size}-${orientation}`;
        if (values.profile && profile !== values.profile) continue;
        await run("settings", "appearance", theme);
        await run("settings", "text-size", size);
        await run("orientation", orientation);
        await run("open", app, "--relaunch", "--no-test-ime");
        await wait("Tasks");
        await press("Tasks");
        await workspace(values.workspace!);
        await board();
        await capture("board");
        await run("orientation", orientation === "portrait" ? "landscape-left" : "portrait");
        await run("wait", "stable", "300", "5000");
        await board();
        await capture("rotated-board");
        await run("orientation", orientation);
        await run("wait", "stable", "300", "5000");
        await board();
        const feature = find(
          await snapshot(),
          (n) => n.kind === "button" && n.label?.startsWith("Start Spec for ") === true,
        );
        await press("Filters");
        await scrollTo("Bug");
        await press("Bug");
        await capture("filter-selected");
        await press(platform === "ios" ? "Done" : "Close");
        await run("wait", "absent", `label=${JSON.stringify(feature.label)}`, "10000");
        await wait(`Start Builder for ${values["task-title"]}`);
        await press("Clear the search and filters");
        await board();
        await search();
        await selectLane("Spec Ready");
        await selectLane("Backlog");
        await board();
        await press(`Start Builder for ${values["task-title"]}`);
        await scrollTo("Cancel");
        if (platform === "android") await run("scroll", "bottom", "--settle");
        await capture("workflow-form");
        await press("Cancel");
        await board();
        await openDetails();
        await capture("details");
        await run("back", "--in-app", "--settle");
        await board();
        await chat();
        await workspace(values["empty-workspace"]!);
        await wait("No tasks yet. Create a task or import issues from your Git provider.");
        await capture("empty-board");
        await workspace(values.workspace!);
        await board();
        await run("home");
        await run("open", app, "--foreground", "--no-test-ime");
        await board();
        await capture("foreground-return");
      }
    }
  }
  assert(results.length > 0, "No profile matched --profile.");
  console.log(
    `Native interaction and geometry checks passed. Review the PNGs in ${output} for clipping, contrast, cutouts and keyboard overlap before approving visual QA.`,
  );
} catch (error) {
  console.error(error);
  await capture("failed");
  throw error;
} finally {
  await run("settings", "appearance", "light");
  await run("settings", "text-size", "large");
  await run("orientation", "portrait");
}
