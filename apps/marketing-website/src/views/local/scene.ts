import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import { mountLoop } from "../../motion/loop";
import { EASE } from "../../motion/tokens";
import { diagnosticsSection, sectionState, setRefreshing } from "../../replica/diagnostics/sheet";
import type { LocalTemplate } from "./diagnostics";

/**
 * The Diagnostics panel just after the app opens a repository. The checks of the CLI tools and
 * the task store end first. OpenDucktor starts each runtime in the repository, and each MCP
 * section waits for its runtime. Then the panel scrolls to the last runtime and the task store.
 * The markup holds the last frame.
 */
export function mountLocal(): void {
  mountLoop<LocalTemplate>(must(document, '[data-scene="local"]'), (scene) => {
    const root = must(scene.stage, "[data-root]");
    const loaded = (name: LocalTemplate) => sectionState(scene.template(name));
    const section = (selector: string) => diagnosticsSection(scene, root, selector);
    const runtime = (kind: string) => ({
      runtime: section(`[data-section="runtime"][data-runtime="${kind}"]`),
      mcp: section(`[data-section="mcp"][data-runtime="${kind}"]`),
    });
    const cli = section('[data-section="cli"]');
    const store = section('[data-section="store"]');
    const opencode = runtime("opencode");
    const codex = runtime("codex");
    const claude = section('[data-section="runtime"][data-runtime="claude"]');

    // Start: the checks load, and no runtime has started.
    cli.apply(loaded("cli-loading"));
    store.apply(loaded("store-loading"));
    for (const { runtime: server, mcp } of [opencode, codex]) {
      server.apply(loaded("runtime-loading"));
      mcp.apply(loaded("mcp-loading"));
    }
    claude.apply(loaded("runtime-loading"));
    setRefreshing(root, true);

    // Refresh Checks waits for the CLI tools and the task store. The runtimes start later.
    cli.change(cli.final, 0.6);
    store.change(store.final, 0.9);
    scene.at(0.9, () => setRefreshing(root, false));

    // Each MCP section waits until its runtime is ready. Then the server answers with its tools.
    opencode.runtime.change(loaded("runtime-starting"), 1.4);
    opencode.mcp.change(loaded("mcp-waiting"), 1.5);
    codex.runtime.change(loaded("runtime-starting"), 1.7);
    codex.mcp.change(loaded("mcp-waiting"), 1.8);
    claude.change(loaded("runtime-starting"), 2);
    opencode.runtime.change(opencode.runtime.final, 3);
    opencode.mcp.change(opencode.mcp.final, 3.6);
    codex.runtime.change(codex.runtime.final, 3.9);
    codex.mcp.change(codex.mcp.final, 4.5);

    // The panel scrolls to the end, and the last runtime is ready.
    const scrolled = 5.3;
    scene.at(scrolled, () =>
      scene.run(
        gsap.to(root, {
          scrollTop: root.scrollHeight - root.clientHeight,
          duration: 1.3,
          ease: EASE.move,
        }),
      ),
    );
    const ready = scrolled + 1.5;
    claude.change(claude.final, ready);
    scene.endAt(ready + 3);
  });
}
