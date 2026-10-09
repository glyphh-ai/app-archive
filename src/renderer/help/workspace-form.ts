/** workspace-form.ts — the Create workspace modal's check, pure (help/workspace-create.ts). */

/** The modal's answers, checked: null when they can be saved. */
export function workspaceFormError(name: string, existing: ReadonlyArray<string>): string | null {
  const n = name.trim();
  if (!n) return "Give the workspace a name.";
  if (n.length > 60) return "Keep the name under 60 characters.";
  if (existing.some((e) => e.trim().toLowerCase() === n.toLowerCase())) return `A workspace named "${n}" already exists.`;
  return null;
}
