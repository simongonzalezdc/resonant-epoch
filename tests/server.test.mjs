// addon.epoch wrapper tests — PRD acceptance criteria A2..A10.
//
// Runner: node's built-in test runner (the sibling suites are python unittest;
// this add-on's service is Node with exported testable functions, so the
// built-in runner is the adapted equivalent).
//
// Run:  node --test tests/          (from the add-on root)
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADDON_ID,
  ALLOWED_TOOLS,
  MAX_BODY,
  buildServer,
  redact,
  runTool,
} from "../server.mjs";
import { TOOL_REGISTRY } from "../vendor/epoch/chunk-V7N6FMO6.js";

const ADDON_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UPSTREAM = path.join(os.homedir(), "workspaces/kyanite-labs/Epoch");

// The 13 tools the PRD excludes: 5 state readers/writers + 8 parked behind the
// same pattern. ALLOWED_TOOLS (12) + EXCLUDED_TOOLS (13) must equal the
// TOOL_REGISTRY set (25) exactly — that identity is the read-only guarantee,
// so it is pinned by test rather than asserted in prose.
const EXCLUDED_TOOLS = Object.freeze([
  "get_pending_estimates",
  "feedback_health",
  "record_actual",
  "batch_record_actuals",
  "calibrate_estimates",
  "reference_class_estimate",
  "estimate_from_context",
  "critical_path",
  "schedule_risk",
  "cocomo_validate",
  "cocomo_ground_truth",
  "token_time_bridge",
  "accuracy_trend",
]);

// -- helpers -----------------------------------------------------------------

async function listenEphemeral() {
  const server = buildServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, port };
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

async function get(port, pathname) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
  return { status: res.status, body: await res.json() };
}

async function post(port, payload) {
  const res = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

// Raw-socket request for framing probes: returns the full response text and
// whether the server closed the connection.
function rawSend(port, raw, { timeoutMs = 8000, settleMs = 300 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let received = "";
    let closed = false;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve({ received, closed });
      socket.destroy();
    };
    socket.setTimeout(timeoutMs, done);
    socket.on("data", (d) => {
      received += d.toString();
      if (closed || !received.includes("\r\n\r\n")) return;
      const length = Number(/Content-Length: (\d+)/i.exec(received)?.[1] ?? NaN);
      if (Number.isNaN(length)) return;
      const bodyStart = received.indexOf("\r\n\r\n") + 4;
      if (received.length - bodyStart >= length) {
        setTimeout(done, settleMs); // a beat to observe an explicit close
      }
    });
    socket.on("close", () => {
      closed = true;
      done();
    });
    socket.on("error", (err) => {
      if (!settled) reject(err);
    });
    socket.on("connect", () => socket.write(raw));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// Spawns server.mjs as a child. Resolves once the child either exits (bind
// failure, bad env) or answers / with a 2xx.
function spawnService(env, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ADDON_ROOT, "server.mjs")], {
      env: { ...process.env, ...env, EPOCH_PORT: String(port) },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    (async () => {
      for (let i = 0; i < 80; i++) {
        if (child.exitCode !== null) return resolve({ child, stderr });
        try {
          // abort quickly: the port may be held by a non-HTTP blocker that
          // accepts but never answers, which would stall an unbounded fetch
          const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(400) });
          if (res.ok) return resolve({ child, stderr });
        } catch { /* not up yet (or probe aborted) */ }
        await new Promise((r) => setTimeout(r, 100));
      }
      reject(new Error(`service did not come up on ${port}\n${stderr}`));
    })();
  });
}

// -- A4: vendor hash pin ------------------------------------------------------

