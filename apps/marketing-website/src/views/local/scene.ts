import { must } from "../../motion/dom";
import { gsap } from "../../motion/gsap";
import { mountLoop } from "../../motion/loop";
import { EASE } from "../../motion/tokens";
import type { DiagStatusData } from "../../replica/diagnostics/model";
import { diagnosticsSheet } from "../../replica/diagnostics/sheet";
import {
  CHECKING,
  HEALTHY,
  RUNNING,
  RUNTIMES,
  STARTING,
  TOOLS,
  WORKSPACE_CHECKS,
} from "./diagnostics";

/** The last status of each check: the status of the markup. */
const FINAL = new Map<string, DiagStatusData>(
  [...RUNTIMES, ...TOOLS, ...WORKSPACE_CHECKS].map((check) => [check.id, check.status]),
);

/**
 * The Diagnostics panel just after the app starts. The checks of the tools and of the workspace
 * end first, and the host starts one shared runtime of each kind. When the last runtime is ready,
 * the overview says that everything works, and the panel scrolls to the workspace checks. The
 * markup holds the last frame.
 */
export function mountLocal(): void {
  mountLoop(must(document, '[data-scene="local"]'), (scene) => {
    const root = must(scene.stage, "[data-root]");
    const sheet = diagnosticsSheet(scene, root);
    const scroll = must(root, "[data-diag-scroll]");
    const steps = [
      { id: "path", at: 0.6 },
      { id: "git", at: 0.8 },
      { id: "repository-setup", at: 1 },
      { id: "task-store", at: 1.2 },
      { id: "mcp-bridge", at: 1.8 },
      { id: "opencode", at: 2.6 },
      { id: "codex", at: 3.2 },
      { id: "claude", at: 3.8 },
    ];

    // Start: the checks run, and the runtimes and the MCP bridge start.
    const starts = new Set(["opencode", "codex", "claude", "mcp-bridge"]);
    for (const { id } of steps) sheet.set(id, starts.has(id) ? STARTING : CHECKING);
    sheet.setOverview(RUNNING);
    sheet.setRefreshing(true);

    for (const { id, at } of steps) {
      const status = FINAL.get(id);
      if (!status) throw new Error(`The diagnostics have no check ${id}.`);
      sheet.finish(id, status, at);
    }
    scene.at(1.2, () => sheet.setRefreshing(false));
    const healthy = 4.2;
    sheet.overview(HEALTHY, healthy);

    // The panel scrolls to the checks of the workspace.
    const scrolled = healthy + 0.8;
    scene.at(scrolled, () =>
      scene.run(
        gsap.to(scroll, {
          scrollTop: scroll.scrollHeight - scroll.clientHeight,
          duration: 1.3,
          ease: EASE.move,
        }),
      ),
    );
    scene.endAt(scrolled + 4.5);
  });
}
