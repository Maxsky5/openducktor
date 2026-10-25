/*
 * The geometry of the step track. It is a React Native port of the Reasoning Effort component of
 * AICSS: https://github.com/kvnkld/aicss/tree/main/packages/react/src/reasoning-effort
 *
 * MIT License
 *
 * Copyright (c) 2026 AICSS
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/** The height of the track. */
export const TRACK_HEIGHT = 32;
/** The corner of the track and the distance from each end to the first and last stop. */
export const TRACK_RADIUS = TRACK_HEIGHT / 2;
/** The space above the track where the label grows out of its top edge. */
export const BUMP_HEIGHT = 20;
const REST_WIDTH = 27.2;
const DRAG_WIDTH = 33.6;
/** The height of the thumb. */
export const THUMB_HEIGHT = 27.2;
/** The space between the thumb and the track edge. */
export const EDGE_PAD = (TRACK_HEIGHT - THUMB_HEIGHT) / 2;
/** The horizontal length of one label shoulder. */
const SHOULDER = 23.572;
/** The space from each label edge to the foot of its shoulder. */
const TEXT_SIDE = 20;
/** How far the outer foot walks down the end cap once it passes the crown. */
const PHI_MAX = 0.6;
const PHI_REACH = 36;
const SHORTEST_TICK = 4.8;
const TALLEST_TICK = 9.6;

type Point = { x: number; y: number };

const clamp = (value: number, min: number, max: number): number => {
  "worklet";
  return Math.min(max, Math.max(min, value));
};

/** The x of a position on the track. `value` goes from 0 to `count - 1`. */
export const centerFor = (value: number, count: number, track: number): number => {
  "worklet";
  return TRACK_RADIUS + (value / (count - 1)) * (track - TRACK_RADIUS * 2);
};

/** The position on the track under an x, from 0 to `count - 1`. */
export const valueAt = (x: number, count: number, track: number): number => {
  "worklet";
  const t = (x - TRACK_RADIUS) / (track - TRACK_RADIUS * 2);
  return clamp(t * (count - 1), 0, count - 1);
};

/** The tick height of a stop: the ticks grow from the first stop to the last. */
export const tickHeight = (index: number, count: number): number =>
  SHORTEST_TICK + ((TALLEST_TICK - SHORTEST_TICK) * index) / Math.max(1, count - 1);

/** The width of the flat top of the label for a label width. */
export const plateauFor = (textWidth: number): number => {
  "worklet";
  return Math.max(8, textWidth + TEXT_SIDE * 2 - SHOULDER * 2);
};