describe("A4 vendor hash pin", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ADDON_ROOT, "VENDOR-MANIFEST.json"), "utf8"));

  it("re-hashes every manifest entry identically", () => {
    assert.ok(manifest.files.length > 400, `suspiciously small manifest: ${manifest.files.length}`);
    for (const f of manifest.files) {
      const buf = fs.readFileSync(path.join(ADDON_ROOT, f.path));
      assert.equal(buf.length, f.bytes, `byte drift: ${f.path}`);
      assert.equal(createHash("sha256").update(buf).digest("hex"), f.sha256, `hash drift: ${f.path}`);
    }
  });

  it("manifests every file on disk (no extras, no missing)", () => {
    const walk = (dir, acc = []) => {
      for (const name of fs.readdirSync(dir).sort()) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) walk(p, acc);
        else acc.push(path.relative(ADDON_ROOT, p));
      }
      return acc;
    };
    const onDisk = new Set(walk(path.join(ADDON_ROOT, "vendor")));
    const pinned = new Set(manifest.files.map((f) => f.path));
    for (const p of onDisk) assert.ok(pinned.has(p), `file on disk but not pinned: ${p}`);
    for (const p of pinned) assert.ok(onDisk.has(p), `pinned but absent: ${p}`);
  });

  it("dist chunks and LICENSE are byte-identical to the upstream checkout", (t) => {
    if (!fs.existsSync(UPSTREAM)) { t.skip("upstream checkout not present"); return; }
    for (const [rel, upstreamRel] of [
      ["chunk-V7N6FMO6.js", "dist/chunk-V7N6FMO6.js"],
      ["chunk-K22BNBU4.js", "dist/chunk-K22BNBU4.js"],
      ["reference-database.json", "dist/reference-database.json"],
      ["LICENSE", "LICENSE"],
    ]) {
      const ours = fs.readFileSync(path.join(ADDON_ROOT, "vendor/epoch", rel));
      const theirs = fs.readFileSync(path.join(UPSTREAM, upstreamRel));
      assert.ok(ours.equals(theirs), `vendor drift vs upstream@${manifest.upstream.commit.slice(0, 12)}: ${rel}`);
    }
  });

  it("pins the expected upstream versions", () => {
    assert.equal(manifest.upstream.version, "0.5.0");
    assert.equal(manifest.dependencies.zod, "4.4.3");
    assert.equal(manifest.dependencies["date-fns"], "4.4.0");
    assert.equal(manifest.dependencies["date-fns-tz"], "3.2.0");
  });
});

// -- A9: internal API pin ------------------------------------------------------

describe("A9 internal API pin", () => {
  it("TOOL_REGISTRY is exactly allowed(12) + excluded(13) = the upstream set", () => {
    const names = [...TOOL_REGISTRY.keys()].sort();
    assert.equal(names.length, 25, `upstream registry changed: ${names.length} tools`);
    for (const tool of ALLOWED_TOOLS) assert.ok(TOOL_REGISTRY.has(tool), `allowed tool missing upstream: ${tool}`);
    for (const tool of EXCLUDED_TOOLS) assert.ok(TOOL_REGISTRY.has(tool), `excluded tool missing upstream: ${tool}`);
    const union = new Set([...ALLOWED_TOOLS, ...EXCLUDED_TOOLS]);
    assert.equal(union.size, 25, "allowed+excluded overlap or drift");
    for (const name of names) assert.ok(union.has(name), `tool not accounted for: ${name}`);
  });

  it("every allowed tool resolves to a handler function", () => {
    for (const tool of ALLOWED_TOOLS) {
      const entry = TOOL_REGISTRY.get(tool);
      assert.equal(typeof entry?.handler, "function", `no handler for ${tool}`);
    }
  });

  it("no excluded (state-writing or state-reading) tool is reachable", () => {
    for (const tool of EXCLUDED_TOOLS) {
      assert.ok(!ALLOWED_TOOLS.includes(tool), `excluded tool allowlisted: ${tool}`);
      const outcome = runTool(tool, {});
      assert.equal(outcome.code, 400, `excluded tool executed: ${tool}`);
    }
  });

  it("server calls registry handlers, never upstream dispatch()", () => {
    const src = fs.readFileSync(path.join(ADDON_ROOT, "server.mjs"), "utf8");
    assert.ok(!src.includes(".dispatch("), "server must not call upstream dispatch() (it writes state)");
    assert.ok(src.includes(".handler("), "server must call TOOL_REGISTRY handlers directly");
  });
});

