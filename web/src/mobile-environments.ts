/**
 * mobile-environments.ts — the phone's door to the member's NAMED cloud
 * environments (his direction, 2026-10-05: personal environments), over the
 * SDK's `environments` resource (resources/environments.ts: list · get ·
 * create · update · delete). Like mobile-git.ts, the calls fall back to the
 * SDK's raw authenticated door (`client.http`) when a bundled SDK predates
 * the typed resource, so the phone works against either.
 *
 * The variable VALUES never come back: `get` carries the keys with a masked
 * preview; the sheet shows those and sends `vars` only when the member edited
 * the text.
 */
import { glyphh } from './glyphh-web.js';
import type { EnvironmentNetwork, EnvironmentRow, EnvironmentVarRow } from './mobile-cloud';

export interface EnvironmentDetail extends EnvironmentRow { vars: EnvironmentVarRow[] }
interface CreateInput { name: string; network: EnvironmentNetwork; vars?: string }
interface UpdateInput { name?: string; network?: EnvironmentNetwork; vars?: string }

interface EnvironmentsDoor {
  list(): Promise<EnvironmentRow[]>;
  get(id: string): Promise<EnvironmentDetail>;
  create(input: CreateInput): Promise<EnvironmentDetail>;
  update(id: string, input: UpdateInput): Promise<EnvironmentDetail>;
  delete(id: string): Promise<void>;
}
interface RawDoor {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}
const typed = (): EnvironmentsDoor | undefined => (glyphh() as unknown as { environments?: EnvironmentsDoor }).environments;
const raw = (): RawDoor => (glyphh() as unknown as { http: RawDoor }).http;
const path = (id: string): string => `/api/environments/${encodeURIComponent(id)}`;

const row = (r: Partial<EnvironmentRow> | null | undefined): EnvironmentRow => ({
  id: String(r?.id ?? ''), name: String(r?.name ?? ''), network: (r?.network ?? 'full') as EnvironmentNetwork, varCount: Number(r?.varCount ?? 0),
});
const detail = (d: Partial<EnvironmentDetail> | null | undefined): EnvironmentDetail => ({
  ...row(d),
  vars: (Array.isArray(d?.vars) ? d.vars : []).filter((v) => typeof v?.key === 'string').map((v) => ({ key: String(v.key), preview: String(v.preview ?? '•••••') })),
});

export const mobileEnvironments = {
  /** The member's own environments. A failed read is an empty list (never a
   *  throw — the sheet still lists Default). */
  async list(): Promise<EnvironmentRow[]> {
    try {
      const t = typed();
      const rows = t ? await t.list() : await raw().get<EnvironmentRow[]>('/api/environments');
      return (Array.isArray(rows) ? rows : []).map(row).filter((r) => r.id);
    } catch { return []; }
  },

  async get(id: string): Promise<EnvironmentDetail> {
    const t = typed();
    return detail(t ? await t.get(id) : await raw().get<EnvironmentDetail>(path(id)));
  },

  async create(input: CreateInput): Promise<EnvironmentDetail> {
    const t = typed();
    return detail(t ? await t.create(input) : await raw().post<EnvironmentDetail>('/api/environments', input));
  },

  async update(id: string, input: UpdateInput): Promise<EnvironmentDetail> {
    const t = typed();
    return detail(t ? await t.update(id, input) : await raw().put<EnvironmentDetail>(path(id), input));
  },

  async delete(id: string): Promise<void> {
    const t = typed();
    if (t) await t.delete(id); else await raw().del<void>(path(id));
  },

  /** The words for a failed save: the SDK's ApiError carries the server's
   *  message (the bad line, the name clash) and the status. */
  saveError(err: unknown): string {
    const status = (err as { httpStatus?: number } | null)?.httpStatus;
    const said = err instanceof Error ? err.message : '';
    if (status === 409) return said || 'You already have an environment with that name';
    if (status === 404) return 'This environment is gone — it was deleted elsewhere';
    return said || 'The environment could not be saved.';
  },
};
