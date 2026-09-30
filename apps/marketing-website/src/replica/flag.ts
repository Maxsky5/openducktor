// The boolean state attributes of the copied UI, such as data-active or data-disabled.

/** The value of a state attribute: present and empty when the state is on, absent when it is off. */
export function flag(on: boolean | undefined): "" | undefined {
  return on ? "" : undefined;
}
