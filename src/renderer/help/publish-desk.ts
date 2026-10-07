/** THE DEVELOPER'S DESK + THE REVIEW DESK (his asks, 2026-10-07; punch list
 *  7, 16, 18). Two numbers, distinct: the manifest `version` is the
 *  developer's (semver, bumped by hand, compared by the Updates view); the
 *  release `n` is the system's counter per Build and run (pin / rollback).
 *  The hub VERSION is what a share makes — it records the manifest version it
 *  carried. The pure parts live here; settings-skills.ts draws them. */

export interface HubVersionRow { version: number; notes: string; createdAt: string; status: string; reviewSummary?: string; decisionNote?: string; manifestVersion?: string | null }
export interface ReleaseRowLike { n: number; note: string; at: string | number; by?: string | null; pinned: boolean; sizeBytes?: number }
export interface CommentLike { id: string; by: string; author: string; body: string; createdAt: string | null; verdict?: string | null }
export interface QueueRowLike { id: string; kind: string; entity_id?: string; version: number; status: string; notes?: string; decision_note?: string; slug: string; name: string; submitted_by?: string | null; submitted_by_name?: string | null; created_at?: string; review_verdict?: string | null }

/** Release notes are REQUIRED on a re-share (his spec, 2026-10-07): a first
 *  share may go without; after that every version says what changed. */
export function notesRequired(head: number | null | undefined, pending: number | null | undefined, versions: ReadonlyArray<{ version: number }>): boolean {
  return !!head || !!pending || versions.length > 0;
}

/** What the share button says, and whether it is a re-share. */
export function shareFace(state: { head: number | null; pending: number | null; declined?: { version: number } | null; changes?: { version: number } | number | null }): { label: string; again: boolean; blocked: string } {
  if (state.pending) return { label: "Share again", again: true, blocked: `v${state.pending} is on the review desk — sharing again replaces it.` };
  if (state.changes) return { label: "Share the next version", again: true, blocked: "" };
  if (state.head) return { label: "Share a new version", again: true, blocked: "" };
  if (state.declined) return { label: "Share again", again: true, blocked: "" };
  return { label: "Share", again: false, blocked: "" };
}

/** One line of standing for the Publish tab's header. */
export function standingLine(state: { head: number | null; pending: number | null; declined?: { version: number; summary: string } | null; changes?: { version: number; note: string } | null; lifecycle?: string | null; lifecycleNote?: string | null }): string {
  if (state.lifecycle === "removed") return `Removed from Discover${state.lifecycleNote ? ` — ${state.lifecycleNote}` : ""}. Members who hold it keep running it.`;
  if (state.lifecycle === "retired") return `Retired${state.lifecycleNote ? ` — ${state.lifecycleNote}` : ""}. No new installs; members who hold it keep running it.`;
  if (state.pending) return `v${state.pending} is waiting on your organization's review desk.`;
  if (state.changes) return `Changes requested on v${state.changes.version}${state.changes.note ? `: ${state.changes.note}` : ""}. Share the next version when it is ready.`;
  if (state.declined) return `v${state.declined.version} was declined${state.declined.summary ? `: ${state.declined.summary}` : ""}.`;
  if (state.head) return `v${state.head} is live on your organization's hub. Members install it from Discover.`;
  return "Not shared yet. Share puts it on your organization's hub (an admin's share goes live at once; anyone else's waits on the review desk).";
}

/** A version row's label for the history. */
export function versionLabel(v: HubVersionRow): string {
  const word = v.status === "approved" ? "live" : v.status === "pending" ? "in review" : v.status === "changes" ? "changes requested" : v.status === "rejected" ? "declined" : v.status;
  return `v${v.version}${v.manifestVersion ? ` · ${v.manifestVersion}` : ""} · ${word}`;
}

/** A release row's label for the Releases tab. */
export function releaseLine(r: ReleaseRowLike): string {
  const size = r.sizeBytes ? ` · ${r.sizeBytes >= 1_048_576 ? `${(r.sizeBytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(r.sizeBytes / 1024))} KB`}` : "";
  return `release ${r.n}${r.pinned ? " · live" : ""}${size}`;
}

/** The queue rows this page shows: its kinds only, newest first. */
export function queueForKinds(rows: ReadonlyArray<QueueRowLike>, kinds: ReadonlyArray<string>): QueueRowLike[] {
  return rows.filter((r) => kinds.includes(r.kind)).sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

/** The three answers a reviewer gives, as the decide body spells them. */
export type Verdict = "approve" | "changes" | "reject";
export const VERDICT_LABEL: Record<Verdict, string> = { approve: "Approve", changes: "Request changes", reject: "Decline" };

/** A note is required with changes requested or a decline (the author needs the why). */
export function decisionNeedsNote(verdict: Verdict, note: string): boolean {
  return verdict !== "approve" && !note.trim();
}

/** The AI review entry is the thread's first voice; a person's name otherwise. */
export function commentAuthor(c: CommentLike): string {
  return c.by === "ai" ? "Review agent" : c.author || "Someone";
}

/** Who may retire or remove an item here: the author, or an org admin. */
export function mayRetire(opts: { admin: boolean; own: boolean }): boolean {
  return opts.admin || opts.own;
}