// -- A2: status / health -------------------------------------------------------

describe("A2 status and health", () => {
  it("GET / and GET /health and epoch.status all report the pinned upstream", async () => {
    const { server, port } = await listenEphemeral();
    try {
      for (const pathname of ["/", "/health"]) {
        const { status, body } = await get(port, pathname);
        assert.equal(status, 200, pathname);
        assert.equal(body.ok, true);
        assert.equal(body.addon, ADDON_ID);
        assert.match(body.upstream, /@kyanitelabs\/epoch@0\.5\.0$/);
        assert.deepEqual(body.tools, ALLOWED_TOOLS);
      }
      const { status, body } = await post(port, { method: "epoch.status" });
      assert.equal(status, 200);
      assert.equal(body.ok, true);
    } finally {
      await closeServer(server);
    }
  });
});

// -- A3: real estimate round-trips --------------------------------------------

describe("A3 real estimate round-trips", () => {
  const state = {};
  before(async () => {
    const { server, port } = await listenEphemeral();
    state.server = server;
    state.port = port;
    state.estimate = (tool, params) => post(port, { method: "epoch.estimate", params: { tool, params } });
  });
  after(async () => {
    await closeServer(state.server);
  });

  it("PERT (0.5, 2, 8 hours) -> expected exactly 2.75, stdDeviation 1.25", async () => {
    const { status, body } = await state.estimate("pert_estimate", { optimistic: 0.5, most_likely: 2, pessimistic: 8, unit: "hours" });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.data.expected, 2.75);
    assert.equal(body.data.stdDeviation, 1.25);
  });

  it("add_business_days Fri 2026-09-04 +3 US -> 2026-09-10 (weekend skipped)", async () => {
    const { status, body } = await state.estimate("add_business_days", { start_date: "2026-09-04", days: 3, country: "US" });
    assert.equal(status, 200);
    assert.equal(body.data.endDate, "2026-09-10");
    assert.equal(body.data.businessDays, 3);
  });

  it("count_business_days 2026-09-04 -> 2026-09-08 US -> 1", async () => {
    const { status, body } = await state.estimate("count_business_days", { start_date: "2026-09-04", end_date: "2026-09-08", country: "US" });
    assert.equal(status, 200);
    assert.equal(body.data.businessDays, 1);
  });

  it("cocomo kloc=10 -> positive person-month fields", async () => {
    const { status, body } = await state.estimate("cocomo_estimate", { kloc: 10 });
    assert.equal(status, 200);
    assert.ok(body.data.personMonthsNominal > 0);
    assert.ok(body.data.personMonthsLlmAdjusted > 0);
  });

  it("monte_carlo_schedule is same-seed deterministic and converged", async () => {
    const req = { method: "epoch.estimate", params: {
      tool: "monte_carlo_schedule",
      params: {
        tasks: [
          { name: "a", optimistic: 1, most_likely: 2, pessimistic: 4 },
          { name: "b", optimistic: 2, most_likely: 3, pessimistic: 9 },
        ],
        iterations: 10000,
        seed: 42,
      },
    } };
    const first = await post(state.port, req);
    const second = await post(state.port, req);
    assert.equal(first.status, 200);
    assert.equal(JSON.stringify(first.body), JSON.stringify(second.body), "same seed must be deterministic");
    assert.equal(first.body.data.converged, true);
    assert.ok(first.body.data.p50 !== undefined);
  });

  it("sprint_forecast 120 points at velocity ~30 -> 4 sprints", async () => {
    const { status, body } = await state.estimate("sprint_forecast", { backlog_points: 120, velocity_history: [30, 28, 32, 31] });
    assert.equal(status, 200);
    assert.ok(body.data.requiredSprints >= 4);
    assert.ok(body.data.averageVelocity > 25 && body.data.averageVelocity < 35);
  });

  it("time tools: parse_duration, time_math, convert_timezone, get_current_time", async () => {
    const parsed = await state.estimate("parse_duration", { duration_string: "2h30m" });
    assert.equal(parsed.status, 200);
    assert.equal(parsed.body.data.totalSeconds, 9000);

    const math = await state.estimate("time_math", { operation: "add_days", operands: { date: "2026-09-04", days: 3 } });
    assert.equal(math.status, 200);
    assert.equal(math.body.data, "2026-09-07");

    const conv = await state.estimate("convert_timezone", { timestamp: "2026-09-01T10:00:00Z", target_tz: "America/New_York" });
    assert.equal(conv.status, 200);
    assert.equal(conv.body.data.timezone, "America/New_York");

    const now = await state.estimate("get_current_time", { timezone: "UTC" });
    assert.equal(now.status, 200);
    assert.match(now.body.data.iso, /^20\d\d-/);
  });

  it("token tools respond with upstream-shaped data", async () => {
    const tok = await state.estimate("token_cost_estimate", { tokens: 100000, model: "gpt-4o" });
    assert.equal(tok.status, 200);
    assert.ok(tok.body.data);
    const cmp = await state.estimate("compare_models", { tokens: 100000 });
    assert.equal(cmp.status, 200);
    assert.ok(cmp.body.data);
  });

  it("upstream refine respected: optimistic > pessimistic -> 400 with upstream message", async () => {
    const { status, body } = await state.estimate("pert_estimate", { optimistic: 9, most_likely: 2, pessimistic: 1 });
    assert.equal(status, 400);
    assert.match(body.error, /0 < optimistic <= most_likely <= pessimistic/);
  });
});

