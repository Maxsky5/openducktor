import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function;

/** The Reanimated hooks whose function arguments run as worklets on the UI thread. */
const WORKLET_HOOKS = new Set([
  "useAnimatedStyle",
  "useAnimatedProps",
  "useDerivedValue",
  "useAnimatedReaction",
  "useFrameCallback",
]);

const isFunction = (node: ESTree.Node): node is FunctionNode =>
  node.type === "ArrowFunctionExpression" ||
  node.type === "FunctionExpression" ||
  node.type === "FunctionDeclaration";

const hasWorkletDirective = (node: FunctionNode): boolean => {
  const body = node.body;
  if (body === null || body.type !== "BlockStatement") return false;
  return body.body.some(
    (statement: ESTree.Directive | ESTree.Statement) =>
      "directive" in statement && statement.directive === "worklet",
  );
};

const isWorkletHookArgument = (node: FunctionNode): boolean => {
  const parent = node.parent;
  return (
    parent?.type === "CallExpression" &&
    parent.callee.type === "Identifier" &&
    WORKLET_HOOKS.has(parent.callee.name) &&
    parent.arguments.some((argument: ESTree.Node) => argument === node)
  );
};

const isInsideFunction = (node: FunctionNode): boolean => {
  for (let parent: ESTree.Node | null = node.parent; parent; parent = parent.parent) {
    if (isFunction(parent)) return true;
  }
  return false;
};

/**
 * A worklet that the React Compiler compiles: a hook argument, or a function with a `'worklet'`
 * directive inside a component or hook. The compiler leaves module-level functions as they are.
 */
const isCompiledWorklet = (node: FunctionNode): boolean =>
  isWorkletHookArgument(node) || (hasWorkletDirective(node) && isInsideFunction(node));

/**
 * The React Compiler moves a function out of the component when the function reads no value of the
 * component, such as `(_, index) => index`. A worklet that holds such a function then calls a
 * JavaScript function from the UI thread, and the app crashes with "Tried to synchronously call a
 * Remote Function". A worklet must not hold a function unless that function is a worklet too.
 */
export const noFunctionsInWorkletsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid a function inside a worklet unless it has its own 'worklet' directive, because the React Compiler can move it to the JavaScript thread.",
    },
    messages: {
      nestedFunction:
        "Compute this value outside the worklet, or mark the function with a 'worklet' directive. The React Compiler can move a function out of the worklet, and the worklet then calls JavaScript from the UI thread, which crashes the app.",
    },
  },
  createOnce(context) {
    const check = (node: FunctionNode): void => {
      if (hasWorkletDirective(node)) return;
      for (let parent: ESTree.Node | null = node.parent; parent; parent = parent.parent) {
        if (isFunction(parent) && isCompiledWorklet(parent)) {
          context.report({ node, messageId: "nestedFunction" });
          return;
        }
      }
    };
    return {
      ArrowFunctionExpression: check,
      FunctionExpression: check,
      FunctionDeclaration: check,
    };
  },
});
