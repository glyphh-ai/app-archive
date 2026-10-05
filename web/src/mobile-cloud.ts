/**
 * mobile-cloud.ts — the phone's CLOUD lane, as pure rules (his direction,
 * 2026-10-05: a developer on their phone starts a Code session that runs on a
 * cloud worker with a GitHub repo checked out — the same front door and runner
 * the web uses, no environment setup: a "Default" environment plus a repo
 * grant is enough; named environments come next).
 *
 * Nothing here touches the DOM or the network — mobile.tsx paints what these
 * functions decide, and the unit tests run them bare. The locus rule itself
 * (fixed at birth, desktop where one is attached else the cloud) is the web's
 * own, imported from session-locus.ts — never a second copy.
 */
import { defaultLocus, LOCUS_LOCKED_HINT, type Locus } from '../../src/renderer/help/session-locus';

export type { Locus };
export { defaultLocus, LOCUS_LOCKED_HINT };

/** A repository as the SDK lists it (contract/git.ts Repo). */
export interface RepoRow { id: string; fullName: string; private: boolean; defaultBranch: string; url?: string }

/** One picked repo + the base branch it checks out on. */
export interface RepoPick { repo: string; branch: string }

/** A branch as the base-branch sheet lists it. */
export interface BranchRow { name: string; default: boolean }

/**
 * The cloud session's source, as the thread record stores it VERBATIM (the
 * server's `source` is jsonb). `kind`/`repo` are the web's own Source shape
 * (code-source-chip.ts) so remote-run.ts reads it unchanged: `repo` is the
 * FIRST pick — the worker checks out ONE repo today (rrotor harness
 * config.ts `repo`); the whole selection rides in `repos` so multi-repo can
 * follow without a record change.
 */
export interface CloudSource { kind: 'cloud-repo'; repo: string; branch: string; repos: RepoPick[] }

/** The source a selection becomes: the first pick leads. Null with no pick —
 *  a cloud session is never born without a repo (his rule, 2026-10-05: "the
 *  connect GitHub is a hard limit to creating a web dev env"; the empty
 *  "new cloud folder" workspace the web offers is not on the phone). */
export function cloudSource(picks: readonly RepoPick[]): CloudSource | null {
  const first = picks[0];
  if (!first) return null;
  return { kind: 'cloud-repo', repo: first.repo, branch: first.branch, repos: picks.map((p) => ({ ...p })) };
}

/** Why the composer cannot send a CLOUD session yet — '' when it can. The
 *  gate is GitHub itself: linked, and at least one repo picked. */
export function cloudSendBlock(connected: boolean, picks: readonly RepoPick[]): string {
  if (!connected) return 'Connect GitHub to start a cloud session';
  if (!picks.length) return 'Choose a repository';
  return '';
}

/** The picks a stored source carries (an older record has only `repo`). */
export function picksOf(source: { kind?: string; repo?: string; branch?: string; repos?: unknown } | null | undefined): RepoPick[] {
  if (!source) return [];
  if (Array.isArray(source.repos)) {
    return (source.repos as Array<{ repo?: unknown; branch?: unknown }>)
      .filter((p) => typeof p?.repo === 'string' && p.repo)
      .map((p) => ({ repo: String(p.repo), branch: typeof p.branch === 'string' ? p.branch : '' }));
  }
  if (source.kind === 'cloud-repo' && source.repo) return [{ repo: source.repo, branch: source.branch || '' }];
  return [];
}

/** Is this source kind a cloud one? (anything not local — the web's rule.) */
export function isCloudKind(kind: string | undefined | null): boolean {
  return kind === 'cloud-repo' || kind === 'cloud-new' || kind === 'cloud-space';
}

// ── Labels ───────────────────────────────────────────────────────────────

const lastSeg = (p: string): string => p.split('/').filter(Boolean).pop() || p;

/** The compact place label — the web's `Cloud · <repo>` (code-source-chip.ts
 *  sourceLabel: the repo's last segment), "Cloud" for a fresh workspace. */
export function cloudLabel(source: { kind?: string; repo?: string; label?: string } | null | undefined): string {
  if (!source) return 'Cloud';
  if (source.kind === 'cloud-repo' && source.repo) return `Cloud · ${lastSeg(source.repo)}`;
  if (source.kind === 'cloud-space') return `Cloud · ${source.label || 'workspace'}`;
  return 'Cloud';
}

/** The ENVIRONMENT chip: the cloud's one environment is "Default"; a desktop
 *  session names its machine. */
