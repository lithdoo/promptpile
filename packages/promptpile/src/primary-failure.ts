const secondaryFailureMap = new WeakMap<object, unknown[]>();

/** Preserve the original throwable while attaching cleanup/finalizer diagnostics. */
export const recordSecondaryFailure = (primary: unknown, secondary: unknown): void => {
  if ((typeof primary !== 'object' && typeof primary !== 'function') || primary === null) return;
  const carrier = primary as object;
  const failures = secondaryFailureMap.get(carrier) ?? [];
  failures.push(secondary);
  secondaryFailureMap.set(carrier, failures);
};

export const secondaryFailuresOf = (primary: unknown): readonly unknown[] => {
  if ((typeof primary !== 'object' && typeof primary !== 'function') || primary === null) return [];
  return secondaryFailureMap.get(primary as object)?.slice() ?? [];
};
