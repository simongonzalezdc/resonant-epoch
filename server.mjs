#!/usr/bin/env node
// addon.epoch local-service entry (http-json on 127.0.0.1:4891).
//
// ResonantOS add-on contract: protocol http-json, healthCommand epoch.status.
// Node >= 22 standard library only (node:http/node:net); NO subprocesses, NO
// shell, NO secrets, NO persistence. The vendored @kyanitelabs/epoch dist is
// imported IN-PROCESS from ./vendor/ and called through TOOL_REGISTRY handlers
// directly — deliberately NOT through Epoch's own dispatch(), which records
// estimates/tool-calls to the feedback store and telemetry. The add-on is a
// pure calculator: the 12-tool allowlist below is the entire exposed surface
// and contains no state-writing tool.
//
// Framing mirrors the stack-bench sibling shim: JSON {"method","params"}
// envelope, body 1..65536 bytes, oversized -> 413 + close, lying
// Content-Length -> 408 (explicit body-receipt deadline) + close,
// chunked -> 400, control chars -> 400, bind conflict -> exit 78. Every
// outbound body passes through home-path redaction (nothing is persisted, so
// this is defense in depth, matching the sibling pattern).
//
// All Epoch math is <1 s, so there are no job semantics: every call answers
// synchronously.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TOOL_REGISTRY } from "./vendor/epoch/chunk-V7N6FMO6.js";

const ADDON_ROOT = path.dirname(fileURLToPath(import.meta.url));
const ADDON_ID = "addon.epoch";
const ADDON_VERSION = "0.1.0";
const PINNED = JSON.parse(readFileSync(path.join(ADDON_ROOT, "vendor/epoch/package.json"), "utf8"));
const UPSTREAM_LABEL = `@kyanitelabs/epoch@${PINNED.version}`;

const PORT = parseDevPort(); // dev override only; the manifest entrypoint (4891) is the contract
const REQUEST_TIMEOUT_MS = parseDevTimeout(); // default 30000: a lying Content-Length must not pin a socket
const MAX_BODY = 64 * 1024;
const MAX_STR = 2048; // global cap for any string; schemas below cap tighter
const MAX_DEPTH = 4;

// The read-only allowlist. Everything else in TOOL_REGISTRY (record_actual,
// batch_record_actuals, calibrate_estimates, feedback state readers, ...) is
// unreachable through this service by construction.
const ALLOWED_TOOLS = Object.freeze([
  "get_current_time",
  "convert_timezone",
  "parse_duration",
  "time_math",
  "add_business_days",
  "count_business_days",
  "pert_estimate",
  "cocomo_estimate",
  "sprint_forecast",
  "monte_carlo_schedule",
  "token_cost_estimate",
  "compare_models",
]);

// -- strict service-level param schemas (stricter than upstream where upstream
//    coerces; upstream zod schemas re-validate semantics inside the handler) --

const TASK_TYPES = ["feature", "bugfix", "refactor", "migration", "infrastructure", "documentation", "testing", "design"];
const AI_NATIVE = { type: "ai_native" };
const UNIT_ENUM = ["hours", "days", "weeks", "months"];
const POS_NUM = (max) => ({ type: "number", exclusiveMin: 0, max });
const NUM_RANGE = (min, max) => ({ type: "number", min, max });
const STR = (maxLen) => ({ type: "string", maxLen });
const DATE_STR = STR(32);
const LABEL_STR = STR(256);
const TASK_TYPE_FIELD = { type: "string", enum: TASK_TYPES };

