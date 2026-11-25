/**
 * What the desktop and mobile diagram views share when they draw Mermaid diagrams with Pele: the
 * layout options, and the preparation step that adds the shapes and classes that the diagram theme
 * in `@openducktor/theme/diagrams.css` reads.
 */

/**
 * The Pele options that the desktop and mobile views share. Each view adds its fonts.
 * - Right-angle edges with rounded corners, and flat commit labels.
 * - No empty member boxes in a class without members.
 * - Class members in the code font, as the signatures that they are.
 * - No links, as Mermaid strict mode did: a diagram link would leave the app.
 */
export const DIAGRAM_RENDER_OPTIONS = {
  monospace: ["members"] satisfies "members"[],
  links: false,
  config: {
    flowchart: { curve: "step" },
    state: { curve: "step" },
    gitGraph: { rotateCommitLabel: false },
    class: { hideEmptyMembersBox: true },
  },
};

/**
 * The corner radius of diagram boxes. `--pele-radius` in `@openducktor/theme/diagrams.css` has the
 * same value.
 */
const DIAGRAM_RADIUS = 10;

const NODE_START = /(?=<g class="pele-node )/;
const NODE_CLASSES = /^<g class="([^"]*)"/;

const BOX =
  /^<g class="pele-node pele-(?:class|entity)"[^>]*><rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*\/>/;

/** The divider lines of a box: the end of its name area, and the end of its attributes. */
const DIVIDERS =
  /(class="pele-(?:er-)?divider" d=")M(-?[\d.]+),(-?[\d.]+)H(-?[\d.]+)(?:M-?[\d.]+,(-?[\d.]+)H-?[\d.]+)?"/;

/** Pele draws a member box without members 10 px tall. A box with one member is taller. */
const EMPTY_MEMBER_BOX = 14;

const headerBand = (x: number, y: number, width: number, bottom: number): string => {
  const r = DIAGRAM_RADIUS;
  return (
    `<path class="pele-node-header" d="M${x},${bottom}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}` +
    `H${x + width - r}A${r},${r} 0 0 1 ${x + width},${y + r}V${bottom}Z"/>`
  );
};

/** The shift that centers the members of a class whose other member box is empty. */
const memberShift = (nameEnd: number, attributesEnd: number, bottom: number): number => {
  if (attributesEnd - nameEnd < EMPTY_MEMBER_BOX) return (nameEnd - attributesEnd) / 2;
  if (bottom - attributesEnd < EMPTY_MEMBER_BOX) return (bottom - attributesEnd) / 2;
  return 0;
};

/**
 * Gives a class or entity box a name band and the `pele-banded` class. A class with an empty
 * member box loses that box's divider, and its members move by half the empty height, so they sit
 * centered in the space. The node text runs from the start of the node to the start of the next
 * node.
 */
const withNameBand = (node: string): string => {
  const box = BOX.exec(node);
  const dividers = DIVIDERS.exec(node);
  if (!box || !dividers) return node;
  const [rect, x, y, width, height] = box;
  const [dividerMarkup, dividerPrefix, left, nameEnd, right, attributesEnd] = dividers;
  const top = Number(y);
  const banded = node
    .replace(rect, rect + headerBand(Number(x), top, Number(width), Number(nameEnd)))
    .replace(NODE_CLASSES, '<g class="$1 pele-banded"');
  if (attributesEnd === undefined) return banded;

  const shift = memberShift(Number(nameEnd), Number(attributesEnd), top + Number(height));
  if (shift === 0) return banded;
  return banded
    .replace(dividerMarkup, `${dividerPrefix}M${left},${nameEnd}H${right}"`)
    .replace(
      '<g class="pele-members"',
      `<g class="pele-members" transform="translate(0,${shift})"`,
    );
};

/** The participant hues, in order. The diagram styles define a `pele-hue-<name>` class for each. */
const PARTICIPANT_HUES: readonly string[] = ["fuchsia", "emerald", "amber", "sky", "rose", "lime"];

const PARTICIPANT_PART =
  /class="(pele-node pele-actor[^"]*|pele-lifeline|pele-activation)" data-id="([^"]+)"/g;

/**
 * Gives each sequence participant a hue class, in the order of the participants: its boxes at the
 * top and the bottom, its lifeline, and its activation bars.
 */
const withParticipantHues = (svg: string): string => {
  const hues = new Map<string, string>();
  return svg.replace(PARTICIPANT_PART, (_part: string, classes: string, id: string) => {
    const hue = hues.get(id) ?? PARTICIPANT_HUES[hues.size % PARTICIPANT_HUES.length] ?? "";
    hues.set(id, hue);
    return `class="${classes} pele-hue-${hue}" data-id="${id}"`;
  });
};

const STYLE_ATTRIBUTE = /\sstyle="([^"]*)"/g;
const STYLE_FILL = /(^|;)fill:/g;

/**
 * Moves the author colors of sequence highlights and boxes into `--author-fill`. Pele writes them
 * as inline fills, which a theme cannot change, and authors pick them for a light page. The diagram
 * styles paint the fill from the variable, so the dark theme can keep the hue at a dark tint.
 */
const withAuthorFillVariables = (svg: string): string =>
  svg.replace(
    STYLE_ATTRIBUTE,
    (_attribute: string, style: string) =>
      ` style="${style.replace(STYLE_FILL, "$1--author-fill:")}"`,
  );

const SEQUENCE = 'class="pele pele-sequence"';

/**
 * Prepares a Pele drawing for the diagram styles:
 * - Each class and entity box gets a name band. Pele draws a box as one rectangle with divider
 *   lines, so the band follows the box corners down to the first divider. A box without members
 *   has no divider and no band, and the diagram styles tint all of it.
 * - A class with only attributes or only methods loses the divider of its empty member box, so the
 *   box shows no blank strip, and its members center in the space.
 * - Sequence author colors move into a variable, so each theme can paint them.
 * - Each sequence participant gets its own color.
 */
export const prepareDiagram = (svg: string): string => {
  const banded = svg.split(NODE_START).map(withNameBand).join("");
  return banded.includes(SEQUENCE) ? withParticipantHues(withAuthorFillVariables(banded)) : banded;
};
