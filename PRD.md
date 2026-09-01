# PRD — addon.epoch (ResonantOS 2.0.0-alpha add-on)

Status: approved by Simon 2026-09-01 ("3 is approved"). Third add-on in the
family, built to the exact pattern of the two published siblings
(`addons/stack-bench`, `addons/delegation-bench`).

## Goal

Expose the read-only estimation mathematics of
[@kyanitelabs/epoch](https://github.com/KyaniteLabs/Epoch) v0.5.0
(Apache-2.0) as a ResonantOS local-service add-on: PERT, COCOMO II,
Monte Carlo schedule simulation, sprint forecasting, business-day math,
time math, and token cost estimation — in-process, stateless, offline,
with **zero persistence and zero state-writes**.

Epoch's own feedback/self-improvement machinery (`record_actual`,
`batch_record_actuals`, calibration, feedback health, telemetry) stays out
of the add-on entirely. The add-on is a pure calculator.

## Architecture decision (verified, not assumed)

Epoch is Node/ESM (`"type": "module"`, tsup-built dist). Constraint 1 says
the service spawns no subprocess and imports Epoch's dist in-process.

- **Verified**: `dist/chunk-V7N6FMO6.js` (exports `TOOL_REGISTRY` — the
  zod-validated per-tool handler table) and its dependency
  `dist/chunk-K22BNBU4.js` import cleanly in-process under Node >= 22.
  No ESM/CJS friction. **Path taken: in-process import. No vendoring of
  rewritten/bundled upstream code.**
- **Critical upstream finding**: Epoch's `dispatch()` is NOT read-only —
  it records estimates/tool-calls to the feedback store and telemetry.
  The wrapper therefore calls `TOOL_REGISTRY.get(tool).handler(params)`
  directly, bypassing `dispatch` and its write path. Verified empirically:
  with `HOME` pointed at an empty sandbox, importing both chunks and
  exercising every wrapped handler (including the pert learned-correction
  read path) creates **zero files** and writes nothing.
- **Dependency closure**: the two chunks need `zod@4.4.3`,
  `date-fns@4.4.0` (ESM), `date-fns-tz@3.2.0` (CJS), plus
  `dist/reference-database.json`. Vendored via `scripts/vendor-epoch.mjs`:
  the byte-identical dist chunks + the exact static ESM import closure of
  zod/date-fns (esbuild `--metafile`, 383 files) + date-fns-tz kept whole
  (CJS lazy requires are not statically analyzable; 112 files, 572 KB) +
  upstream LICENSE + NOTICE + pinned package.json. Total ~400 files,
  ~1.4 MB. Every vendored file is SHA-256-pinned in
  `VENDOR-MANIFEST.json` and re-verified by tests (A4). Any ESM closure
  gap fails loudly at import time (static graph), which the full test
  suite exercises.

## Service surface

`server.mjs` — Node stdlib only (`node:http`), binds `127.0.0.1:4891`
(STACKBENCH-style `EPOCH_PORT` env override, dev only), exits **78** on
bind conflict. Protocol mirrors the sibling shim exactly:

- `GET /` and `GET /health` → 200 status JSON.
- `POST /` with JSON `{"method": ..., "params": {...}}` envelope.
  No other envelope fields. Body must be a JSON object, 1..65536 bytes.
- Long-running estimates: none. All Epoch math is <1 s (100k-iteration
  Monte Carlo measured at ~130 ms), so there are **no job semantics** —
  every call is synchronous request→response (deliberate, per constraint 4).
- Nothing is ever written to disk. Home-path redaction (sibling pattern)
  is still applied to every outbound body as defense in depth.

### Methods

| method | params | result |
|---|---|---|
| `epoch.status` | `{}` | `{ok, addon, version, upstream, tools}` |
| `epoch.estimate` | `{tool: <enum 12 names>, params: <tool params>}` | upstream handler result `{ok, data}` or 400 |

`epoch.estimate.tool` accepts exactly the 12 read-only tools below
(enum-enforced). State-writing tools are excluded by construction — the
wrapper's allowlist never references them and `dispatch` is never called.

### Wrapped tools (upstream handler, upstream zod schema, upstream semantics)

| tool | what it computes | bounded params |
|---|---|---|
| `get_current_time` | current time in an IANA tz | tz string <= 128 |
| `convert_timezone` | ISO-8601 → target tz | strings <= 128 |
| `parse_duration` | `"2h30m"` → seconds | string <= 128 |
| `time_math` | add_days / add_business_days / diff / convert_tz / parse_nl / format_duration | operands object <= 32 keys, values bounded |
| `add_business_days` | date + N business days (US/UK/FR/DE/JP holidays) | days −100000..100000 (upstream W1 bound) |
| `count_business_days` | business days between dates | same calendars |
| `pert_estimate` | PERT E=(O+4M+P)/6, variance, intervals | positive numbers ≤ 1e12 |
| `cocomo_estimate` | COCOMO II person-months, AI factors | kloc > 0 ≤ 1e6 |
| `sprint_forecast` | sprints from velocity history | history 1..52 entries, points ≤ 1e9 |
| `monte_carlo_schedule` | seeded schedule simulation | tasks 1..500 (upstream), iterations 1..100000 |
| `token_cost_estimate` | seconds + cost for a model | tokens > 0 ≤ 1e9 |
| `compare_models` | cross-model cost comparison | same |