// -- A6: adversarial matrix -----------------------------------------------------

describe("A6 adversarial matrix", () => {
  const state = {};
  before(async () => {
    const { server, port } = await listenEphemeral();
    state.server = server;
    state.port = port;
    state.estimate = (tool, params) => post(port, { method: "epoch.estimate", params: { tool, params } });
  });
  after(async () => {
    await closeServer(state.server);
  });

  it("unknown tool -> 400 with the allowed list", async () => {
    const { status, body } = await state.estimate("record_actual", { actual_hours: 5 });
    assert.equal(status, 400);
    assert.match(body.error, /unknown tool/);
    assert.deepEqual(body.allowed, ALLOWED_TOOLS);
  });

  it("unknown method -> 404", async () => {
    const { status } = await post(state.port, { method: "epoch.nothing" });
    assert.equal(status, 404);
  });

  it("unknown envelope field -> 400", async () => {
    const res = await fetch(`http://127.0.0.1:${state.port}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "epoch.status", extra: 1 }),
    });
    assert.equal(res.status, 400);
  });

  it("bad params shapes -> 400 (service layer, stricter than upstream)", async () => {
    for (const params of ["string", 42, [], true]) {
      const { status } = await post(state.port, { method: "epoch.estimate", params: { tool: "pert_estimate", params } });
      assert.equal(status, 400, `params=${JSON.stringify(params)}`);
    }
    const { status } = await post(state.port, { method: "epoch.estimate", params: { tool: 42 } });
    assert.equal(status, 400);
  });

  it("coerced types rejected: string where number belongs -> 400", async () => {
    const { status } = await state.estimate("pert_estimate", { optimistic: "5", most_likely: 2, pessimistic: 8 });
    assert.equal(status, 400);
  });

  it("unknown param fields rejected deep -> 400", async () => {
    const { status } = await state.estimate("pert_estimate", { optimistic: 1, most_likely: 2, pessimistic: 3, sneaky: "x" });
    assert.equal(status, 400);
    const nested = await state.estimate("monte_carlo_schedule", { tasks: [{ name: "a", optimistic: 1, most_likely: 2, pessimistic: 3, sneaky: 1 }] });
    assert.equal(nested.status, 400);
  });

  it("control characters in any parameter string -> 400", async () => {
    const { status } = await state.estimate("parse_duration", { duration_string: "2h\n; rm -rf /" });
    assert.equal(status, 400);
    const ctrl = await state.estimate("pert_estimate", { optimistic: 1, most_likely: 2, pessimistic: 3, task_label: "a\u0001b" });
    assert.equal(ctrl.status, 400);
  });

  it("control character in method string -> 400", async () => {
    const { status } = await post(state.port, { method: "epoch.\u0001status" });
    assert.equal(status, 400);
  });

  it("oversized body -> 413 + connection close (raw)", async () => {
    const big = JSON.stringify({ method: "epoch.estimate", params: { tool: "parse_duration", params: { duration_string: "x".repeat(MAX_BODY) } } });
    assert.ok(Buffer.byteLength(big) > MAX_BODY);
    const { received, closed } = await rawSend(state.port, `POST / HTTP/1.1\r\nHost: t\r\nContent-Length: ${Buffer.byteLength(big)}\r\n\r\n${big}`);
    assert.match(received, /^HTTP\/1\.1 413/);
    assert.match(received, /Connection: close/i);
    assert.ok(closed, "server must close after 413");
  });

  it("content-length over limit declared up front -> 413 (raw)", async () => {
    const { received, closed } = await rawSend(state.port, `POST / HTTP/1.1\r\nHost: t\r\nContent-Length: ${MAX_BODY + 1}\r\n\r\n`);
    assert.match(received, /^HTTP\/1\.1 413/);
    assert.ok(closed);
  });

  it("chunked transfer-encoding -> 400 (raw)", async () => {
    const body = JSON.stringify({ method: "epoch.status" });
    const raw = `POST / HTTP/1.1\r\nHost: t\r\nTransfer-Encoding: chunked\r\n\r\n${Buffer.byteLength(body).toString(16)}\r\n${body}\r\n0\r\n\r\n`;
    const { received, closed } = await rawSend(state.port, raw);
    assert.match(received, /^HTTP\/1\.1 400/);
    assert.ok(closed);
  });

  it("missing content-length -> 400 (raw)", async () => {
    const { received } = await rawSend(state.port, "POST / HTTP/1.1\r\nHost: t\r\n\r\n");
    assert.match(received, /^HTTP\/1\.1 400/);
  });

  it("garbage body -> 400", async () => {
    const res = await fetch(`http://127.0.0.1:${state.port}/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
    assert.equal(res.status, 400);
  });

  it("non-object envelopes -> 400; wrong verbs/paths -> 404/405", async () => {
    for (const raw of [JSON.stringify(["array"]), JSON.stringify("str"), JSON.stringify(42)]) {
      const res = await fetch(`http://127.0.0.1:${state.port}/`, { method: "POST", body: raw });
      assert.equal(res.status, 400, raw);
    }
    assert.equal((await fetch(`http://127.0.0.1:${state.port}/nope`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${state.port}/`, { method: "DELETE" })).status, 405);
  });

  it("lying content-length -> 408 + close within the deadline (subprocess)", async () => {
    const port2 = await freePort();
    const { child } = await spawnService({ EPOCH_REQUEST_TIMEOUT_MS: "1000" }, port2);
    try {
      const t0 = Date.now();
      const { received, closed } = await rawSend(port2, "POST / HTTP/1.1\r\nHost: t\r\nContent-Length: 2000\r\n\r\n{", { timeoutMs: 8000 });
      const elapsed = Date.now() - t0;
      assert.match(received, /^HTTP\/1\.1 408/, `expected 408, got: ${received.slice(0, 60)}`);
      assert.ok(closed, "socket must close after 408");
      assert.ok(elapsed < 6000, `408 took too long: ${elapsed}ms`);
    } finally {
      child.kill();
    }
  });

  it("no $HOME path ever appears in a response", async () => {
    const home = os.homedir();
    const usersNeedle = path.sep + "Users" + path.sep; // built at runtime so this file stays clean
    const probes = [
      await get(state.port, "/health"),
      await post(state.port, { method: "epoch.status" }),
      await state.estimate("get_current_time", {}),
      await state.estimate("nope", {}),
    ];
    for (const { body } of probes) {
      const text = JSON.stringify(body);
      assert.ok(!text.includes(home), "home path leaked in response");
      assert.ok(!text.includes(usersNeedle), "Users path leaked in response");
    }
    assert.equal(redact(`${home}/models/x.gguf`), "~/models/x.gguf");
  });
});

// -- A10: concurrency -----------------------------------------------------------

describe("A10 concurrency", () => {
  it("20 concurrent requests all served; heavy monte carlo does not block others", async () => {
    const { server, port } = await listenEphemeral();
    try {
      const heavy = post(port, { method: "epoch.estimate", params: {
        tool: "monte_carlo_schedule",
        params: { tasks: [{ name: "t", optimistic: 1, most_likely: 2, pessimistic: 6 }], iterations: 100000, seed: 7 },
      } });
      const rest = [];
      for (let i = 0; i < 19; i++) {
        rest.push(i % 3 === 0
          ? post(port, { method: "epoch.status" })
          : post(port, { method: "epoch.estimate", params: { tool: "parse_duration", params: { duration_string: "1h" } } }));
      }
      const results = await Promise.all([heavy, ...rest]);
      for (const r of results) assert.ok(r.status === 200 || r.status === 400, `unexpected status ${r.status}`);
      assert.equal(results[0].status, 200);
      assert.equal(results[0].body.data.converged, true);
    } finally {
      await closeServer(server);
    }
  });
});

// -- lifecycle: bind conflict and env validation ---------------------------------

describe("service lifecycle", () => {
  it("bind conflict exits 78", async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const { port } = blocker.address();
    try {
      const { child, stderr } = await spawnService({}, port);
      // the child may already have exited (that is the expected 78 path)
      const code = child.exitCode !== null
        ? child.exitCode
        : await new Promise((resolve) => child.on("exit", (c) => resolve(c)));
      assert.equal(code, 78, `expected exit 78, stderr: ${stderr}`);
    } finally {
      blocker.close();
    }
  });

  it("invalid EPOCH_PORT -> exit 78", async () => {
    const child = spawn(process.execPath, [path.join(ADDON_ROOT, "server.mjs")], {
      env: { ...process.env, EPOCH_PORT: "not-a-port" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const code = await new Promise((resolve) => child.on("exit", (c) => resolve(c)));
    assert.equal(code, 78);
  });
});

// -- A7: tree scan ---------------------------------------------------------------

describe("A7 tree hygiene", () => {
  it("no home paths, no secret-shaped strings anywhere in the tree", () => {
    const needle = Buffer.from(path.sep + "Users" + path.sep);
    const homeBuf = Buffer.from(os.homedir());
    const secretRes = [
      /AKIA[0-9A-Z]{16}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /gh[pousr]_[A-Za-z0-9]{20,}/,
      /sk-[A-Za-z0-9-]{20,}/,
    ];
    const walk = (dir, acc = []) => {
      for (const name of fs.readdirSync(dir).sort()) {
        if (name === ".git") continue;
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) walk(p, acc);
        else acc.push(p);
      }
      return acc;
    };
    for (const file of walk(ADDON_ROOT)) {
      const rel = path.relative(ADDON_ROOT, file);
      const content = fs.readFileSync(file);
      assert.ok(!content.includes(needle), `home path leaked in ${rel}`);
      assert.ok(!content.includes(homeBuf), `homedir leaked in ${rel}`);
      const text = /\.(js|mjs|json|md|sh)$/.test(file) ? content.toString() : "";
      for (const re of secretRes) assert.ok(!re.test(text), `secret-shaped string in ${rel}`);
    }
  });
});
