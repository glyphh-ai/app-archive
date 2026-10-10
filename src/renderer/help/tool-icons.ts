/**
 * tool-icons.ts — the built-in work panels' marks, by view key. Lifted out of
 * the Workspaces page (help/layouts.ts) when that page left Customize (his
 * order, 2026-10-09); the library pages and the agent's menu still wear them.
 */

/** Built-in workbench tool panels selectable in a layout cell. id = `tool:<ViewKind>`:
 *  namespaced (never collides with an app id/UUID) and the suffix IS the
 *  workbench ViewKind, so code-workbench maps it straight to makeSlot(view).
 *  Stored verbatim as the schema's panelId string — round-trips, no migration. */
// Icons mirror code-workbench's VIEW_META so a layout preview shows the same
// glyph the panel header does. `stroke="currentColor"` lets CSS color them —
// white in dark mode — and they size to the tile via .layout-tool-icon svg.
export const TOOL_PANELS: Array<{ id: string; label: string; icon: string }> = [
  { id: "tool:preview",  label: "Browser", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>` },
  // "Glyphh" — the agent as a layout cell. A layout that includes it OWNS
  // the agent while open: the center composer leaves the screen and returns
  // when the layout closes.
  { id: "tool:coding",   label: "Glyphh", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><polyline points="9 9 7 11 9 13"/><polyline points="15 9 17 11 15 13"/></svg>` },
  { id: "tool:diff",     label: "Diff", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><polyline points="8 7 4 11 8 15"/><polyline points="16 9 20 13 16 17"/></svg>` },
  { id: "tool:monaco",   label: "Editor", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>` },
  { id: "tool:files",    label: "Files", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>` },
  { id: "tool:plan",     label: "Plan", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>` },
  { id: "tool:terminal", label: "Terminal", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>` },
  // Rail — the app's left rail as a panel: menu, Recents, Apps, Workspaces,
  // account footer. Its sections are per-cell toggles in the setup pane.
  // (The rail is the fixed sidebar now, 2026-09-16; no Rail panel to place.)
  // { id: "tool:rail", label: "Rail", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="5.6" y1="7.5" x2="6.4" y2="7.5"/><line x1="5.6" y1="12" x2="6.4" y2="12"/><line x1="5.6" y1="16.5" x2="6.4" y2="16.5"/></svg>` },
  // Echo — the command center as a 3D wall (moved here from the agent's
  // ⋮ menu: it opens like an app, via layouts or the picker).
  { id: "tool:echo",     label: "Echo", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="9" rx="1.5"/><path d="M5 15V6.5A1.5 1.5 0 0 1 6.5 5H17"/><path d="M2 12V3.5A1.5 1.5 0 0 1 3.5 2H14"/></svg>` },
];
const toolPanelIcon = (id: string): string => TOOL_PANELS.find((t) => t.id === id)?.icon || "";
/** The mark a built-in work panel wears, by its view key ("monaco"). The
 *  library pages use it for an app that IS a panel and ships no icon of its
 *  own (his report, 2026-09-17: the Design app's icon wasn't rendering). */
export const toolViewIcon = (view: string): string => toolPanelIcon(`tool:${view}`);