### Validation layers (strictest wins)

1. **Envelope** (service): object only, exactly `method`+`params`, body
   ≤ 64 KB, Content-Length honest (lying body → 408 + close via
   `server.requestTimeout`), oversized → 413 + close, chunked/absent
   length → 400 + close, control chars anywhere → 400.
2. **Params** (service, schema-driven from the table above): no unknown
   fields (deep), bounded numbers, enums, patterns, string length caps,
   finite JSON numbers only, depth ≤ 4. Stricter than upstream where
   upstream coerces (e.g. `z.coerce.number()` accepts `"5"`; the add-on
   rejects non-numeric JSON types).
3. **Upstream zod schema** (in-process handler): semantic validation,
   refines (O ≤ M ≤ P), defaults. Handler `ok:false` / `ZodError` →
   HTTP 400 with the upstream message; unexpected throw → 500 with a
   generic, path-free message.

## Manifest

`addon.json` mirrors the sibling shape exactly: `id: addon.epoch`,
`category: tool`, `runtimeType: local-service`, `surfaces: []`,
`network:self` capability (requested ungranted + `epoch-estimation-local`
grant preset), `provenance: sideloaded-unverified`,
`isolation: host-mediated-service`, `health: http-json-status`,
`service.entrypoint: http://127.0.0.1:4891`,
`healthCommand: epoch.status`, two tools with full JSON schemas + audit,
`installHooks.onInstall`, `compatibility`. Gate A1: the REAL
2.0.0-alpha validator (`validateAddOnManifest`, `source: "sideload"`)
must report **0 errors AND 0 warnings** via `run-validator-check.sh`.

## Acceptance criteria

- **A1 Validator 0/0** — `sh run-validator-check.sh <2.0.0-alpha-clone>`
  passes with zero errors and zero warnings.
- **A2 Status/health** — `GET /health` and `epoch.status` return 200 with
  `ok:true`, addon id, upstream version.
- **A3 Real estimate round-trips** — PERT (0.5, 2, 8 h) → `expected`
  exactly **2.75**, stdDev 1.25; `add_business_days` from Fri 2026-09-04
  +3 US → 2026-09-10 (weekend skipped); `count_business_days`
  2026-09-04 → 2026-09-08 US → 1; cocomo kloc=10 → positive person-month
  fields; monte-carlo same-seed deterministic; sprint forecast sane;
  time/parse/token tools respond with upstream-shaped data.
- **A4 Hash pin** — every file in `VENDOR-MANIFEST.json` re-hashes
  identically; dist chunks additionally byte-compared against the
  upstream checkout when present.
- **A5 Upstream suite** — upstream's own vitest suite runs green in the
  upstream repo at the pinned version (documented evidence; the vendored
  artifact is dist-only, upstream tests test `src/`, so they are not
  part of the add-on tree — skip is documented here and in README).
- **A6 Adversarial** — unknown tool 400; unknown method 404; bad params
  400 (upstream refine respected); oversized body 413 + connection
  close; lying Content-Length → 408 + close; chunked body → 400; control
  chars → 400; unknown envelope field → 400; no secrets: the service
  reads no credentials, and no `$HOME` path ever appears in a response
  (redaction) or in any persisted artifact (none exist).
- **A7 Docs/tree clean** — README documents node >= 22, port 4891,
  dev-only env overrides; LICENSE (Apache-2.0) + NOTICE present; tree
  scan shows no secrets, no build artifacts, no home paths.
- **A9 Internal-API pin** — `TOOL_REGISTRY` is exactly the upstream
  24-tool set; every allowlisted tool resolves to a handler; the wrapper
  never imports `dispatch`.
- **A10 Concurrency** — status calls succeed while a heavy
  `monte_carlo_schedule` (100k iterations) is in flight; 20 concurrent
  requests all served (Node event-loop concurrency; requests serialize
  only on the sub-130 ms compute itself).

## Non-goals

- No persistence, no feedback loop, no calibration writes, no telemetry,
  no config files, no `var/` directory, no subprocesses, no network
  egress (loopback bind only), no secrets.
- Tools that read Epoch feedback state (`get_pending_estimates`,
  `feedback_health`) and writers (`record_actual`, `batch_record_actuals`,
  `calibrate_estimates`) are excluded; so are estimation tools that
  depend on that state's write path being active
  (`reference_class_estimate`, `estimate_from_context`,
  `critical_path`, `schedule_risk`, `cocomo_validate`,
  `cocomo_ground_truth`, `token_time_bridge`, `accuracy_trend`) — parked,
  not rejected; they can join later behind the same pattern if wanted.

## Publishing gate

All gates green (validator 0/0, suite green twice, review clean, live
matrix 8/8, privacy scan clean) → publish
`https://github.com/simongonzalezdc/resonant-epoch` (public), verify
remote HEAD == local, open. Any unfixable failure → STOP, document here,
do not publish.