export function envChipLabel(locus: Locus, machineName?: string): string {
  return locus === 'cloud' ? 'Default' : (machineName || 'Desktop');
}

/** The REPO chip: "Connect GitHub" until the account is linked, "Choose
 *  repositories" with nothing picked, else "N repos · N branches" (one base
 *  branch per repo). */
export function repoChipLabel(picks: readonly RepoPick[], connected: boolean): string {
  if (!connected) return 'Connect GitHub';
  const n = picks.length;
  if (!n) return 'Choose repositories';
  return `${n} repo${n === 1 ? '' : 's'} · ${n} branch${n === 1 ? '' : 'es'}`;
}

/** The folder chip beside a desktop environment: the folder's last segment. */
export function folderChipLabel(path: string): string {
  return path ? lastSeg(path) : 'Choose folder';
}

// ── The repositories sheet ───────────────────────────────────────────────

/** Toggle a repo in the selection; a fresh pick takes the repo's default
 *  branch as its base (the branch sheet changes it). Order of picking is kept
 *  — the FIRST pick is the one the worker checks out. */
export function toggleRepo(picks: readonly RepoPick[], repo: RepoRow): RepoPick[] {
  const had = picks.some((p) => p.repo === repo.fullName);
  return had ? picks.filter((p) => p.repo !== repo.fullName) : [...picks, { repo: repo.fullName, branch: repo.defaultBranch }];
}

export function setBranch(picks: readonly RepoPick[], repo: string, branch: string): RepoPick[] {
  return picks.map((p) => (p.repo === repo ? { ...p, branch } : p));
}

/** The list grouped by owner, owners and names each alphabetical; the search
 *  is a case-insensitive substring over `owner/name`. */
export function groupRepos(repos: readonly RepoRow[], query = ''): Array<{ owner: string; repos: RepoRow[] }> {
  const q = query.trim().toLowerCase();
  const shown = q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : [...repos];
  const byOwner = new Map<string, RepoRow[]>();
  for (const r of shown) {
    const owner = r.fullName.split('/')[0] || '';
    const list = byOwner.get(owner) ?? [];
    list.push(r);
    byOwner.set(owner, list);
  }
  return [...byOwner.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([owner, list]) => ({ owner, repos: list.sort((a, b) => a.fullName.localeCompare(b.fullName)) }));
}

export const splitRepo = (fullName: string): { owner: string; name: string } => {
  const i = fullName.indexOf('/');
  return i < 0 ? { owner: '', name: fullName } : { owner: fullName.slice(0, i), name: fullName.slice(i + 1) };
};

// ── The sessions list ────────────────────────────────────────────────────

/** A thread as the phone lists it, from either store. */
export interface ListedThread {
  id: string;
  title: string;
  mode?: string;
  source?: { kind?: string; path?: string; repo?: string; machineId?: string; machineName?: string; [k: string]: unknown } | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/**
 * ONE list from two stores: the desktop's threads (over the attach socket)
 * and the server's threads (`/api/harness/threads`), of which only the CLOUD
 * ones are taken — a desktop thread also syncs to the server, so it would
 * list twice otherwise. On an id collision the desktop's copy wins.
 */
export function mergeThreads<T extends ListedThread>(desktop: readonly T[], server: readonly T[]): T[] {
  const seen = new Set(desktop.map((t) => t.id));
  const cloud = server.filter((t) => isCloudKind(t.source?.kind) && !seen.has(t.id));
  return [...desktop, ...cloud];
}

/** The row's subline: where it runs — the folder's last segment on a desktop
 *  (else its age), `Cloud · <repo>` in the cloud. */
export function sessionSubline(input: { locus: Locus; path?: string; source?: { kind?: string; repo?: string } | null; age: string }): string {
  if (input.locus === 'cloud') return cloudLabel(input.source);
  return input.path ? lastSeg(input.path) : input.age;
}

/** The status mark at the row's left: idle, running, or waiting for you. */
export type SessionMark = 'idle' | 'running' | 'waiting';
export function sessionMark(activity: 'working' | 'waiting' | undefined): SessionMark {
  return activity === 'working' ? 'running' : activity === 'waiting' ? 'waiting' : 'idle';
}

/** The turn's user/assistant messages as the server thread store holds them
 *  (the app's CodeMsg shape, verbatim: role + text + at). */
export function toStoredMessages(msgs: ReadonlyArray<{ role: string; text: string }>): Array<{ role: string; text: string; at: number }> {
  const at = Date.now();
  return msgs.filter((m) => typeof m.text === 'string').map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text, at }));
}
