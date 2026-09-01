# Epoch — ResonantOS add-on

The read-only estimation mathematics of
[@kyanitelabs/epoch](https://github.com/KyaniteLabs/Epoch) v0.5.0
(Apache-2.0), packaged as a ResonantOS 2.0.0-alpha local-service add-on:
PERT, COCOMO II, Monte Carlo schedule simulation, sprint forecasting,
business-day math, time math, and token cost estimation.

It is a pure calculator. Epoch's own feedback/self-improvement machinery
(`record_actual`, `batch_record_actuals`, `calibrate_estimates`, the
calibration and feedback-state readers, telemetry) is excluded **by
construction**: the service imports the vendored dist in-process and calls
the per-tool handlers directly — it never invokes upstream `dispatch()`,
which writes estimates to a feedback store. Nothing is ever persisted: no
`var/`, no config files, no state writes of any kind.

## What it does

- `epoch.status` — service version, pinned upstream version, tool list.
- `epoch.estimate` — run one of the 12 exposed read-only tools with upstream
  semantics and upstream zod validation:

  `pert_estimate` · `cocomo_estimate` · `monte_carlo_schedule` ·
  `sprint_forecast` · `add_business_days` · `count_business_days` ·
  `time_math` · `parse_duration` · `get_current_time` · `convert_timezone` ·
  `token_cost_estimate` · `compare_models`

  Ten further upstream tools (state writers/readers plus estimation tools
  that depend on recorded history) are parked, not rejected; they can join
  later behind the same pattern.

Every call is a synchronous request→response (all Epoch math is <1 s; a
100k-iteration Monte Carlo runs in ~130 ms). The service adds its own strict
envelope and param validation on top of upstream: JSON object envelopes of
1..65536 bytes, no unknown fields anywhere, bounded numbers, string caps,
control characters refused, oversized bodies answered 413 + connection close,
lying Content-Length answered 408 + close (an explicit body-receipt deadline —
Node's own `requestTimeout` does not fire for stalled bodies), chunked
transfer-encoding refused, bind conflicts exit with code 78. Any `$HOME` path
in an outbound body is redacted to `~` as defense in depth.

## Running it

Requires Node >= 22 (standard library only; the vendored upstream dist is
imported in-process, no subprocess, no network egress beyond the loopback
bind).

    node server.mjs            # listens on http://127.0.0.1:4891 (the manifest entrypoint)

    curl -s http://127.0.0.1:4891/health
    curl -s -X POST http://127.0.0.1:4891/ -H 'Content-Type: application/json' \
      -d '{"method":"epoch.estimate","params":{"tool":"pert_estimate","params":{"optimistic":0.5,"most_likely":2,"pessimistic":8,"unit":"hours"}}}'
    curl -s -X POST http://127.0.0.1:4891/ -H 'Content-Type: application/json' \
      -d '{"method":"epoch.estimate","params":{"tool":"add_business_days","params":{"start_date":"2026-09-04","days":3,"country":"US"}}}'

Environment (dev overrides only — the manifest declares the contract):
`EPOCH_PORT` (default 4891), `EPOCH_REQUEST_TIMEOUT_MS` (default 30000,
bounded to 1000..300000). Both exit 78 on invalid values. The service reads
no credentials and accepts none as request fields.

## Vendoring

`vendor/` holds byte-identical upstream artifacts (the two dist chunks,
`reference-database.json`, LICENSE) plus the exact static ESM dependency
closure of `zod`/`date-fns` and `date-fns-tz` kept whole (its CommonJS lazy
requires are not statically analyzable). `VENDOR-MANIFEST.json` pins a
SHA-256 for every one of the 506 files; a wrapper test fails loudly on any
drift, and byte-compares the dist chunks against an upstream checkout when
one is present. Regenerate with `node scripts/vendor-epoch.mjs` (a build-time
tool; the service itself spawns nothing).

Upstream's own vitest suite targets `src/` and is intentionally not part of
this dist-only vendored tree; the pinned upstream version's suite health is
tracked in the upstream repo, and the vendored dist behavior is exercised
here through real round-trip tests (PERT expected 2.75 / stdDev 1.25 for
0.5-2-8 hours, business-day math across weekends, seeded Monte Carlo
determinism, COCOMO, sprint forecasting).

## Tests

    node --test tests/server.test.mjs                       # wrapper suite (38 tests)
    sh run-validator-check.sh <path-to-2.0.0-alpha-clone>   # manifest vs the real validator

The suite covers: vendor hash pins (A4), the read-only tool-set identity —
12 allowed + 13 excluded = the 25-tool upstream registry (A9), status/health
(A2), real estimate round-trips (A3), the adversarial matrix including
413/408/chunked/control-character handling and home-path privacy (A6),
20-request concurrency with a heavy Monte Carlo in flight (A10), bind
conflict and env-validation exit codes, and a whole-tree hygiene scan (A7).

## License

Apache-2.0 — see LICENSE and NOTICE. The vendored Epoch dist is Apache-2.0,
KyaniteLabs; the bundled zod/date-fns/date-fns-tz are MIT.
