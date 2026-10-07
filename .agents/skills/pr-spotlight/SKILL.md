---
name: pr-spotlight
description: Explain a PR's main changes with clear diagrams and short animations when motion adds information. Use when preparing a PR or asked to explain a diff visually.
---

# PR spotlight

Make the PR's purpose and changed behavior clear before reviewers read the implementation.

## Workflow

1. Read the PR title, description, commits, and complete changed-file list before choosing a subject. Inspect the relevant diff and source at both revisions. Read linked task specifications and plans when available; verify their claims against the final diff. Record the base and head SHA in `build/pr-spotlight/<topic>/evidence.md`. Group the changes by user or maintainer outcome and write one sentence for the PR's main change. Account for each major outcome in the planned visual or its caption. Keep implementation details secondary unless the user asks for a specific detail. Finish this step when the planned overview explains the PR's purpose, with a source for each claim.
2. Read [visual story](references/visual-story.md) and sketch the composition before writing a scene. Record its main claim, visible objects, relationships, and format in the evidence notes. Default to one overview PNG. Add a second for another major outcome or a comparison that needs two readable views. Choose video when motion explains timing, overlapping activity, or an interaction that stills cannot explain, or when the user requests video. State what motion adds. Use PR text when a visual adds no explanation.
3. Author the chosen composition, with a concrete example of the changed behavior. For Psychopomp scenes, read [scene authoring](references/scene-authoring.md), choose a matching template or compose a new layout, and save `scene.json` beside the evidence notes. Use short action labels and keep code identifiers in supporting captions when needed. Include exceptions that change the main outcome. Label schematics as diagrams and real captures as UI footage. For measurements, state the source, workload, platform, sample count, and units. Every visible claim must match the recorded source.
4. Validate and inspect the plan, then open the rendered media. Review each PNG at about 760 pixels wide. When delegation is available, give a fresh agent only the image and ask what changed, why it matters, and what is unclear. Otherwise make that check yourself without the PR body. Compare the answer with the main claim from step 1 and revise the scope or layout if they differ. Check readable labels, contrast, overlap, and actor identity using [visual story](references/visual-story.md). Use the same explicit `--theme` for all scene views. For video, inspect frames before, during, and after each transition with `--shutter`, then play the clip to check pacing and its final hold. Use `ffprobe` to check video encoding and file size. Finish when the overview communicates the main change and every visible claim has a source. State any check you could not run.
5. Return the chosen media, editable scene, evidence notes, and PR text with useful alt text and media links. Publish within the authorized PR workflow. Read the current PR body and preserve its text and attachments. If an upload or PR command fails, inspect the live PR before repeating it, because partial failures can leave a PR or uploaded media.

## Rendering

Run from the repository root. Setup needs Bun and a current stable Rust toolchain with Cargo. Video export needs FFmpeg with `ffprobe` and `libx264`. Frame and video rendering need a working GPU.

```sh
rtk bun .agents/skills/pr-spotlight/scripts/render.ts setup
rtk bun .agents/skills/pr-spotlight/scripts/render.ts --help
```

Run setup once per checkout. It compiles a pinned [Psychopomp](https://github.com/kitlangton/psychopomp) revision into `build/pr-spotlight/toolchain/`. The first build can take several minutes. Human contributors can omit `rtk` if they do not use it.

Use the helper's `--help` for command syntax. The pinned upstream binary treats `--help` as a video output path. Keep generated media in `build/pr-spotlight/<topic>/`.

## Media delivery

For video, use a short silent clip with one focal action per beat and still holds for reading. Render a 2 to 3 second transition window before the full clip. Use `encode` to create an MP4 within the size budget. Shorten the clip if compression makes text unreadable. Include a PNG summary for readers who cannot play the clip.

Follow [GitHub's attachment instructions](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli). Check `gh pr edit --help` for `--attach` before using it. CLI attachments need repository push access. Otherwise return the local files for the contributor to attach in GitHub. Include the editable scene and evidence notes in the handoff.