const SCHEMAS = {
  get_current_time: { props: { timezone: STR(128) }, req: [] },
  convert_timezone: { props: { timestamp: STR(128), target_tz: STR(128) }, req: ["timestamp", "target_tz"] },
  parse_duration: { props: { duration_string: STR(128) }, req: ["duration_string"] },
  time_math: {
    props: {
      operation: { type: "string", enum: ["add_days", "add_business_days", "diff", "convert_tz", "parse_nl", "format_duration"] },
      operands: { type: "freeform_object", maxKeys: 32, valueStrMaxLen: 256, valueNumAbsMax: 1e12 },
    },
    req: ["operation", "operands"],
  },
  add_business_days: {
    props: { start_date: DATE_STR, days: { type: "integer", min: -100000, max: 100000 }, country: { type: "string", maxLen: 2, pattern: /^[A-Za-z]{2}$/ } },
    req: ["start_date", "days"],
  },
  count_business_days: {
    props: { start_date: DATE_STR, end_date: DATE_STR, country: { type: "string", maxLen: 2, pattern: /^[A-Za-z]{2}$/ } },
    req: ["start_date", "end_date"],
  },
  pert_estimate: {
    props: {
      optimistic: POS_NUM(1e12), most_likely: POS_NUM(1e12), pessimistic: POS_NUM(1e12),
      unit: { type: "string", enum: UNIT_ENUM }, task_type: TASK_TYPE_FIELD, ai_native: AI_NATIVE,
      complexity: NUM_RANGE(1, 5), task_label: LABEL_STR, project: LABEL_STR, session_id: LABEL_STR,
    },
    req: ["optimistic", "most_likely", "pessimistic"],
  },
  cocomo_estimate: {
    props: {
      kloc: POS_NUM(1e6),
      reasoning_complexity: NUM_RANGE(0.5, 2), context_completeness: NUM_RANGE(0.5, 2),
      transformation_impact: NUM_RANGE(0.5, 2), iterative_cycles: NUM_RANGE(0.5, 10),
      human_oversight: NUM_RANGE(0.5, 2),
      task_type: TASK_TYPE_FIELD, ai_native: AI_NATIVE, task_label: LABEL_STR, project: LABEL_STR, session_id: LABEL_STR,
    },
    req: ["kloc"],
  },
  sprint_forecast: {
    props: {
      backlog_points: POS_NUM(1e9),
      velocity_history: { type: "array", minItems: 1, maxItems: 52, items: POS_NUM(1e9) },
      sprint_length_days: POS_NUM(366), hours_per_sprint: POS_NUM(1e5),
      task_type: TASK_TYPE_FIELD, ai_native: AI_NATIVE, task_label: LABEL_STR, project: LABEL_STR, session_id: LABEL_STR,
    },
    req: ["backlog_points", "velocity_history"],
  },
  monte_carlo_schedule: {
    props: {
      tasks: {
        type: "array", minItems: 1, maxItems: 500,
        items: {
          type: "object",
          props: { name: STR(256), optimistic: POS_NUM(1e12), most_likely: POS_NUM(1e12), pessimistic: POS_NUM(1e12) },
          req: ["name", "optimistic", "most_likely", "pessimistic"],
        },
      },
      iterations: { type: "integer", min: 1, max: 100000 },
      seed: { type: "integer", min: -(2 ** 53 - 1), max: 2 ** 53 - 1 },
      target_hours: POS_NUM(1e12),
      task_type: TASK_TYPE_FIELD, task_label: LABEL_STR, project: LABEL_STR, session_id: LABEL_STR,
    },
    req: ["tasks"],
  },
  token_cost_estimate: {
    props: { tokens: POS_NUM(1e9), model: STR(64), tool_calls: NUM_RANGE(0, 1e6), reasoning_depth: { type: "string", enum: ["shallow", "moderate", "deep"] }, task_type: TASK_TYPE_FIELD },
    req: ["tokens", "model"],
  },
  compare_models: {
    props: { tokens: POS_NUM(1e9), tool_calls: NUM_RANGE(0, 1e6), reasoning_depth: { type: "string", enum: ["shallow", "moderate", "deep"] }, sort_by: { type: "string", enum: ["cost", "time"] } },
    req: ["tokens"],
  },
};

function parseDevPort() {
  const raw = process.env.EPOCH_PORT;
  if (raw === undefined) return 4891;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    process.stderr.write("epoch-service: EPOCH_PORT must be an integer in 1..65535\n");
    process.exit(78);
  }
  return n;
}

function parseDevTimeout() {
  const raw = process.env.EPOCH_REQUEST_TIMEOUT_MS;
  if (raw === undefined) return 30000;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1000 || n > 300000) {
    process.stderr.write("epoch-service: EPOCH_REQUEST_TIMEOUT_MS must be an integer in 1000..300000\n");
    process.exit(78);
  }
  return n;
}

