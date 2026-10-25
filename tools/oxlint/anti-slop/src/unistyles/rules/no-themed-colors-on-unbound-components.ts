import { defineRule } from "@oxlint/plugins";
import type { ESTree, Reference } from "@oxlint/plugins";

type Options = { boundModules: string[]; appPrefixes: string[] };

/** One `const name = StyleSheet.create(fn)` of the file. */
type StyleSheetEntry = {
  styles: Map<string, ESTree.Node>;
  references: Reference[];
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isOptions = (option: unknown): option is Options =>
  option !== null &&
  typeof option === "object" &&
  "boundModules" in option &&
  isStringArray(option.boundModules) &&
  "appPrefixes" in option &&
  isStringArray(option.appPrefixes);

const isNode = (value: unknown): value is ESTree.Node =>
  value !== null && typeof value === "object" && "type" in value && typeof value.type === "string";

const childNodes = (node: ESTree.Node): ESTree.Node[] =>
  Object.entries(node).flatMap(([key, value]) => {
    if (key === "parent") return [];
    if (Array.isArray(value)) return value.filter(isNode);
    return isNode(value) ? [value] : [];
  });

const descendants = (node: ESTree.Node): ESTree.Node[] => [
  node,
  ...childNodes(node).flatMap(descendants),
];

const contains = (outer: ESTree.Node, inner: ESTree.Node): boolean =>
  outer.range[0] <= inner.range[0] && inner.range[1] <= outer.range[1];

const keyName = (property: ESTree.Node): string | null => {
  if (property.type !== "Property" || property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string") {
    return property.key.value;
  }
  return null;
};

const isStyleSheetCreate = (node: ESTree.Node): node is ESTree.CallExpression =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.object.type === "Identifier" &&
  node.callee.object.name === "StyleSheet" &&
  node.callee.property.type === "Identifier" &&
  node.callee.property.name === "create";

/**
 * Unistyles updates a style on its own only on the views that its Babel plugin binds: the React
 * Native and Reanimated views. A component of another package, such as `FlashList`, gets copies
 * of its style props and keeps the colors of the theme it rendered with. A theme color on such a
 * component belongs on a wrapping React Native view, or the component needs `withUnistyles`, which
 * reads its styles again when the theme changes. The rule checks app components where they pass
 * their own style props on to a package component, so it does not check them where they are used.
 * The `unistyles/no-stylesheet-dependency-aliases` rule makes each style function return its
 * object directly, so this rule reads the styles only from that object.
 */
export const noThemedColorsOnUnboundComponentsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Unistyles styles with theme colors on package components that Unistyles does not bind.",
    },
    messages: {
      themedColor:
        "`styles.{{style}}` sets a theme or runtime color on {{component}}, which copies its styles, so the color does not update when the theme changes. Put the color on a wrapping React Native view.",
      forwardedStyle:
        "{{component}} gets the caller's `{{style}}`. Unistyles does not bind {{component}}, so the theme colors in those styles do not update when the theme changes. Wrap {{component}} with `withUnistyles`.",
    },
    schema: [
      {
        type: "object",
        properties: {
          boundModules: { type: "array", items: { type: "string" } },
          appPrefixes: { type: "array", items: { type: "string" } },
        },
        required: ["boundModules", "appPrefixes"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [option] = context.options;
    if (!isOptions(option)) {
      throw new Error(
        "unistyles/no-themed-colors-on-unbound-components needs the boundModules and appPrefixes options. Set them in the rule entry of .oxlintrc.json.",
      );
    }
    const sheets = new Map<string, StyleSheetEntry>();
    // The import source of each imported name of the file.
    const importSources = new Map<string, string>();

    const isUnbound = (source: string): boolean =>
      !option.boundModules.includes(source) &&
      !source.startsWith(".") &&
      !option.appPrefixes.some((prefix) => source.startsWith(prefix));

    const readSheets = (program: ESTree.Program): void => {
      for (const statement of program.body) {
        if (statement.type === "ImportDeclaration") {
          for (const specifier of statement.specifiers) {
            importSources.set(specifier.local.name, statement.source.value);
          }
          continue;
        }
        const declaration =
          statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
        if (declaration?.type !== "VariableDeclaration") continue;
        for (const declarator of declaration.declarations) {
          const { id, init } = declarator;
          if (id.type !== "Identifier" || init === null || !isStyleSheetCreate(init)) continue;
          const [factory] = init.arguments;
          if (factory?.type !== "ArrowFunctionExpression" && factory?.type !== "FunctionExpression") {
            continue;
          }
          if (factory.body?.type !== "ObjectExpression") continue;
          const styles = new Map<string, ESTree.Node>();
          for (const property of factory.body.properties) {
            const name = keyName(property);
            if (name !== null && property.type === "Property") styles.set(name, property.value);
          }
          const references = context.sourceCode
            .getDeclaredVariables(factory)
            .flatMap((variable) => variable.references);
          sheets.set(id.name, { styles, references });
        }
      }
    };

    /** True when a color or shadow property of the style reads the theme or the runtime. */
    const hasThemedColor = (style: ESTree.Node, references: Reference[]): boolean =>
      descendants(style).some((node) => {
        const name = keyName(node);
        if (name === null || !/color$|^boxShadow$/iu.test(name) || node.type !== "Property") {
          return false;
        }
        return references.some((reference) => contains(node.value, reference.identifier));
      });

    /** The style parameters of the enclosing component that an attribute passes on. */
    const forwardedStyles = (expression: ESTree.Node): Set<string> =>
      new Set(
        context.sourceCode.getScope(expression).references.flatMap(({ identifier, resolved }) =>
          contains(expression, identifier) &&
          /style$/iu.test(identifier.name) &&
          resolved?.defs.some((definition) => definition.type === "Parameter")
            ? [identifier.name]
            : [],
        ),
      );

    return {
      Program(node) {
        readSheets(node);
      },
      JSXOpeningElement(node) {
        let root: ESTree.Node = node.name;
        while (root.type === "JSXMemberExpression") root = root.object;
        if (root.type !== "JSXIdentifier") return;
        const source = importSources.get(root.name);
        if (source === undefined || !isUnbound(source)) return;
        const component = context.sourceCode.getText(node.name);
        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier") continue;
          if (!/style$/iu.test(attribute.name.name)) continue;
          if (attribute.value?.type !== "JSXExpressionContainer") continue;
          const { expression } = attribute.value;
          for (const style of forwardedStyles(expression)) {
            context.report({
              node: attribute,
              messageId: "forwardedStyle",
              data: { style, component },
            });
          }
          for (const used of descendants(expression)) {
            if (
              used.type !== "MemberExpression" ||
              used.computed ||
              used.object.type !== "Identifier" ||
              used.property.type !== "Identifier"
            ) {
              continue;
            }
            const sheet = sheets.get(used.object.name);
            const style = sheet?.styles.get(used.property.name);
            if (sheet === undefined || style === undefined) continue;
            if (hasThemedColor(style, sheet.references)) {
              context.report({
                node: attribute,
                messageId: "themedColor",
                data: { style: used.property.name, component },
              });
            }
          }
        }
      },
    };
  },
});
