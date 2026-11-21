import { TASK_CLOSED_STATE, TASK_OPEN_STATE } from "@openducktor/contracts";

/** A state in board column order, with its place in the definition list. */
export type ColumnState<State> = { readonly state: State; readonly index: number };

/**
 * The states in board column order: `open` first, `closed` last, and the other states in their
 * definition order, as the board shows them.
 */
export const columnOrder = <State extends { readonly id: string }>(
  states: readonly State[],
): ColumnState<State>[] => {
  const all = states.map((state, index) => ({ state, index }));
  const rank = ({ state }: ColumnState<State>) => {
    if (state.id === TASK_OPEN_STATE) return 0;
    return state.id === TASK_CLOSED_STATE ? 2 : 1;
  };
  return all.sort((left, right) => rank(left) - rank(right) || left.index - right.index);
};
