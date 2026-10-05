---
name: pr-spotlight
description: Explain PR changes with diagrams and short animations. Use when preparing a PR or asked to explain a diff visually.
---

# PR spotlight

Show the changed behavior with a visual that reviewers can check against the diff.

## Workflow

1. Inspect the diff and source at both revisions. Record the base and head SHA. Read linked task specifications and plans when available. Write the source for each visible claim in `build/pr-spotlight/<topic>/evidence.md`.
2. Choose a PNG for a structure or relationship. Choose a silent animation of about 10 to 40 seconds when order or a before/after transition matters. Use PR text when a visual adds no explanation. The storyboard must show the trigger, old behavior, new behavior, and scope. Show behavior before code. Keep one focal action per beat and hold still while the viewer reads.
3. Copy a template to `build/pr-spotlight/<topic>/scene.json` and edit it. Keep IDs for unchanged actors and code lines. Label shortened code as a condensed excerpt. Use real identifiers and at most 76 columns and 14 rows per excerpt. Include error or reset paths when they affect the story. Label the output as a diagram or captured UI footage. For measurements, state the source, workload, platform, sample count, and units. Every label and snippet must match the recorded source.
4. Validate and inspect the plan. Use the same explicit `--theme` for frames and video. Render and open frames before, during, and after each transition. Use `--shutter` for transition frames to check exported motion blur. Check text, overlap, actor identity, and readability at the PR display size. Render and play the clip to check pacing and its final hold. Use `ffprobe` to check the encoding and file size. Finish when every visible claim has a source and all frames and media pass these checks. State any check you could not run.
5. Return the PNG, optional MP4, editable scene, evidence notes, and PR text with useful alt text and media links. Publish within the authorized PR workflow. Read the current PR body and preserve its text and attachments. If an upload or PR command fails, inspect the live PR before repeating it, because partial failures can leave a PR or uploaded media.

## Rendering

Run from the repository root. Setup needs Bun and a current stable Rust toolchain with Cargo. Video export needs FFmpeg with `ffprobe` and `libx264`. Frame and video rendering need a working GPU.

```sh
rtk bun .agents/skills/pr-spotlight/scripts/render.ts setup
rtk bun .agents/skills/pr-spotlight/scripts/render.ts --help
```

Run setup once per checkout. It compiles a pinned [Psychopomp](https://github.com/kitlangton/psychopomp) revision into `build/pr-spotlight/toolchain/`. The first build can take several minutes. Human contributors can omit `rtk` if they do not use it.

Use the helper's `--help` for command syntax. The pinned upstream binary treats `--help` as a video output path. Keep generated media in `build/pr-spotlight/<topic>/`.

## Templates

The templates use ScenePlan version 2. Replace their example labels and code.

| Template | Use |
| --- | --- |
| [sequence.json](assets/sequence.json) | Show requests and responses in order. Export the final frame for a diagram. |
| [before-after.json](assets/before-after.json) | Change a response while keeping the participants and trigger stable. |
| [code-change.json](assets/code-change.json) | Replace a code excerpt while keeping IDs for unchanged lines. |

For sequence scenes, every visible row needs a `row.<id>.reveal` channel. Use initial value `1` with no events for a static row, or animate from `0` to `1`. Rows can share a `slot` for a replacement. Finish fading out the old row before revealing the new row so their labels do not overlap.

For code scenes, the last snapshot must match `finalLineIds`. Use `mark.<lineId>` to control a line mark.

One second is `1000000000` nanoseconds. Keep events inside `durationNanos` and use distinct channel IDs. Use `plan validate` for format checks. Upstream `plan schema` is a summary, not a complete JSON Schema. For other visual types, read the pinned [recipe guide](https://github.com/kitlangton/psychopomp/blob/46fd6121d0c2067f22a176e2187924a9914e9453/SCENE_PLANS.md#build-an-explainer) and inspect the recipe source. For Stage choreography, also read [explainer-motion](https://github.com/kitlangton/psychopomp/blob/46fd6121d0c2067f22a176e2187924a9914e9453/.opencode/skills/explainer-motion/SKILL.md). Revalidate the templates when upgrading the pinned revision.

## Media delivery

Use `encode` to create an MP4 within the size budget. Shorten the clip if compression makes text unreadable. Include a PNG for readers who cannot play the clip.

Follow [GitHub's attachment instructions](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli). Check `gh pr edit --help` for `--attach` before using it. CLI attachments need repository push access. Otherwise return the local files for the contributor to attach in GitHub. Include the editable scene and evidence notes in the handoff.