function hasControlChars(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function checkString(value, spec) {
  if (typeof value !== "string") return `must be a string`;
  if (value.length > (spec.maxLen ?? MAX_STR)) return `must be at most ${spec.maxLen ?? MAX_STR} characters`;
  if (hasControlChars(value)) return "contains control characters";
  if (spec.pattern && !spec.pattern.test(value)) return "has an unsupported format";
  if (spec.enum && !spec.enum.includes(value)) return "has an unsupported value";
  return null;
}

function checkNumber(value, spec) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "must be a finite JSON number";
  if (spec.type === "integer" && !Number.isInteger(value)) return "must be an integer";
  if (spec.exclusiveMin !== undefined && value <= spec.exclusiveMin) return `must be > ${spec.exclusiveMin}`;
  if (spec.min !== undefined && value < spec.min) return `must be >= ${spec.min}`;
  if (spec.max !== undefined && value > spec.max) return `must be <= ${spec.max}`;
  return null;
}

// Returns an error string or null. Enforces: no unknown fields (deep), types,
// bounds, enums, patterns, string caps, array caps, depth cap.
function validateAgainstSpec(value, spec, where, depth) {
  if (depth > MAX_DEPTH) return `${where} is nested too deeply`;
  switch (spec.type) {
    case "string": {
      const err = checkString(value, spec);
      return err && `${where} ${err}`;
    }
    case "number":
    case "integer": {
      const err = checkNumber(value, spec);
      return err && `${where} ${err}`;
    }
    case "boolean":
      return (typeof value !== "boolean" && `${where} must be a boolean`) || null;
    case "ai_native":
      if (typeof value === "boolean") return null;
      return (checkNumber(value, { type: "number", min: 0, max: 1 }) && `${where} must be a boolean or a number in 0..1`) || null;
    case "array": {
      if (!Array.isArray(value)) return `${where} must be an array`;
      if (spec.minItems !== undefined && value.length < spec.minItems) return `${where} must contain at least ${spec.minItems} items`;
      if (spec.maxItems !== undefined && value.length > spec.maxItems) return `${where} must contain at most ${spec.maxItems} items`;
      for (let i = 0; i < value.length; i++) {
        const err = validateAgainstSpec(value[i], spec.items, `${where}[${i}]`, depth + 1);
        if (err) return err;
      }
      return null;
    }
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return `${where} must be an object`;
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(spec.props, key)) return `${where} has unknown field: ${key}`;
        const err = validateAgainstSpec(value[key], spec.props[key], `${where}.${key}`, depth + 1);
        if (err) return err;
      }
      for (const key of spec.req ?? []) {
        if (!Object.hasOwn(value, key)) return `${where} is missing required field: ${key}`;
      }
      return null;
    }
    case "freeform_object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return `${where} must be an object`;
      const keys = Object.keys(value);
      if (keys.length > spec.maxKeys) return `${where} must contain at most ${spec.maxKeys} keys`;
      for (const key of keys) {
        if (key.length > (spec.valueStrMaxLen ?? 256)) return `${where}.${key} key is too long`;
        if (hasControlChars(key)) return `${where} contains control characters`;
        const v = value[key];
        const ok = v === null || typeof v === "boolean" || typeof v === "number" || typeof v === "string";
        if (!ok) return `${where}.${key} must be a string, number, boolean, or null`;
        if (typeof v === "string") {
          if (v.length > spec.valueStrMaxLen) return `${where}.${key} must be at most ${spec.valueStrMaxLen} characters`;
        } else if (typeof v === "number" && (!Number.isFinite(v) || Math.abs(v) > spec.valueNumAbsMax)) {
          return `${where}.${key} must be a finite number of magnitude at most ${spec.valueNumAbsMax}`;
        }
      }
      return null;
    }
    default:
      return `${where} has an unsupported schema`;
  }
}

function validateToolParams(tool, params) {
  const spec = SCHEMAS[tool];
  if (!spec) return `unknown tool: ${tool}`;
  if (params === undefined || params === null) return null; // schema defaults apply downstream
  if (typeof params !== "object" || Array.isArray(params)) return "params must be an object";
  return validateAgainstSpec(params, { type: "object", props: spec.props, req: spec.req }, "params", 1);
}

function redact(text) {
  const home = os.homedir();
  return home && home !== "/" && home !== "~" ? text.split(home).join("~") : text;
}

function statusPayload() {
  return {
    ok: true,
    addon: ADDON_ID,
    version: ADDON_VERSION,
    upstream: UPSTREAM_LABEL,
    tools: ALLOWED_TOOLS,
  };
}

