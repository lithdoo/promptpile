/**
 * Opt-in diagnostics for selected subsystems (e.g. tools resolution in `tools-loader.ts`).
 * Set `PROMPTPILE_DEBUG=1` (or `true` / `yes` / `on`) to enable those lines even when `-q` / `QUIET` is on.
 */

export const isPromptpileDiagnostic = (): boolean => {
  const v = process.env.PROMPTPILE_DEBUG?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
};