const smoothstep = (t: number): number => {
  "worklet";
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

const capFoot = (side: -1 | 1, phi: number, track: number): Point => {
  "worklet";
  const crown = side === -1 ? TRACK_RADIUS : track - TRACK_RADIUS;
  return {
    x: crown + side * TRACK_RADIUS * Math.sin(phi),
    y: BUMP_HEIGHT + TRACK_RADIUS * (1 - Math.cos(phi)),
  };
};

type ShellGeometry = {
  topL: number;
  topR: number;
  phiL: number;
  phiR: number;
  insetL: number;
  insetR: number;
};

/**
 * The flat top of the label over a track x. Near an end, the outer shoulder walks down the end
 * cap, and the top moves inward so the label stays over the track.
 */
const shellGeometry = (cx: number, plateau: number, track: number): ShellGeometry => {
  "worklet";
  const crownL = TRACK_RADIUS;
  const crownR = track - TRACK_RADIUS;
  let topL = cx - plateau / 2;
  let topR = topL + plateau;
  let phiL = 0;
  let phiR = 0;

  const overflowL = crownL - (topL - SHOULDER);
  if (overflowL > 0) {
    phiL = PHI_MAX * smoothstep(overflowL / PHI_REACH);
    const foot = capFoot(-1, phiL, track);
    const minTopL = foot.x + SHOULDER * Math.cos(phiL);
    if (topL < minTopL) {
      topR += minTopL - topL;
      topL = minTopL;
    }
  }

  const overflowR = topR + SHOULDER - crownR;
  if (overflowR > 0) {
    phiR = PHI_MAX * smoothstep(overflowR / PHI_REACH);
    const foot = capFoot(1, phiR, track);
    const maxTopR = foot.x - SHOULDER * Math.cos(phiR);
    if (topR > maxTopR) {
      topL -= topR - maxTopR;
      topR = maxTopR;
    }
  }

  // A tilted shoulder is shorter in x, which would pull the label onto the outer edge. The top
  // grows inward by that loss, and the label moves with it.
  const insetL = phiL > 0 ? SHOULDER * (1 - Math.cos(phiL)) : 0;
  const insetR = phiR > 0 ? SHOULDER * (1 - Math.cos(phiR)) : 0;
  topR += insetL;
  topL -= insetR;
  return { topL, topR, phiL, phiR, insetL, insetR };
};

/** The center x of the label over a track x. */
export const labelCenter = (cx: number, plateau: number, track: number): number => {
  "worklet";
  const shell = shellGeometry(cx, plateau, track);
  return (shell.topL + shell.topR) / 2 + (shell.insetL - shell.insetR) / 2;
};

const format = (point: Point): string => {
  "worklet";
  return `${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
};

/** One label shoulder. `phi` tilts the foot onto the cap tangent; 0 is the flat scoop. */
const shoulder = (
  footX: number,
  footY: number,
  topX: number,
  topY: number,
  phi: number,
  dir: 1 | -1,
): string => {
  "worklet";
  const xScale = Math.abs(topX - footX) / SHOULDER;
  const yScale = Math.max(0.001, (footY - topY) / 20);
  const map = (lx: number, ly: number): Point => ({
    x: footX + dir * lx * xScale,
    y: footY + (ly - 20) * yScale,
  });
  const handle = 5.398 * xScale;
  const p0 = { x: footX, y: footY };
  const c1 = { x: footX + dir * Math.cos(phi) * handle, y: footY - Math.sin(phi) * handle };
  const c2 = map(10.012, 16.114);
  const p1 = map(10.93, 10.794);
  const c3 = map(11.916, 4.577);
  const c4 = map(17.277, 0);
  const p3 = { x: topX, y: topY };
  if (dir === 1)
    return `C${format(c1)} ${format(c2)} ${format(p1)}C${format(c3)} ${format(c4)} ${format(p3)}`;
  return `C${format(c4)} ${format(c3)} ${format(p1)}C${format(c2)} ${format(c1)} ${format(p0)}`;
};

/**
 * The outline of the track. While `open` grows from 0 to 1, the label shoulder grows out of the
 * top edge over the x `cx`.
 */
export const shellPath = (cx: number, open: number, plateau: number, track: number): string => {
  "worklet";
  const top = BUMP_HEIGHT;
  const bottom = BUMP_HEIGHT + TRACK_HEIGHT;
  const r = TRACK_RADIUS;
  const crownL = r;
  const crownR = track - r;
  if (open < 0.012) {
    return `M${crownL} ${top}H${crownR}A${r} ${r} 0 0 1 ${crownR} ${bottom}H${crownL}A${r} ${r} 0 0 1 ${crownL} ${top}Z`;
  }
  const bumpTop = BUMP_HEIGHT * (1 - open);
  const { topL, topR, phiL, phiR } = shellGeometry(cx, plateau, track);
  let path = `M${crownL} ${bottom}`;
  if (phiL > 0.001) {
    const foot = capFoot(-1, phiL, track);
    path += `A${r} ${r} 0 0 1 ${format(foot)}`;
    path += shoulder(foot.x, foot.y, topL, bumpTop, phiL, 1);
  } else {
    path += `A${r} ${r} 0 0 1 ${crownL} ${top}`;
    const footL = topL - SHOULDER;
    if (footL > crownL + 0.4) path += `H${footL.toFixed(2)}`;
    path += shoulder(footL, top, topL, bumpTop, 0, 1);
  }
  if (topR > topL + 0.4) path += `H${topR.toFixed(2)}`;
  if (phiR > 0.001) {
    const foot = capFoot(1, phiR, track);
    path += shoulder(foot.x, foot.y, topR, bumpTop, phiR, -1);
    path += `A${r} ${r} 0 0 1 ${crownR} ${bottom}`;
  } else {
    const footR = topR + SHOULDER;
    path += shoulder(footR, top, topR, bumpTop, 0, -1);
    if (footR < crownR - 0.4) path += `H${crownR}`;
    path += `A${r} ${r} 0 0 1 ${crownR} ${bottom}`;
  }
  return `${path}H${crownL}Z`;
};

/** The left and right x of the thumb over a track x. It grows while the label is open. */
export const thumbBounds = (cx: number, open: number, track: number) => {
  "worklet";
  const width = REST_WIDTH + (DRAG_WIDTH - REST_WIDTH) * open;
  let left = cx - width / 2;
  if (left < EDGE_PAD) left = EDGE_PAD;
  if (left + width > track - EDGE_PAD) left = track - EDGE_PAD - width;
  return { left, right: left + width };
};

/** The stop nearest to `index` that the user can choose, or null when none can be chosen. */
export const nearestEnabled = (index: number, disabled: readonly boolean[]): number | null => {
  "worklet";
  for (let distance = 0; distance < disabled.length; distance += 1) {
    const below = index - distance;
    if (below >= 0 && !disabled[below]) return below;
    const above = index + distance;
    if (above < disabled.length && !disabled[above]) return above;
  }
  return null;
};