function zodMessage(err) {
  const detail = (err.issues ?? [])
    .map((i) => `${(i.path ?? []).join(".") || "(root)"}: ${i.message}`)
    .join("; ")
    .slice(0, 500);
  return detail || "invalid input";
}

function runTool(tool, params) {
  if (!ALLOWED_TOOLS.includes(tool)) {
    return { code: 400, payload: { ok: false, tool, error: `unknown tool: ${redact(String(tool))}`, allowed: ALLOWED_TOOLS } };
  }
  const paramErr = validateToolParams(tool, params);
  if (paramErr) return { code: 400, payload: { ok: false, tool, error: paramErr } };
  let result;
  try {
    result = TOOL_REGISTRY.get(tool).handler(structuredClone(params ?? {}));
  } catch (err) {
    if (err !== null && typeof err === "object" && err.name === "ZodError") {
      return { code: 400, payload: { ok: false, tool, error: zodMessage(err) } };
    }
    process.stderr.write(`epoch-service: handler error for ${tool}: ${err instanceof Error ? err.name : "non-error"}\n`);
    return { code: 500, payload: { ok: false, tool, error: "internal estimate error" } };
  }
  if (result && typeof result === "object" && result.ok) {
    return { code: 200, payload: { ok: true, tool, data: result.data } };
  }
  const upstreamError = result && typeof result === "object" ? result.error : undefined;
  const payload = { ok: false, tool, error: String(upstreamError?.message ?? "estimate failed").slice(0, 500) };
  if (typeof upstreamError?.retryHint === "string") payload.retryHint = upstreamError.retryHint.slice(0, 500);
  return { code: 400, payload };
}

function buildServer() {
  const server = createServer((req, res) => {
    const started = process.hrtime.bigint();
    const finish = (code) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      process.stderr.write(`epoch-service: ${req.method} ${req.url} ${code} ${ms.toFixed(1)}ms\n`);
    };
    if (req.method === "GET") {
      if (req.url === "/" || req.url === "/health") {
        reply(res, 200, statusPayload());
        finish(200);
      } else {
        reply(res, 404, { error: "not found" }, true);
        finish(404);
      }
      return;
    }
    if (req.method !== "POST") {
      reply(res, 405, { error: "method not allowed" }, true);
      finish(405);
      return;
    }
    handlePost(req, res, finish);
  });
  // Header-phase stall safety (belt and suspenders; the body deadline in
  // handlePost is the actual lying-Content-Length enforcement).
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = Math.max(500, Math.min(10000, Math.floor(REQUEST_TIMEOUT_MS / 2)));
  server.keepAliveTimeout = 5000;
  return server;
}

function reply(res, code, payload, close = false) {
  const body = Buffer.from(redact(JSON.stringify(payload)), "utf8");
  const headers = { "Content-Type": "application/json", "Content-Length": body.length };
  if (close) headers["Connection"] = "close";
  res.writeHead(code, headers);
  res.end(body, () => {
    // never leave an undrained request body on a keep-alive socket — but if the
    // request has NOT fully arrived (e.g. a 413 was sent mid-stream), destroying
    // now would RST the connection and swallow this response on the client; a
    // drain/grace path in handlePost owns the socket in that case.
    if (close) {
      if (res.req?.complete ?? true) res.socket?.destroy();
      else res.socket?.end();
    }
  });
}

