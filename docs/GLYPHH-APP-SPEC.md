# Glyphh App Spec — where it lives

**The contract is the SDK's.** `GLYPHH_APP_SPEC` (`@glyphh/sdk`,
`sdk/src/app-spec/spec.ts`) is the one text every builder reads; the
validators are `validateAppProject` (a source folder) and `validateAppBundle`
(a built bundle); `appTemplateFiles()` is the Next.js template
(`sdk/templates/app-next/`). The **`build-glyphh-app` skill**
(`skills/build-glyphh-app/SKILL.md`) walks an agent through authoring,
deploying and rolling back an app against that spec. This page only says how
the desktop and the web carry it. The platform itself (infra, R2 layout, the
server API, the app server, the builder) is `yo/app-platform.md`.

## 1. What an app is

A Glyphh app is a **Next.js static-export project** in a folder:

```
manifest.json      kind "glyphh-app", manifestVersion 3, name, slug, description,
                   capabilities[], connectors[], tools[], worker?, window?
package.json       next + react + react-dom; scripts.build = "next build"
next.config.mjs    output 'export', trailingSlash true, basePath from GLYPHH_APP_BASE,
                   images { unoptimized: true }
app/               the app router (or pages/)
worker.js          optional — the server side: glyphh.handle, glyphh.call
```

The platform builds it into a **bundle** (`manifest.json` + `ui/` +
`worker.js`) and records the bundle as a **release** `n` of an **instance**:
`<slug>` for the organization's, `<slug>~<user>` for a personal one. The
always-on app server serves the pinned release; `pin` rolls back. The worker's
`db.exec` is **Postgres** SQL (`$1` params, one statement per call),
`vector.*` is pgvector with the org's embedding model, `graph.cypher` is
**Neo4j** Cypher — all of it in the SDK spec, none of it on a member's
machine. **The app stores and finds; the agent thinks** (no `llm.*`).

## 2. How the surfaces carry an instance

| surface | what |
|---|---|
| desktop panel | `instancePanelUrl(key)` = `${SERVER_URL}/app-host/<key>/ui/` (trailing slash; the app server resolves `index.html`, the export's `./_next/…` assets resolve under it). The session bearer rides as the panel partition's cookie (`src/main/glyphh-app-host.ts`). |
| web panel | the same path on the web origin; `web/app-host-proxy.mjs` turns the `glyphh_session` cookie (path `/app-host` only) into the bearer. |
| the shim | the page reaches the host only through the injected `window.glyphh.call(capability, args)` → `{ ok, result } \| { ok: false, error }`, as the member; `POST /app-host/<key>/call`. |
| the row | an instance is a `tab` row of kind `glyphh` in the member library whose `config.instance` names the key (`src/shared/app-instances.ts`); the Settings → Apps card shows `release n` and offers **Rollback** (pin n-1). |
| the loop | each instance's declared tools join the agent's catalog (`listInstanceTools`); a tool set to Never on the app's Tools tab is neither listed nor run from that machine. |

## 3. The MCP tools (same names and shapes on the gateway `/mcp` and the desktop's local MCP)

| tool | args | answers |
|---|---|---|
| `app_list_tools` | `{}` | `[{ app (the instance key), name, kind, status, tools: [{ name, description, inputSchema }] }]` |
| `app_call_tool` | `{ app, tool, args }` | the tool's result, run on the app server as the member (`POST …/{key}/invoke`) |
| `app_install` | `{ bundleBase64, intent: "app" }` | a BUILT bundle as an instance: create → PUT the zip → ready |
| `app_deploy` | `{ slug, kind?, note? }` | the **Code session's folder** (the thread's folder, its sandbox; `manifest.json` + `package.json` at its root; `node_modules`, `.next`, `out`, `.git` never ride) as a `.tgz` → `POST …/{key}/builds` → PUT the source → `POST …/{key}/builds/{n}/run`; answers `{ key, release, log (tail), tools }`. On the gateway the same tool takes `sourceBase64` for a cloud session. The desktop's local MCP answers it (the gateway's copy is not lent beside it: `src/main/mcp-lend.ts`). |
| `app_releases` | `{ app }` | `[{ n, sha256, sizeBytes, note, at, by, pinned }]`, oldest first |
| `app_pin` | `{ app, n }` | pins release `n` (rollback = `n-1`); the app server reloads at once |

The desktop implements them in `src/main/app-instances.ts` over the SDK's
`client.appInstances` (`list`, `create`, `fromHub`, `ready`, `releases`,
`pin`, `builds`, `runBuild`, `invoke`, `patch`, `remove`); the tools are
registered in `src/main/local-mcp-server.ts`.

## 4. Building one

1. Scaffold in the session's folder from the SDK template; follow the
   `build-glyphh-app` skill.
2. `npm install && npm run build` until it is clean.
3. `app_deploy { slug }` — the first deploy creates the instance (an org
   admin's as an org instance, anyone else's as personal; `kind` forces one),
   every deploy records and pins the next release.
4. `app_list_tools` / `app_call_tool` to use it; `app_releases` / `app_pin`
   to roll back.

Nothing of an app runs on a member's machine; a folder on the desktop is the
app's **source**, and it runs only once deployed.