function handlePost(req, res, finish) {
  if (req.url !== "/") {
    reply(res, 404, { error: "not found" }, true);
    finish(404);
    return;
  }
  if (req.headers["transfer-encoding"]) {
    reply(res, 400, { error: "transfer-encoding is not accepted; send a fixed Content-Length" }, true);
    finish(400);
    return;
  }
  const raw = req.headers["content-length"];
  if (raw === undefined) {
    reply(res, 400, { error: "content-length is required (1..65536 bytes)" }, true);
    finish(400);
    return;
  }
  const length = Number(raw);
  if (!Number.isInteger(length)) {
    reply(res, 400, { error: "bad content-length" }, true);
    finish(400);
    return;
  }
  if (length <= 0 || length > MAX_BODY) {
    reply(res, 413, { error: "body must be 1..65536 bytes" }, true);
    finish(413);
    return;
  }
  const chunks = [];
  let received = 0;
  let settled = false;
  let bodyTimer = null;
  const fail = (code, message) => {
    if (settled) return;
    settled = true;
    reply(res, code, { error: message }, true);
    finish(code);
  };
  // A lying Content-Length must never pin a socket: Node's server.requestTimeout
  // does NOT answer 408 for a stalled request BODY (verified on Node 26 — the
  // socket just sits there), so the body deadline is enforced explicitly.
  const clearBodyTimer = () => {
    if (bodyTimer !== null) {
      clearTimeout(bodyTimer);
      bodyTimer = null;
    }
  };
  bodyTimer = setTimeout(() => {
    fail(408, "request was not received in full within the timeout; check Content-Length");
    // half-close alone would let a dishonest client pin the socket forever:
    // give the 408 a moment to reach the wire, then hard-close
    const kill = setTimeout(() => res.socket?.destroy(), 1000);
    kill.unref?.();
  }, REQUEST_TIMEOUT_MS);
  bodyTimer.unref?.();
  req.on("data", (chunk) => {
    if (settled) {
      return;
    }
    received += chunk.length;
    if (received > MAX_BODY) {
      // Drain and discard the surplus so the RST from the eventual socket
      // destroy cannot swallow the 413 on the client side; endless senders
      // are cut off by the grace timer.
      req.resume();
      clearBodyTimer();
      const grace = setTimeout(() => res.socket?.destroy(), 5000);
      grace.unref?.();
      req.on("end", () => res.socket?.destroy());
      fail(413, "body must be 1..65536 bytes");
      return;
    }
    chunks.push(chunk);
  });
  req.on("error", () => {
    clearBodyTimer();
    settled = true; // client vanished; response is moot
    res.socket?.destroy();
  });
  req.on("close", clearBodyTimer);
  req.on("end", () => {
    clearBodyTimer();
    if (settled) return;
    settled = true;
    let envelope;
    try {
      envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      reply(res, 400, { error: "body must be valid JSON" }, true);
      finish(400);
      return;
    }
    dispatchEnvelope(envelope, res, finish);
  });
}

function dispatchEnvelope(envelope, res, finish) {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    reply(res, 400, { error: "body must be a JSON object" }, true);
    finish(400);
    return;
  }
  for (const key of Object.keys(envelope)) {
    if (key !== "method" && key !== "params") {
      reply(res, 400, { error: `unknown field: ${key}` }, true);
      finish(400);
      return;
    }
  }
  const method = envelope.method;
  if (typeof method !== "string" || method.length > 64 || hasControlChars(method)) {
    reply(res, 400, { error: "method must be a short string" }, true);
    finish(400);
    return;
  }
  if (method === "epoch.status") {
    reply(res, 200, statusPayload());
    finish(200);
    return;
  }
  if (method === "epoch.estimate") {
    const params = envelope.params;
    if (params === undefined || params === null || typeof params !== "object" || Array.isArray(params)) {
      reply(res, 400, { ok: false, error: "params must be an object with a tool field" });
      finish(400);
      return;
    }
    for (const key of Object.keys(params)) {
      if (key !== "tool" && key !== "params") {
        reply(res, 400, { ok: false, error: `unknown field: ${key}` });
        finish(400);
        return;
      }
    }
    const tool = params.tool;
    if (typeof tool !== "string") {
      reply(res, 400, { ok: false, error: "tool must be a string" });
      finish(400);
      return;
    }
    const outcome = runTool(tool, params.params);
    reply(res, outcome.code, outcome.payload);
    finish(outcome.code);
    return;
  }
  reply(res, 404, { error: `unknown method: ${method}` });
  finish(404);
}

async function main() {
  const server = buildServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(PORT, "127.0.0.1", resolve);
    });
  } catch (err) {
    process.stderr.write(`epoch-service: cannot bind 127.0.0.1:${PORT} (${err.code ?? err.message}); manifest entrypoint expects this port\n`);
    process.exit(78);
  }
  process.stderr.write(`epoch-service: ${UPSTREAM_LABEL} listening on http://127.0.0.1:${PORT} (tools: ${ALLOWED_TOOLS.length})\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}

export { ADDON_ID, ADDON_VERSION, ALLOWED_TOOLS, MAX_BODY, MAX_STR, SCHEMAS, buildServer, redact, runTool, statusPayload, validateToolParams };
