#!/usr/bin/env node

// src/lib/self-improve.ts
import {
  existsSync as existsSync6,
  readFileSync as readFileSync5,
  writeFileSync as writeFileSync2,
  renameSync,
  mkdirSync as mkdirSync5
} from "fs";
import { join as join6 } from "path";
import { homedir as homedir5 } from "os";

// src/lib/telemetry.ts
import { existsSync, mkdirSync, appendFileSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// src/lib/internal/logging.ts
function debugLog(scope, err) {
  if (process.env["EPOCH_DEBUG"] !== "1") return;
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[epoch:${scope}] ${message}
`);
}

// src/types/index.ts
function assertNever(x, message) {
  throw new Error(message ?? `Unexpected value: ${JSON.stringify(x)}`);
}

// src/lib/internal/urgency.ts
function getUrgencyCategory(hours) {
  if (hours < 2) return "short";
  if (hours <= 48) return "medium";
  return "long";
}

// src/lib/estimation.ts
function toHours(value, unit) {
  switch (unit) {
    case "hours":
      return value;
    case "days":
      return value * 8;
    case "weeks":
      return value * 40;
    case "months":
      return value * 160;
    default:
      return assertNever(unit);
  }
}
function pertEstimate(optimistic, mostLikely, pessimistic, unit) {
  if (!(optimistic > 0 && optimistic <= mostLikely && mostLikely <= pessimistic)) {
    return {
      ok: false,
      error: {
        isError: true,
        message: `PERT values must satisfy 0 < optimistic <= most_likely <= pessimistic. Got optimistic=${optimistic}, most_likely=${mostLikely}, pessimistic=${pessimistic}.`,
        retryHint: "Provide three positive estimates where optimistic is smallest and pessimistic is largest."
      }
    };
  }
  const expected = (optimistic + 4 * mostLikely + pessimistic) / 6;
  const stdDev = (pessimistic - optimistic) / 6;
  const variance = stdDev * stdDev;
  const expectedHours = toHours(expected, unit);
  if (!Number.isFinite(expected) || !Number.isFinite(stdDev)) {
    return { ok: false, error: { isError: true, message: "Computation produced invalid result.", retryHint: "Ensure all inputs are finite numbers and optimistic < mostLikely < pessimistic." } };
  }
  return {
    ok: true,
    data: {
      optimistic,
      mostLikely,
      pessimistic,
      expected: Math.round(expected * 100) / 100,
      variance: Math.round(variance * 100) / 100,
      stdDeviation: Math.round(stdDev * 100) / 100,
      confidence95: [
        Math.max(0, Math.round((expected - 2 * stdDev) * 100) / 100),
        Math.round((expected + 2 * stdDev) * 100) / 100
      ],
      confidence99: [
        Math.max(0, Math.round((expected - 3 * stdDev) * 100) / 100),
        Math.round((expected + 3 * stdDev) * 100) / 100
      ],
      unit,
      urgencyCategory: getUrgencyCategory(expectedHours),
      riskLevel: computePertRiskLevel(optimistic, mostLikely, pessimistic),
      humanReadable: `Expected: ${Math.round(expected * 100) / 100} ${unit}. 95% confidence: ${Math.max(0, Math.round((expected - 2 * stdDev) * 100) / 100)} to ${Math.round((expected + 2 * stdDev) * 100) / 100} ${unit}. 99% confidence: ${Math.max(0, Math.round((expected - 3 * stdDev) * 100) / 100)} to ${Math.round((expected + 3 * stdDev) * 100) / 100} ${unit}.`
    }
  };
}
function sprintForecast(params) {
  const { backlogPoints, velocityHistory, sprintLengthDays, hoursPerSprint } = params;
  if (velocityHistory.length === 0) {
    return {
      ok: false,
      error: {
        isError: true,
        message: "velocity_history cannot be empty. Provide at least one sprint's velocity.",
        retryHint: "Pass an array of story points completed per past sprint."
      }
    };
  }
  for (let i = 0; i < velocityHistory.length; i++) {
    const v = velocityHistory[i] ?? Number.NaN;
    if (!(v >= 0) || !Number.isFinite(v)) {
      return {
        ok: false,
        error: {
          isError: true,
          message: `velocity_history[${i}] is invalid: ${v}. Each velocity must be a non-negative finite number.`,
          retryHint: "Provide non-negative numeric velocity values for each sprint."
        }
      };
    }
  }
  if (backlogPoints <= 0) {
    return {
      ok: false,
      error: {
        isError: true,
        message: "backlog_points must be positive.",
        retryHint: "Provide a positive number for backlog_points."
      }
    };
  }
  const avgVelocity = velocityHistory.reduce((a, b) => a + b, 0) / velocityHistory.length;
  if (avgVelocity <= 0) {
    return {
      ok: false,
      error: {
        isError: true,
        message: `Average velocity is 0 across ${velocityHistory.length} sprint(s). Cannot forecast with zero velocity \u2014 the backlog will never clear.`,
        retryHint: "Include sprints with positive velocity, or estimate velocity from team capacity."
      }
    };
  }
  const requiredSprints = backlogPoints / avgVelocity;
  const conversionFactor = hoursPerSprint / avgVelocity;
  const totalHours = backlogPoints * conversionFactor;
  if (!Number.isFinite(totalHours) || !Number.isFinite(requiredSprints)) {
    return {
      ok: false,
      error: {
        isError: true,
        message: "Sprint forecast produced non-finite result. Check inputs for Infinity or extreme values.",
        retryHint: "Use reasonable values for backlog_points, hours_per_sprint, and velocity_history."
      }
    };
  }
  let pessimisticSprints;
  let optimisticSprints;
  let velocityCv = 0;
  if (velocityHistory.length > 1) {
    const meanV = avgVelocity;
    const variance = velocityHistory.reduce((sum, v) => sum + (v - meanV) ** 2, 0) / (velocityHistory.length - 1);
    const stdV = Math.sqrt(variance);
    velocityCv = Math.round(stdV / meanV * 100) / 100;
    pessimisticSprints = backlogPoints / Math.max(avgVelocity - stdV, 0.1);
    optimisticSprints = backlogPoints / (avgVelocity + stdV);
  } else {
    pessimisticSprints = requiredSprints * 1.5;
    optimisticSprints = requiredSprints * 0.75;
  }
  const confidence = computeSprintConfidence(velocityHistory.length, velocityCv);
  return {
    ok: true,
    data: {
      backlogPoints,
      averageVelocity: Math.round(avgVelocity * 10) / 10,
      requiredSprints: Math.round(requiredSprints * 10) / 10,
      optimisticSprints: Math.round(optimisticSprints * 10) / 10,
      pessimisticSprints: Math.round(pessimisticSprints * 10) / 10,
      hoursPerPoint: Math.round(conversionFactor * 100) / 100,
      totalHours: Math.round(totalHours * 10) / 10,
      completionDays: Math.round(requiredSprints * sprintLengthDays),
      sprintLengthDays,
      confidence,
      velocityCv,
      estimatedTokenCost: Math.round(totalHours * 5e4 * 100) / 100
    }
  };
}
function cocomoEstimate(params) {
  const { kloc, reasoningComplexity, contextCompleteness, transformationImpact, iterativeCycles, humanOversight } = params;
  if (kloc <= 0) {
    return {
      ok: false,
      error: {
        isError: true,
        message: "KLOC must be positive.",
        retryHint: "Provide a positive value for kloc (thousands of lines of code)."
      }
    };
  }
  if (kloc > 1e9) {
    return {
      ok: false,
      error: {
        isError: true,
        message: `KLOC value ${kloc} is too large \u2014 computation would overflow.`,
        retryHint: "Provide a kloc value under 1,000,000,000."
      }
    };
  }
  const A = 2.94;
  const B = 1.1;
  const emProduct = reasoningComplexity * contextCompleteness * transformationImpact * iterativeCycles * humanOversight;
  const personMonthsNominal = A * Math.pow(kloc, B) * emProduct;
  const llmOverhead = 1 + (iterativeCycles - 1) * 0.15;
  const aiSpeedupDivisor = Math.max(3, 12 / llmOverhead);
  const personMonthsLlmAdjusted = personMonthsNominal / aiSpeedupDivisor;
  if (!Number.isFinite(personMonthsNominal) || !Number.isFinite(personMonthsLlmAdjusted)) {
    return { ok: false, error: { isError: true, message: "COCOMO computation produced invalid result.", retryHint: "Ensure kloc and all rating multipliers are finite positive numbers." } };
  }
  const aiSpeedup = Math.round(personMonthsNominal / personMonthsLlmAdjusted * 10) / 10;
  const speedupCategory = aiSpeedup < 5 ? "moderate" : aiSpeedup < 10 ? "significant" : "extreme";
  return {
    ok: true,
    data: {
      kloc,
      personMonthsNominal: Math.round(personMonthsNominal * 10) / 10,
      personMonthsLlmAdjusted: Math.round(personMonthsLlmAdjusted * 10) / 10,
      effortMultipliers: {
        reasoning_complexity: reasoningComplexity,
        context_completeness: contextCompleteness,
        transformation_impact: transformationImpact,
        iterative_cycles: iterativeCycles,
        human_oversight: humanOversight,
        product: Math.round(emProduct * 1e3) / 1e3
      },
      assumptions: [
        "Based on COCOMO II Post-Architecture model (A=2.94, B=1.10).",
        "LLM productivity factor derived from empirical agent benchmarks.",
        "Cost drivers scaled for LLM-assisted workflows.",
        "Adjust for your team's actual velocity."
      ],
      aiSpeedup,
      speedupCategory
    }
  };
}
function criticalPath(tasks) {
  if (tasks.length === 0) {
    return {
      ok: false,
      error: {
        isError: true,
        message: "Task list must not be empty.",
        retryHint: "Provide at least one task for critical path analysis."
      }
    };
  }
  const taskMap = /* @__PURE__ */ new Map();
  for (const t of tasks) {
    if (taskMap.has(t.name)) {
      return {
        ok: false,
        error: {
          isError: true,
          message: `Duplicate task name: "${t.name}".`,
          retryHint: "Each task must have a unique name."
        }
      };
    }
    if (!(t.duration > 0) || !Number.isFinite(t.duration)) {
      return {
        ok: false,
        error: {
          isError: true,
          message: `Task "${t.name}" has invalid duration: ${t.duration}.`,
          retryHint: "Each task must have a positive, finite duration."
        }
      };
    }
    taskMap.set(t.name, t);
  }
  for (const t of tasks) {
    if (t.predecessors.includes(t.name)) {
      return {
        ok: false,
        error: {
          isError: true,
          message: `Task "${t.name}" references itself as a predecessor.`,
          retryHint: "Remove self-references from predecessor lists."
        }
      };
    }
    for (const p of t.predecessors) {
      if (!taskMap.has(p)) {
        return {
          ok: false,
          error: {
            isError: true,
            message: `Unknown predecessor "${p}" in task "${t.name}".`,
            retryHint: "Ensure all predecessor names match task names exactly."
          }
        };
      }
    }
  }
  const sorted = topologicalSort(tasks);
  if (sorted.length !== tasks.length) {
    return {
      ok: false,
      error: {
        isError: true,
        message: "Circular dependency detected in task graph.",
        retryHint: "Remove cycles from task predecessor chains."
      }
    };
  }
  const es = /* @__PURE__ */ new Map();
  const ef = /* @__PURE__ */ new Map();
  for (const name of sorted) {
    const task = taskMap.get(name);
    if (!task) continue;
    let mergeBias = 1;
    if (task.predecessors.length > 2) {
      mergeBias = 1 + 0.05 * (task.predecessors.length - 2);
    }
    const adjustedDuration = task.duration * mergeBias;
    const earliestStart = task.predecessors.length === 0 ? 0 : Math.max(...task.predecessors.map((p) => ef.get(p) ?? 0));
    es.set(name, earliestStart);
    ef.set(name, earliestStart + adjustedDuration);
  }
  const totalDuration = Math.max(...[...ef.values()]);
  const ls = /* @__PURE__ */ new Map();
  const lf = /* @__PURE__ */ new Map();
  for (let i = sorted.length - 1; i >= 0; i--) {
    const name = sorted[i];
    if (!name) continue;
    const task = taskMap.get(name);
    if (!task) continue;
    const mergeBias = task.predecessors.length > 2 ? 1 + 0.05 * (task.predecessors.length - 2) : 1;
    const adjustedDuration = task.duration * mergeBias;
    const successors = tasks.filter((t) => t.predecessors.includes(name));
    const latestFinish = successors.length === 0 ? totalDuration : Math.min(...successors.map((s) => ls.get(s.name) ?? 0));
    lf.set(name, latestFinish);
    ls.set(name, latestFinish - adjustedDuration);
  }
  const slackPerTask = {};
  const criticalPath2 = [];
  let totalMergeBias = 0;
  for (const name of sorted) {
    const task = taskMap.get(name);
    if (!task) continue;
    const slack = Math.round(((ls.get(name) ?? 0) - (es.get(name) ?? 0)) * 100) / 100;
    slackPerTask[name] = slack;
    if (slack <= 0.01) {
      criticalPath2.push(name);
    }
    if (task.predecessors.length > 2) {
      totalMergeBias += 0.05 * (task.predecessors.length - 2);
    }
  }
  return {
    ok: true,
    data: {
      critical_path: criticalPath2,
      slack_per_task: slackPerTask,
      total_duration: Math.round(totalDuration * 100) / 100,
      merge_bias_adjustment: Math.round(totalMergeBias * 100) / 100,
      estimatedHours: Math.round(totalDuration * 8 * 100) / 100,
      estimatedTokenCost: Math.round(totalDuration * 8 * 5e4 * 100) / 100
    }
  };
}
function topologicalSort(tasks) {
  const inDegree = /* @__PURE__ */ new Map();
  const adj = /* @__PURE__ */ new Map();
  for (const t of tasks) {
    inDegree.set(t.name, t.predecessors.length);
    adj.set(t.name, []);
  }
  for (const t of tasks) {
    for (const p of t.predecessors) {
      const list = adj.get(p);
      if (list) list.push(t.name);
    }
  }
  const queue = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }
  const result = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    result.push(current);
    for (const next of adj.get(current) ?? []) {
      const prev = inDegree.get(next);
      if (prev === void 0) continue;
      const newDeg = prev - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }
  return result;
}
function percentileIndex(length, percentile) {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, Math.ceil(percentile * length) - 1));
}
function monteCarloSim(tasks, iterations, seed, targetHours) {
  if (tasks.length === 0) {
    return {
      p10: "0",
      p50: "0",
      p80: "0",
      p95: "0",
      estimatedHours: 0,
      estimatedCost: 0,
      converged: false,
      criticalPathProbability: null,
      riskEvents: [{ description: "Task list must not be empty.", probability: 1, impactDays: 0 }],
      humanReadable: "Error: Provide at least one task for Monte Carlo simulation."
    };
  }
  if (iterations <= 0) {
    return {
      p10: "0",
      p50: "0",
      p80: "0",
      p95: "0",
      estimatedHours: 0,
      estimatedCost: 0,
      converged: false,
      criticalPathProbability: null,
      riskEvents: [{ description: "Iterations must be >= 1.", probability: 1, impactDays: 0 }],
      humanReadable: "Error: Iterations must be a positive number."
    };
  }
  if (targetHours !== void 0 && !(Number.isFinite(targetHours) && targetHours > 0)) {
    return {
      p10: "0",
      p50: "0",
      p80: "0",
      p95: "0",
      estimatedHours: 0,
      estimatedCost: 0,
      converged: false,
      criticalPathProbability: null,
      riskEvents: [{
        description: `target_hours (${String(targetHours)}) must be a positive, finite number of hours (task durations are in 8-hour days).`,
        probability: 1,
        impactDays: 0
      }],
      humanReadable: "Error: target_hours must be a positive number of hours."
    };
  }
  for (const task of tasks) {
    if (!(task.optimistic <= task.mostLikely && task.mostLikely <= task.pessimistic)) {
      return {
        p10: "0",
        p50: "0",
        p80: "0",
        p95: "0",
        estimatedHours: 0,
        estimatedCost: 0,
        converged: false,
        criticalPathProbability: null,
        riskEvents: [{
          description: `Invalid estimates for task "${task.name}": optimistic (${task.optimistic}) must be <= mostLikely (${task.mostLikely}) <= pessimistic (${task.pessimistic}).`,
          probability: 1,
          impactDays: 0
        }],
        humanReadable: `Error: Task "${task.name}" has invalid PERT estimates.`
      };
    }
  }
  const rng = seededRandom(seed ?? 42);
  const durations = [];
  const taskOverruns = /* @__PURE__ */ new Map();
  const quarterRuns = [];
  const threeQuarterRuns = [];
  const checkpoint1 = Math.floor(iterations * 0.25);
  const checkpoint2 = Math.floor(iterations * 0.75);
  for (let i = 0; i < iterations; i++) {
    let total = 0;
    for (const task of tasks) {
      const sampled = triangularSample(task.optimistic, task.mostLikely, task.pessimistic, rng);
      total += sampled;
      const expected = (task.optimistic + 4 * task.mostLikely + task.pessimistic) / 6;
      const overrunThreshold = expected * 1.5;
      if (sampled > overrunThreshold) {
        const entry = taskOverruns.get(task.name) ?? { count: 0, excessSum: 0 };
        entry.count++;
        entry.excessSum += sampled - overrunThreshold;
        taskOverruns.set(task.name, entry);
      }
    }
    durations.push(total);
    if (i === checkpoint1) quarterRuns.push(...durations);
    if (i === checkpoint2) threeQuarterRuns.push(...durations);
  }
  durations.sort((a, b) => a - b);
  const p = (percentile) => {
    const idx = percentileIndex(durations.length, percentile);
    return durations[idx] ?? 0;
  };
  const riskEvents = [...taskOverruns.entries()].sort((a, b) => b[1].excessSum - a[1].excessSum).slice(0, 5).map(([task, { count, excessSum }]) => ({
    description: `Task "${task}" exceeded 1.5x PERT expected in ${Math.round(count / iterations * 100)}% of simulations`,
    probability: Math.round(count / iterations * 100) / 100,
    impactDays: Math.round(excessSum / iterations * 100) / 100
  }));
  const p50Val = p(0.5);
  let criticalPathProbability = null;
  if (targetHours !== void 0) {
    const targetDays = targetHours / 8;
    const metCount = durations.filter((d) => d <= targetDays).length;
    criticalPathProbability = Math.round(metCount / iterations * 100) / 100;
  }
  quarterRuns.sort((a, b) => a - b);
  threeQuarterRuns.sort((a, b) => a - b);
  const earlyP50 = quarterRuns.length > 0 ? quarterRuns[percentileIndex(quarterRuns.length, 0.5)] ?? 0 : p50Val;
  const lateP50 = threeQuarterRuns.length > 0 ? threeQuarterRuns[percentileIndex(threeQuarterRuns.length, 0.5)] ?? 0 : p50Val;
  const converged = p50Val > 0 ? Math.abs(earlyP50 - lateP50) / p50Val < 0.1 : true;
  const probabilityLine = targetHours !== void 0 && criticalPathProbability !== null ? ` Probability of completing within ${targetHours} hours (criticalPathProbability): ${Math.round(criticalPathProbability * 100)}%.` : "";
  return {
    p10: String(Math.round(p(0.1) * 100) / 100),
    p50: String(Math.round(p50Val * 100) / 100),
    p80: String(Math.round(p(0.8) * 100) / 100),
    p95: String(Math.round(p(0.95) * 100) / 100),
    estimatedHours: Math.round(p50Val * 8 * 100) / 100,
    estimatedCost: Math.round(p50Val * 8 * 5e4 * 100) / 100,
    criticalPathProbability,
    ...targetHours !== void 0 && { targetHours },
    converged,
    riskEvents,
    humanReadable: `Monte Carlo simulation (${iterations} iterations): Optimistic (p10): ${String(Math.round(p(0.1) * 100) / 100)} days. Median (p50): ${String(Math.round(p50Val * 100) / 100)} days. Conservative (p95): ${String(Math.round(p(0.95) * 100) / 100)} days.${probabilityLine}`
  };
}
function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = s * 16807 % 2147483647;
    return (s - 1) / 2147483646;
  };
}
function computeSprintConfidence(sprintCount, cv) {
  if (sprintCount <= 2) return "low";
  if (sprintCount <= 5) return cv < 0.3 ? "medium" : "low";
  return cv < 0.3 ? "high" : cv < 0.5 ? "medium" : "low";
}
function computePertRiskLevel(optimistic, mostLikely, pessimistic) {
  const spread = (pessimistic - optimistic) / mostLikely;
  if (spread < 1) return "low";
  if (spread < 2) return "medium";
  return "high";
}
function triangularSample(min, mode, max, rng) {
  if (max === min) return min;
  const u = rng();
  const fc = (mode - min) / (max - min);
  if (u < fc) {
    return min + Math.sqrt(u * (max - min) * (mode - min));
  }
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

// src/lib/telemetry.ts
var DEFAULT_DATA_DIR = join(homedir(), ".epoch");
var TELEMETRY_FILE = "telemetry.jsonl";
var FLUSH_INTERVAL_MS = 1e4;
var FLUSH_BUFFER_SIZE = 50;
var MODEL_STATS_CACHE_TTL_MS = 6e4;
function dataDir() {
  return process.env["EPOCH_DATA_DIR"] ?? DEFAULT_DATA_DIR;
}
function hashInput(input) {
  try {
    const str = JSON.stringify(input, Object.keys(input).sort());
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h = (h << 5) - h + c | 0;
    }
    return Math.abs(h).toString(36);
  } catch {
    return "unknown";
  }
}
var TelemetryStore = class {
  buffer = [];
  flushTimer = null;
  filePath;
  enabled;
  /** TTL cache for getModelStats() — key `${model}\u0000${windowDays ?? "all"}`. */
  modelStatsCache = /* @__PURE__ */ new Map();
  constructor() {
    const dir = dataDir();
    this.filePath = join(dir, TELEMETRY_FILE);
    this.enabled = !!process.env["EPOCH_DATA_DIR"] || existsSync(dir);
    if (this.enabled && !existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch (err) {
        debugLog("telemetry.mkdir", err);
        this.enabled = false;
      }
    }
    if (this.enabled) {
      this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
      this.flushTimer.unref();
    }
  }
  record(tool, elapsedMs, ok, input, model, tokens) {
    if (!this.enabled) return;
    const recordedModel = model ?? (input !== void 0 && typeof input["model"] === "string" && input["model"].length > 0 ? input["model"] : void 0);
    const recordedTokens = tokens ?? (input !== void 0 && typeof input["tokens"] === "number" && Number.isFinite(input["tokens"]) ? input["tokens"] : void 0);
    this.buffer.push({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      tool,
      inputHash: input ? hashInput(input) : "none",
      outputOk: ok,
      elapsedMs: Math.round(elapsedMs * 100) / 100,
      ...recordedModel && { model: recordedModel },
      ...recordedTokens && { tokens: recordedTokens }
    });
    if (this.buffer.length >= FLUSH_BUFFER_SIZE) {
      this.flush();
    }
  }
  flush() {
    if (!this.enabled || this.buffer.length === 0) return;
    const lines = this.buffer.map((r) => JSON.stringify(r)).join("\n") + "\n";
    try {
      appendFileSync(this.filePath, lines, "utf-8");
      this.buffer = [];
    } catch (err) {
      debugLog("telemetry.flush", err);
    }
  }
  getStats(toolName, windowDays, sinceByTool) {
    this.flush();
    if (!this.enabled || !existsSync(this.filePath)) return [];
    const cutoff = windowDays ? new Date(Date.now() - windowDays * 864e5).toISOString() : "0000";
    let content;
    try {
      content = readFileSync(this.filePath, "utf-8");
    } catch (err) {
      debugLog("telemetry.read", err);
      return [];
    }
    const records = content.split("\n").filter((line) => line.trim()).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter((r) => r !== null && r.timestamp >= cutoff);
    if (sinceByTool) {
      const deltaGrouped = /* @__PURE__ */ new Map();
      for (const r of records) {
        if (toolName && r.tool !== toolName) continue;
        const since = sinceByTool[r.tool];
        if (since !== void 0 && r.timestamp <= since) continue;
        const arr = deltaGrouped.get(r.tool) ?? [];
        arr.push(r);
        deltaGrouped.set(r.tool, arr);
      }
      return [...deltaGrouped.entries()].map(([tool, recs]) => ({
        ...aggregate(recs, windowDays ?? 90),
        tool,
        newestTimestamp: recs.reduce((max, r) => r.timestamp > max ? r.timestamp : max, recs[0]?.timestamp ?? "")
      })).sort((a, b) => b.callCount - a.callCount);
    }
    if (toolName) {
      const filtered = records.filter((r) => r.tool === toolName);
      return filtered.length > 0 ? [aggregate(filtered, windowDays ?? 90)] : [];
    }
    const grouped = /* @__PURE__ */ new Map();
    for (const r of records) {
      const arr = grouped.get(r.tool) ?? [];
      arr.push(r);
      grouped.set(r.tool, arr);
    }
    return [...grouped.entries()].map(([, recs]) => aggregate(recs, windowDays ?? 90)).sort((a, b) => b.callCount - a.callCount);
  }
  getModelStats(model, windowDays, sinceTimestamp) {
    const cacheKey = `${model}\0${windowDays ?? "all"}\0${sinceTimestamp ?? ""}`;
    const cached = this.modelStatsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const value = this.computeModelStats(model, windowDays, sinceTimestamp);
    this.modelStatsCache.set(cacheKey, { value, expiresAt: Date.now() + MODEL_STATS_CACHE_TTL_MS });
    return value;
  }
  computeModelStats(model, windowDays, sinceTimestamp) {
    this.flush();
    if (!this.enabled || !existsSync(this.filePath)) return null;
    const cutoff = windowDays ? new Date(Date.now() - windowDays * 864e5).toISOString() : "0000";
    let content;
    try {
      content = readFileSync(this.filePath, "utf-8");
    } catch (err) {
      debugLog("telemetry.model-read", err);
      return null;
    }
    const records = content.split("\n").filter((line) => line.trim()).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter((r) => r !== null && r.timestamp >= cutoff && (sinceTimestamp === void 0 || r.timestamp > sinceTimestamp) && r.model === model && typeof r.tokens === "number" && r.tokens > 0 && r.elapsedMs > 0);
    if (records.length < 10) return null;
    const tpsValues = records.map((r) => (r.tokens ?? 0) / (r.elapsedMs / 1e3));
    tpsValues.sort((a, b) => a - b);
    const mid = Math.floor(tpsValues.length / 2);
    const medianTps = tpsValues.length % 2 === 0 ? ((tpsValues[mid - 1] ?? 0) + (tpsValues[mid] ?? 0)) / 2 : tpsValues[mid] ?? 0;
    const avgTps = tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length;
    return { avgTps: Math.round(avgTps * 10) / 10, medianTps: Math.round(medianTps * 10) / 10, sampleCount: records.length };
  }
  destroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
};
function aggregate(records, windowDays) {
  const elapsed = records.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const successes = records.filter((r) => r.outputOk).length;
  const n = elapsed.length;
  const percentile = (p) => {
    const idx = percentileIndex(n, p);
    return Math.round((elapsed[idx] ?? 0) * 100) / 100;
  };
  const mean = elapsed.reduce((a, b) => a + b, 0) / n;
  return {
    tool: records[0]?.tool ?? "unknown",
    callCount: n,
    successRate: Math.round(successes / n * 1e3) / 1e3,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    meanMs: Math.round(mean * 100) / 100,
    windowDays
  };
}
var _instance = null;
process.on("exit", () => {
  _instance?.flush();
});
function getTelemetry() {
  if (!_instance) {
    _instance = new TelemetryStore();
  }
  return _instance;
}
function resetTelemetry() {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}

// src/lib/feedback.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync3, appendFileSync as appendFileSync2 } from "fs";
import { join as join4 } from "path";
import { randomUUID as randomUUID2 } from "crypto";

// src/lib/supplementary-data.ts
import { existsSync as existsSync2, readdirSync, readFileSync as readFileSync2 } from "fs";
import { dirname, join as join2 } from "path";
import { homedir as homedir2 } from "os";
import { fileURLToPath } from "url";
var _supplementary = void 0;
var _cocomo = void 0;
function getDataDir() {
  return process.env.EPOCH_DATA_DIR ?? join2(homedir2(), ".epoch");
}
function loadSupplementaryData() {
  if (_supplementary !== void 0) return _supplementary;
  const paths = [
    join2(getDataDir(), "supplementary-database.json"),
    join2(import.meta.dirname, "..", "..", "data", "supplementary-database.json"),
    join2(import.meta.dirname, "..", "data", "supplementary-database.json")
  ];
  for (const p of paths) {
    if (existsSync2(p)) {
      try {
        _supplementary = JSON.parse(readFileSync2(p, "utf-8"));
        return _supplementary;
      } catch {
        _supplementary = null;
        return null;
      }
    }
  }
  _supplementary = null;
  return null;
}
function loadCocomoData() {
  if (_cocomo !== void 0) return _cocomo;
  const paths = [
    join2(getDataDir(), "cocomo-calibration-data.json"),
    join2(getDataDir(), "supplementary-database.json"),
    join2(import.meta.dirname, "..", "..", "data", "cocomo-calibration-data.json"),
    join2(import.meta.dirname, "..", "data", "cocomo-calibration-data.json")
  ];
  for (const p of paths) {
    if (existsSync2(p)) {
      try {
        const raw = JSON.parse(readFileSync2(p, "utf-8"));
        if (raw.cocomoCalibration) {
          _cocomo = raw;
          return _cocomo;
        }
      } catch {
        continue;
      }
    }
  }
  _cocomo = null;
  return null;
}
function getModelPricing(model) {
  const db = loadSupplementaryData();
  return db?.modelCalibration?.[model] ?? null;
}
function getHumanBaselines() {
  return loadSupplementaryData()?.humanDeveloperBaselines ?? null;
}
function getReferenceClassBaselines() {
  return loadSupplementaryData()?.referenceClassBaselines ?? null;
}
function getReferenceClassForCategory(category) {
  const baselines = getReferenceClassBaselines();
  return baselines?.categories?.[category] ?? null;
}
function getScopeBaseline(category) {
  return loadSupplementaryData()?.scopeBaselines?.[category] ?? null;
}
var AI_NATIVE_SCOPE_BASELINES = {
  feature: { small: 0.5, medium: 2, large: 5, xl: 12 },
  bugfix: { small: 0.1, medium: 1, large: 3, xl: 6 },
  infrastructure: { small: 0.3, medium: 1.5, large: 4, xl: 10 },
  testing: { small: 0.1, medium: 1, large: 3, xl: 8 },
  refactor: { small: 0.5, medium: 1.5, large: 4, xl: 10 },
  documentation: { small: 0.2, medium: 1, large: 3, xl: 6 },
  design: { small: 0.5, medium: 2, large: 5, xl: 12 },
  migration: { small: 0.5, medium: 2, large: 6, xl: 16 }
};
function getAiNativeScopeBaseline(category) {
  return AI_NATIVE_SCOPE_BASELINES[category] ?? null;
}
function getEstimationResearch() {
  const db = loadSupplementaryData();
  return db?.estimationAccuracyResearch ?? {
    expertEstimatesWithinPercent: 25,
    taskLevelMRE: { features: 0.63, bugfixes: 0.7, refactoring: 0.43 },
    underestimationRate: 57.5,
    averageScheduleOverrunPercent: 189
  };
}
function getCocomoDerivedFactors() {
  const data = loadCocomoData();
  return data?.cocomoCalibration?.derivedFactors ?? null;
}
var SCHEMA_MAP = {
  "estimation-record": "estimationRecords",
  "model-calibration": "modelCalibration",
  "cocomo-project": "cocomoProjects",
  "sprint-velocity": "sprintVelocity"
};
function getCommunityDir() {
  if (process.env.EPOCH_COMMUNITY_DIR) return process.env.EPOCH_COMMUNITY_DIR;
  const cwdBased = join2(process.cwd(), "data", "community");
  if (existsSync2(cwdBased)) return cwdBased;
  try {
    const pkgBased = join2(dirname(fileURLToPath(import.meta.url)), "..", "data", "community");
    if (existsSync2(pkgBased)) return pkgBased;
  } catch {
  }
  return cwdBased;
}
var _communityData = void 0;
function loadCommunityData() {
  if (_communityData !== void 0) return _communityData;
  const result = {
    estimationRecords: [],
    modelCalibration: [],
    cocomoProjects: [],
    sprintVelocity: []
  };
  const dir = getCommunityDir();
  if (!existsSync2(dir)) {
    _communityData = result;
    return result;
  }
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    _communityData = result;
    return result;
  }
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync2(join2(dir, file), "utf-8"));
      const schema = raw["_schema"];
      const key = schema ? SCHEMA_MAP[schema] : void 0;
      if (!key || !Array.isArray(raw["records"])) continue;
      const records = raw["records"];
      for (const rec of records) {
        result[key].push(rec);
      }
    } catch (err) {
      process.stderr.write(`[epoch] Warning: skipping community file ${file}: ${err}
`);
    }
  }
  _communityData = result;
  return result;
}
function getAllModelPricing() {
  const db = loadSupplementaryData();
  const base = db?.modelCalibration ?? {};
  const community = loadCommunityData();
  if (community.modelCalibration.length === 0) return base;
  const merged = { ...base };
  for (const cal of community.modelCalibration) {
    if (!(cal.model in merged)) {
      merged[cal.model] = {
        tokensPerSecond: cal.tokens_per_second,
        timeToFirstTokenMs: cal.time_to_first_token_ms,
        avgApiLatencyMs: cal.avg_api_latency_ms,
        costInput: cal.cost_input_per_million / 1e6,
        costOutput: cal.cost_output_per_million / 1e6
      };
    }
  }
  return merged;
}
function getCocomoProjects() {
  const data = loadCocomoData();
  const base = data?.cocomoCalibration?.datasets ?? [];
  const community = loadCommunityData();
  if (community.cocomoProjects.length === 0) return base;
  const communityDataset = {
    name: "community",
    projects: community.cocomoProjects.map((p, i) => ({
      id: 1e4 + i,
      kloc: p.kloc,
      effortPersonMonths: p.effort_person_months,
      type: p.type,
      language: p.language,
      year: p.year,
      category: p.category,
      functionPoints: p.function_points,
      durationMonths: p.duration_months
    }))
  };
  return [...base, communityDataset];
}

// src/lib/analytics.ts
var COMPLEXITY_MULTIPLIER = {
  1: 0.7,
  2: 0.85,
  3: 1,
  4: 1.2,
  5: 1.5
};
function inferScopeFromComplexity(complexity) {
  if (complexity <= 2) return "small";
  if (complexity <= 3) return "medium";
  if (complexity <= 4) return "large";
  return "xl";
}
function getScopeGuide(taskType) {
  const sb = getScopeBaseline(taskType);
  if (!sb) return null;
  return `For ${taskType} tasks: small=~${sb.small}h, medium=~${sb.medium}h, large=~${sb.large}h, xl=~${sb.xl}h`;
}
var GENERIC_MODEL_CALIBRATION = {
  tokensPerSecond: 75,
  reasoningOverheadMs: 2500,
  toolCallLatencyMs: 500
};
var MODEL_CALIBRATIONS = {
  "claude-3.5-haiku-20241022": { tokensPerSecond: 100, reasoningOverheadMs: 145, toolCallLatencyMs: 200 },
  "claude-opus-4-20250514": { tokensPerSecond: 55, reasoningOverheadMs: 360, toolCallLatencyMs: 200 },
  "claude-sonnet-4-20250514": { tokensPerSecond: 72, reasoningOverheadMs: 205, toolCallLatencyMs: 200 },
  // Placeholder: same figures as claude-3.5-haiku-20241022 (nearest fast-tier sibling).
  "claude-haiku-4-5": { tokensPerSecond: 100, reasoningOverheadMs: 145, toolCallLatencyMs: 200 },
  // Placeholder: same figures as claude-opus-4-20250514 (nearest premium-tier sibling).
  "claude-opus-4-8": { tokensPerSecond: 55, reasoningOverheadMs: 360, toolCallLatencyMs: 200 },
  // Placeholder: same figures as claude-sonnet-4-20250514 (nearest standard-tier sibling).
  "claude-sonnet-5": { tokensPerSecond: 72, reasoningOverheadMs: 205, toolCallLatencyMs: 200 },
  // Placeholder: reuses claude-opus-4-20250514's figures — Claude Fable 5 is
  // the top-tier/most-capable model; no closer existing sibling in this table.
  "claude-fable-5": { tokensPerSecond: 55, reasoningOverheadMs: 360, toolCallLatencyMs: 200 },
  "deepseek-v3": { tokensPerSecond: 97, reasoningOverheadMs: 410, toolCallLatencyMs: 200 },
  "gemini-2.0-flash": { tokensPerSecond: 230, reasoningOverheadMs: 90, toolCallLatencyMs: 200 },
  "gemini-2.5-pro": { tokensPerSecond: 68, reasoningOverheadMs: 280, toolCallLatencyMs: 200 },
  "gpt-4-turbo": { tokensPerSecond: 27.5, reasoningOverheadMs: 1405, toolCallLatencyMs: 200 },
  "gpt-4o": { tokensPerSecond: 85, reasoningOverheadMs: 155, toolCallLatencyMs: 200 },
  "gpt-4o-mini": { tokensPerSecond: 180, reasoningOverheadMs: 130, toolCallLatencyMs: 200 },
  "llama-3.1-405b": { tokensPerSecond: 30, reasoningOverheadMs: 300, toolCallLatencyMs: 200 },
  "llama-3.1-70b": { tokensPerSecond: 100, reasoningOverheadMs: 100, toolCallLatencyMs: 200 },
  "mistral-large": { tokensPerSecond: 42.6, reasoningOverheadMs: 730, toolCallLatencyMs: 200 }
};
var REASONING_DEPTH_MULTIPLIER = {
  shallow: 1,
  moderate: 2.5,
  deep: 5
};
var INDUSTRY_CORRECTION_FACTORS = {
  feature: 1.8,
  bugfix: 1.4,
  refactor: 2,
  migration: 2.2,
  infrastructure: 1.9,
  documentation: 1.3,
  testing: 1.5,
  design: 1.7
};
function getUrgency(seconds) {
  const hours = seconds / 3600;
  if (hours < 2) return "short";
  if (hours <= 48) return "medium";
  return "long";
}
function getMedianTps(cal) {
  return cal.medianTps ?? cal.medianTokensPerSecond ?? 0;
}
function resolveModelCalibration(model) {
  const tableBase = MODEL_CALIBRATIONS[model];
  const telemetryStats = getTelemetry().getModelStats(model, 30);
  if (telemetryStats && telemetryStats.sampleCount >= 10) {
    const base = tableBase ?? GENERIC_MODEL_CALIBRATION;
    return { calibration: { ...base, tokensPerSecond: telemetryStats.medianTps }, provenance: "telemetry" };
  }
  const db = loadReferenceDb();
  const dbCal = db?.tokenTimeCalibration?.[model];
  if (dbCal) {
    const dbTps = getMedianTps(dbCal);
    if (dbTps > 0) {
      const base = tableBase ?? GENERIC_MODEL_CALIBRATION;
      return { calibration: { ...base, tokensPerSecond: dbTps }, provenance: "reference_db" };
    }
  }
  if (tableBase) {
    return { calibration: tableBase, provenance: "calibrated_table" };
  }
  return { calibration: GENERIC_MODEL_CALIBRATION, provenance: "generic_fallback" };
}
function getModelCalibration(model) {
  return resolveModelCalibration(model).calibration;
}
function getPromptRatio(model) {
  const db = loadReferenceDb();
  const profile = db?.modelLatencyProfiles?.[model];
  if (profile?.tokensPerRound && typeof profile.tokensPerRound === "object") {
    const total = profile.tokensPerRound.mean;
    const prompt = profile.tokensPerRound.meanPrompt;
    if (total > 0) return prompt / total;
  }
  return 0.3;
}
function getConfidence(model) {
  switch (resolveModelCalibration(model).provenance) {
    case "telemetry":
      return "likely";
    case "reference_db":
    case "calibrated_table":
      return "optimistic";
    case "generic_fallback":
      return "pessimistic";
  }
}
function tokenTimeBridge(params) {
  const cal = getModelCalibration(params.model);
  const promptRatio = getPromptRatio(params.model);
  const generationTimeSeconds = params.tokens / cal.tokensPerSecond;
  const toolOverheadSeconds = params.toolCalls * cal.toolCallLatencyMs / 1e3;
  const reasoningSeconds = cal.reasoningOverheadMs / 1e3 * REASONING_DEPTH_MULTIPLIER[params.reasoningDepth];
  const totalSeconds = generationTimeSeconds + toolOverheadSeconds + reasoningSeconds;
  const estMin = Math.round(totalSeconds / 60 * 10) / 10;
  const timeStr = estMin >= 60 ? `${Math.round(estMin / 60 * 10) / 10} hours` : `${estMin} minutes`;
  const confidence = getConfidence(params.model);
  return {
    tokens: params.tokens,
    model: params.model,
    estimatedSeconds: Math.round(totalSeconds),
    estimatedMinutes: estMin,
    confidence,
    urgency: getUrgency(totalSeconds),
    breakdown: {
      promptTokens: Math.round(params.tokens * promptRatio),
      completionTokens: Math.round(params.tokens * (1 - promptRatio)),
      toolOverheadSeconds: Math.round(toolOverheadSeconds * 100) / 100
    },
    humanReadable: `Approximately ${timeStr} for ${params.tokens.toLocaleString()} tokens with ${params.model} (${params.reasoningDepth} reasoning, ${params.toolCalls} tool calls). Confidence: ${confidence}.`,
    estimatedTokenCost: Math.round(totalSeconds / 3600 * 5e4 * 100) / 100
  };
}
function getCorrectionFactorForTaskType(taskType, tool, complexity) {
  if (complexity !== void 0) {
    const ccf = getComplexityCorrectionFactor(taskType, complexity);
    if (ccf !== null) return ccf;
  }
  const db = loadReferenceDb();
  if (tool) {
    const toolFactor = db?.toolTaskCorrectionFactors?.[tool]?.[taskType];
    if (typeof toolFactor === "number" && Number.isFinite(toolFactor)) return toolFactor;
  }
  const taskFactor = db?.taskTypeCorrectionFactors?.[taskType];
  if (typeof taskFactor === "number" && Number.isFinite(taskFactor)) return taskFactor;
  const canaryKey = mapToCanaryKey(taskType);
  const canaryFactor = db?.estimationAccuracy?.correctionFactors?.byTaskType?.[canaryKey] ?? db?.estimationAccuracy?.taskTypes?.[canaryKey]?.correctionFactor;
  if (typeof canaryFactor === "number" && Number.isFinite(canaryFactor)) return canaryFactor;
  return INDUSTRY_CORRECTION_FACTORS[taskType] ?? 1.8;
}
function mapToCanaryKey(taskType) {
  const mapping = {
    feature: "pert_estimation",
    bugfix: "calendar_calculation",
    refactor: "cocomo_estimation",
    migration: "cocomo_estimation",
    infrastructure: "token_time_bridge",
    documentation: "other",
    testing: "calibration",
    design: "reference_class"
  };
  return mapping[taskType] ?? taskType;
}
function referenceClassEstimate(records, taskType, complexity, scope, aiNative) {
  const filtered = records.filter((r) => r.taskType === taskType && r.estimatedHours > 0);
  let correctionFactor;
  let sampleSize;
  const scopeInferred = scope === void 0;
  const effectiveScope = scope ?? inferScopeFromComplexity(complexity);
  let rawEstimate;
  let baselineSource;
  const usingAiBaselines = aiNative && getAiNativeScopeBaseline(taskType) !== null;
  const scopeBaseline = aiNative ? getAiNativeScopeBaseline(taskType) ?? getScopeBaseline(taskType) : getScopeBaseline(taskType);
  if (filtered.length >= 5) {
    const ratios = filtered.map((r) => r.actualHours / r.estimatedHours);
    ratios.sort((a, b) => a - b);
    const mid = Math.floor(ratios.length / 2);
    const rawMedian = ratios.length % 2 === 0 ? ((ratios[mid - 1] ?? 0) + (ratios[mid] ?? 0)) / 2 : ratios[mid] ?? 1.8;
    correctionFactor = Math.min(3, Math.max(0.1, rawMedian));
    sampleSize = filtered.length;
  } else {
    correctionFactor = usingAiBaselines ? 1 : getCorrectionFactorForTaskType(taskType, "reference_class_estimate", complexity);
    sampleSize = filtered.length;
  }
  const cMul = COMPLEXITY_MULTIPLIER[Math.max(1, Math.min(5, complexity))] ?? 1;
  if (scopeBaseline) {
    rawEstimate = scopeBaseline[effectiveScope] * cMul;
    baselineSource = scopeInferred ? `inferred_scope_${effectiveScope}_real_tasks` : `scope_${effectiveScope}_real_tasks`;
  } else {
    const realBaseline = getReferenceClassForCategory(taskType);
    if (realBaseline && realBaseline.total_samples >= 5) {
      const clampedComplexity = Math.max(1, Math.min(5, complexity));
      const complexityNorm = (clampedComplexity - 1) / 4;
      rawEstimate = realBaseline.p25_hours + (realBaseline.p75_hours - realBaseline.p25_hours) * complexityNorm;
      baselineSource = `real_tasks_${realBaseline.total_samples}`;
    } else {
      const complexityMultiplier = 0.5 + (complexity - 1) * 0.375;
      rawEstimate = 8 * complexityMultiplier;
      baselineSource = "industry_8h";
    }
  }
  const correctedEstimate = Math.round(rawEstimate * correctionFactor * 10) / 10;
  return {
    rawEstimate: Math.round(rawEstimate * 10) / 10,
    correctedEstimate,
    correctionFactor: Math.round(correctionFactor * 100) / 100,
    sampleSize,
    baselineSource,
    scopeUsed: effectiveScope,
    scopeInferred,
    confidence: sampleSize >= 10 ? "likely" : sampleSize >= 5 ? "optimistic" : "pessimistic",
    estimatedTokenCost: Math.round(correctedEstimate * 5e4 * 100) / 100,
    basisNote: `correctedEstimate (${correctedEstimate} hours) is the ledger-recorded and displayed basis (rawEstimate x correctionFactor from historical actual/estimated ratios); it is the value feedback.ts's extractEstimatedHours records for reference-class tools and the value empirical ratio quantiles are calibrated against.`
  };
}
function computeAccuracyMetrics(records) {
  if (records.length === 0) {
    return { mape: 0, mdape: 0, cappedMdape: 0, bias: 0, variance: 0, sample_size: 0, trend: "stable" };
  }
  const validRecords = records.filter((r) => r.actualHours > 0);
  if (validRecords.length === 0) {
    return { mape: 0, mdape: 0, cappedMdape: 0, bias: 0, variance: 0, sample_size: 0, trend: "stable" };
  }
  const errors = validRecords.map((r) => Math.abs(r.actualHours - r.estimatedHours) / r.actualHours);
  const mape = errors.reduce((a, b) => a + b, 0) / errors.length * 100;
  const sorted = [...errors].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const mdape = sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 * 100 : (sorted[mid] ?? 0) * 100;
  const CAP = 5;
  const capped = errors.map((e) => Math.min(e, CAP)).sort((a, b) => a - b);
  const cappedMdape = capped.length % 2 === 0 ? ((capped[mid - 1] ?? 0) + (capped[mid] ?? 0)) / 2 * 100 : (capped[mid] ?? 0) * 100;
  const biases = validRecords.map((r) => r.actualHours - r.estimatedHours);
  const bias = biases.reduce((a, b) => a + b, 0) / biases.length;
  const meanBias = bias;
  const variance = biases.reduce((sum, b) => sum + (b - meanBias) ** 2, 0) / biases.length;
  let trend = "stable";
  if (validRecords.length >= 6) {
    const half = Math.floor(validRecords.length / 2);
    const firstHalf = validRecords.slice(0, half);
    const secondHalf = validRecords.slice(half);
    const mapeFirst = avgPercentageError(firstHalf);
    const mapeSecond = avgPercentageError(secondHalf);
    if (mapeSecond < mapeFirst * 0.85) trend = "improving";
    else if (mapeSecond > mapeFirst * 1.15) trend = "degrading";
  }
  return {
    mape: Math.round(mape * 10) / 10,
    mdape: Math.round(mdape * 10) / 10,
    cappedMdape: Math.round(cappedMdape * 10) / 10,
    bias: Math.round(bias * 10) / 10,
    variance: Math.round(variance * 10) / 10,
    sample_size: validRecords.length,
    trend
  };
}
function avgPercentageError(records) {
  const valid = records.filter((r) => r.actualHours > 0);
  if (valid.length === 0) return 0;
  return valid.reduce((sum, r) => sum + Math.abs(r.actualHours - r.estimatedHours) / r.actualHours, 0) / valid.length * 100;
}
function calibrateEstimates(teamId, periodDays, minimumSamples, records) {
  const data = records ?? [];
  if (data.length >= minimumSamples) {
    const metrics = computeAccuracyMetrics(data);
    const ratios = data.filter((r) => r.estimatedHours > 0).map((r) => r.actualHours / r.estimatedHours);
    ratios.sort((a, b) => a - b);
    const mid = Math.floor(ratios.length / 2);
    const medianRatio = ratios.length > 0 ? ratios.length % 2 === 0 ? ((ratios[mid - 1] ?? 0) + (ratios[mid] ?? 0)) / 2 : ratios[mid] ?? 1 : 1;
    const correctionFactor = Math.round(Math.min(3, Math.max(0.1, medianRatio)) * 100) / 100;
    const recs = [
      `Computed from ${data.length} historical records over ${periodDays} days.`,
      `MAPE: ${metrics.mape}%, MdAPE: ${metrics.mdape}%, bias: ${metrics.bias > 0 ? "underestimation" : "overestimation"} (${metrics.bias}).`,
      `Accuracy trend: ${metrics.trend}.`
    ];
    if (metrics.trend === "degrading") {
      recs.push("Accuracy is degrading \u2014 review recent estimates for systematic bias.");
    }
    if (metrics.sample_size < 20) {
      recs.push("More data points (20+) will improve calibration reliability.");
    }
    return {
      correctionFactor,
      accuracyTrend: metrics.trend,
      velocityTrend: metrics.trend === "improving" ? "accelerating" : metrics.trend === "degrading" ? "slowing" : "stable",
      recommendations: recs
    };
  }
  const dbFactor = getGlobalCorrectionFactor();
  return {
    correctionFactor: dbFactor,
    accuracyTrend: "stable",
    velocityTrend: "stable",
    recommendations: [
      `Using reference database correction factor (${dbFactor}x) \u2014 ${data.length} samples, need ${minimumSamples}.`,
      "Submit actuals via POST /v1/feedback/record-actual to enable data-driven calibration.",
      "Accuracy improves significantly with 10+ historical data points per task type."
    ]
  };
}

// src/lib/ledger.ts
import { existsSync as existsSync3, readFileSync as readFileSync3, statSync, writeFileSync, unlinkSync, mkdirSync as mkdirSync2 } from "fs";
import { join as join3, dirname as dirname2 } from "path";
import { homedir as homedir3 } from "os";
import { randomUUID } from "crypto";
var DEFAULT_DATA_DIR2 = join3(homedir3(), ".epoch");
var ESTIMATES_FILE = "estimates.jsonl";
var ACTUALS_FILE = "feedback.jsonl";
var FLAGS_FILE = "estimates.flags.jsonl";
var LABELS_FILE = "estimates.labels.jsonl";
var QUARANTINE_ARCHIVE_FILE = "estimates.quarantine.jsonl";
function dataDir2() {
  return process.env["EPOCH_DATA_DIR"] ?? DEFAULT_DATA_DIR2;
}
var ledgerCache = /* @__PURE__ */ new Map();
var ledgerParseCounts = /* @__PURE__ */ new Map();
var ledgerCorruptLines = /* @__PURE__ */ new Map();
function ledgerCacheEnabled() {
  const raw = process.env["EPOCH_LEDGER_CACHE"];
  return !(raw === "0" || raw === "false");
}
function deepFreeze(value) {
  if (value !== null && (typeof value === "object" || typeof value === "function")) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}
function statKey(path) {
  try {
    const s = statSync(path);
    return { size: s.size, mtimeMs: s.mtimeMs, ino: String(s.ino) };
  } catch {
    return null;
  }
}
function readLines(filename) {
  const path = join3(dataDir2(), filename);
  if (!existsSync3(path)) return [];
  const stat = ledgerCacheEnabled() ? statKey(path) : null;
  const cached = stat !== null ? ledgerCache.get(path) : void 0;
  if (cached && stat && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs && cached.ino === stat.ino) {
    cached.lastReadAt = Date.now();
    return cached.rows.slice();
  }
  let rows;
  let corruptLines = 0;
  try {
    const content = readFileSync3(path, "utf-8");
    rows = content.split("\n").filter((line) => line.trim()).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        corruptLines++;
        return null;
      }
    }).filter((r) => r !== null);
  } catch {
    return [];
  }
  ledgerParseCounts.set(path, (ledgerParseCounts.get(path) ?? 0) + 1);
  ledgerCorruptLines.set(path, corruptLines);
  if (stat !== null) {
    ledgerCache.set(path, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ino: stat.ino,
      rows: rows.map(deepFreeze),
      corruptLines,
      parsedAt: Date.now(),
      lastReadAt: Date.now()
    });
  }
  return rows;
}
function getLedgerCorruptLines() {
  return new Map(ledgerCorruptLines);
}
function getLedgerCacheStatus() {
  const out = /* @__PURE__ */ new Map();
  for (const [path, count] of ledgerParseCounts) {
    const entry = ledgerCache.get(path);
    out.set(path, {
      parses: count,
      parsedAt: entry?.parsedAt ?? null,
      lastReadAt: entry?.lastReadAt ?? null
    });
  }
  return out;
}
var CURRENT_BASIS_VERSION = 2;
var LEGACY_BASIS_VERSION = 1;
function reportedAtMs(a) {
  const t = Date.parse(a.reportedAt ?? "");
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}
function joinActualsEarliestReported(actuals) {
  const byId = /* @__PURE__ */ new Map();
  for (const a of actuals) {
    const current = byId.get(a.estimateId);
    if (current === void 0 || reportedAtMs(a) < reportedAtMs(current)) {
      byId.set(a.estimateId, a);
    }
  }
  return byId;
}
function countDuplicateActuals(actuals) {
  const counts = /* @__PURE__ */ new Map();
  for (const a of actuals) counts.set(a.estimateId, (counts.get(a.estimateId) ?? 0) + 1);
  let duplicated = 0;
  for (const n of counts.values()) if (n > 1) duplicated++;
  return duplicated;
}
function resolveOverlayConflicts(records) {
  const byId = /* @__PURE__ */ new Map();
  for (const r of records) {
    const arr = byId.get(r.id) ?? [];
    arr.push(r);
    byId.set(r.id, arr);
  }
  for (const arr of byId.values()) {
    arr.sort((a, b) => {
      const t = Date.parse(a.recordedAt) - Date.parse(b.recordedAt);
      if (t !== 0) return t;
      return (a.seq ?? 0) - (b.seq ?? 0);
    });
  }
  return byId;
}
function mergeFlagsForId(records) {
  const merged = { quarantined: false, orphan: false };
  if (!records) return merged;
  for (const r of records) {
    if (r.quarantined !== void 0) merged.quarantined = r.quarantined;
    if (r.reason !== void 0) merged.quarantineReason = r.reason;
    if (r.orphan !== void 0) merged.orphan = r.orphan;
    if (r.taskLabel !== void 0) merged.taskLabel = r.taskLabel;
  }
  return merged;
}
function loadLedgerWithOverlays(_options = {}) {
  const liveEstimates = readLines(ESTIMATES_FILE);
  const archivedEstimates = readLines(QUARANTINE_ARCHIVE_FILE);
  const actuals = readLines(ACTUALS_FILE);
  const flagRecords = readLines(FLAGS_FILE);
  const labelRecords = readLines(LABELS_FILE);
  const actualsMap = joinActualsEarliestReported(actuals);
  const flagsById = resolveOverlayConflicts(flagRecords);
  const labelsById = resolveOverlayConflicts(labelRecords);
  const buildRecord = (est, archived) => {
    const flags = mergeFlagsForId(flagsById.get(est.id));
    const labels = mergeFlagsForId(labelsById.get(est.id));
    return {
      id: est.id,
      tool: est.tool,
      inputs: est.inputs,
      outputs: est.outputs,
      estimatedAt: est.estimatedAt,
      ...est.source && { source: est.source },
      ...est.expiresAt && { expiresAt: est.expiresAt },
      ...est.basisVersion !== void 0 && { basisVersion: est.basisVersion },
      ...actualsMap.has(est.id) && { actual: actualsMap.get(est.id) },
      flags: { ...flags, taskLabel: labels.taskLabel ?? flags.taskLabel },
      archived
    };
  };
  return [
    ...liveEstimates.map((e) => buildRecord(e, false)),
    ...archivedEstimates.map((e) => buildRecord(e, true))
  ];
}
var LEDGER_WRITE_LOCK_STALE_MS = 3e4;
var LEDGER_WRITE_LOCK_TIMEOUT_MS = 2e3;
function lockEnvInt(name) {
  const raw = process.env[name];
  if (raw === void 0) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}
function readLockFile(lockPath) {
  let raw;
  try {
    raw = readFileSync3(lockPath, "utf-8");
  } catch {
    return { parsed: null, ageMs: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  let ageMs = null;
  try {
    ageMs = Date.now() - statSync(lockPath).mtimeMs;
  } catch {
  }
  return { parsed, ageMs };
}
function isStaleLock(parsed, ageMs, staleMs) {
  if (parsed && typeof parsed.pid === "number" && !pidAlive(parsed.pid)) return true;
  if (parsed && typeof parsed.pid === "number") return false;
  return ageMs !== null && ageMs > staleMs;
}
function ledgerWriteLockPath(filename) {
  return join3(dataDir2(), `${filename}.lock`);
}
function acquireExclusiveFileLock(lockPath, owner, options = {}) {
  const staleMs = options.staleMs ?? lockEnvInt("EPOCH_LOCK_STALE_MS") ?? LEDGER_WRITE_LOCK_STALE_MS;
  const timeoutMs = options.timeoutMs ?? lockEnvInt("EPOCH_LOCK_TIMEOUT_MS") ?? LEDGER_WRITE_LOCK_TIMEOUT_MS;
  const retryMs = options.retryMs ?? 25;
  try {
    const dir = dirname2(lockPath);
    if (!existsSync3(dir)) mkdirSync2(dir, { recursive: true });
  } catch {
  }
  const token = randomUUID();
  const payload = JSON.stringify({ owner, pid: process.pid, acquiredAt: (/* @__PURE__ */ new Date()).toISOString(), token }, null, 2) + "\n";
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let recoveredStale = false;
  let steals = 0;
  for (; ; ) {
    try {
      writeFileSync(lockPath, payload, { flag: "wx" });
      ledgerLockAcquisitions.set(lockPath, (ledgerLockAcquisitions.get(lockPath) ?? 0) + 1);
      return { ok: true, lockPath, token, recoveredStale };
    } catch (err) {
      const code = err?.code;
      if (code !== "EEXIST") {
        debugLog("ledger.lock-unavailable", `could not create ${lockPath}: ${code ?? String(err)}`);
        return { ok: false, lockPath, token: null, recoveredStale, reason: "unavailable" };
      }
    }
    const { parsed, ageMs } = readLockFile(lockPath);
    if (isStaleLock(parsed, ageMs, staleMs) && steals < 3) {
      try {
        unlinkSync(lockPath);
        recoveredStale = true;
        ledgerStaleRecoveries++;
        steals++;
        continue;
      } catch {
      }
    }
    if (Date.now() >= deadline) {
      return { ok: false, lockPath, token: null, recoveredStale, reason: "held" };
    }
    sleepSync(Math.max(1, Math.min(retryMs, deadline - Date.now())));
  }
}
function releaseExclusiveFileLock(lockPath, token) {
  if (!token) return;
  try {
    const raw = readFileSync3(lockPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.token === token) unlinkSync(lockPath);
  } catch {
  }
}
function withLedgerWriteLock(filename, fn, owner = "epoch") {
  const acquisition = acquireExclusiveFileLock(ledgerWriteLockPath(filename), owner);
  if (!acquisition.ok) {
    if (acquisition.reason === "unavailable") throw new LedgerLockUnavailableError(acquisition.lockPath);
    throw new LedgerLockTimeoutError(acquisition.lockPath);
  }
  try {
    return fn();
  } finally {
    releaseExclusiveFileLock(acquisition.lockPath, acquisition.token);
  }
}
var LedgerLockTimeoutError = class extends Error {
  constructor(lockPath) {
    super(`Ledger write lock still held after timeout: ${lockPath}`);
    this.lockPath = lockPath;
    this.name = "LedgerLockTimeoutError";
  }
  lockPath;
};
var LedgerLockUnavailableError = class extends Error {
  constructor(lockPath) {
    super(`Ledger write lock infrastructure unavailable: ${lockPath}`);
    this.lockPath = lockPath;
    this.name = "LedgerLockUnavailableError";
  }
  lockPath;
};
var ledgerStaleRecoveries = 0;
function getLedgerStaleRecoveryCount() {
  return ledgerStaleRecoveries;
}
var ledgerLockAcquisitions = /* @__PURE__ */ new Map();
function inspectLedgerWriteLock(filename, staleMs) {
  const lockPath = ledgerWriteLockPath(filename);
  const staleWindow = staleMs ?? lockEnvInt("EPOCH_LOCK_STALE_MS") ?? LEDGER_WRITE_LOCK_STALE_MS;
  const { parsed, ageMs } = readLockFile(lockPath);
  const present = parsed !== null;
  if (!present) {
    try {
      statSync(lockPath);
    } catch {
      return {
        path: lockPath,
        present: false,
        pid: null,
        owner: null,
        acquiredAt: null,
        ageMs: null,
        stale: false,
        recovery: `No write lock held. If a stale ${lockPath} ever blocks writes, verify the PID inside it is gone, then delete it.`
      };
    }
  }
  const pid = parsed && typeof parsed.pid === "number" ? parsed.pid : null;
  const lockOwner = parsed && typeof parsed.owner === "string" ? parsed.owner : null;
  const acquiredAt = parsed && typeof parsed.acquiredAt === "string" ? parsed.acquiredAt : null;
  const stale = isStaleLock(parsed, ageMs, staleWindow);
  const ageLabel = ageMs !== null ? `${Math.round(ageMs / 100) / 10}s` : "unknown age";
  const pidLabel = pid !== null ? `PID ${pid}` : "unknown PID";
  return {
    path: lockPath,
    present: true,
    pid,
    owner: lockOwner,
    acquiredAt,
    ageMs,
    stale,
    recovery: stale ? `Stale write lock (${pidLabel}, ${ageLabel}) \u2014 it will be removed automatically on the next locked write, or delete ${lockPath} manually after verifying the owner is gone.` : `Write lock held by ${pidLabel} (${ageLabel}). If that process is no longer running, wait for the staleness window (${Math.round(staleWindow / 1e3)}s) or delete ${lockPath} manually.`
  };
}

// src/lib/exclusion.ts
var SYNTHETIC_ID_PREFIXES = [
  "seed-",
  "test-",
  "batch-test-",
  "batch-max-",
  "batch-single-",
  "synth-",
  "demo-",
  "example-",
  "sample-",
  "fake-",
  // Verified 2026-07-10 against a read-only copy of the live ~/.epoch ledger
  // (loose-ends cleanup): old http-test-harness / feedback-batch-test runs
  // leaked exactly 472 rows under these two additional prefixes — all as
  // orphaned feedback.jsonl actuals, none as estimates.jsonl rows. See
  // src/lib/migrations/flag-test-fixture-rows.ts for the migration that
  // overlay-flags the leaked rows.
  "http-test-estimate-",
  "fb-batch-",
  "fb-max-",
  "fb-single-"
];
function isSyntheticId(id) {
  return SYNTHETIC_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}
var MIN_RATIO = 0.03;
var MAX_RATIO = 50;
var MINIMUM_CALIBRATION_ACTUAL_HOURS = 0.01;
var EXACT_MATCH_EPSILON = 5e-3;
var BACKFILL_SIGNATURE_DATE = "2026-05-05";
var AUTO_WALLCLOCK_MIN_HOURS = 0.05;
var AUTO_WALLCLOCK_MAX_HOURS = 12;
var AUTO_WALLCLOCK_RATIO_LIMIT = 10;
function isAutoWallclockSane(actualHours, estimatedHours) {
  if (actualHours < AUTO_WALLCLOCK_MIN_HOURS || actualHours > AUTO_WALLCLOCK_MAX_HOURS) return false;
  if (estimatedHours != null && estimatedHours > 0) {
    const ratio = Math.max(actualHours / estimatedHours, estimatedHours / actualHours);
    if (ratio >= AUTO_WALLCLOCK_RATIO_LIMIT) return false;
  }
  return true;
}
var VALID_PROVENANCE = /* @__PURE__ */ new Set([
  "prospective",
  "backfilled_real_session",
  "backfilled_calibration",
  "synthetic",
  "smoke",
  "unknown",
  "auto_wallclock"
]);
var VALID_USAGE = /* @__PURE__ */ new Set(["correction", "baseline", "exclude"]);
function normalizeString(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function normalizeProvenance(value) {
  const raw = normalizeString(value);
  return raw && VALID_PROVENANCE.has(raw) ? raw : void 0;
}
function normalizeUsage(value) {
  const raw = normalizeString(value);
  return raw && VALID_USAGE.has(raw) ? raw : void 0;
}
function hasSeedNotes(notes) {
  const n = (notes ?? "").toLowerCase();
  return n.includes("seed") || n.includes("synthetic") || n.includes("dogfood-seed") || n.includes("test data");
}
function hasSmokeSignature(tool, notes) {
  const n = (notes ?? "").toLowerCase();
  return tool.toLowerCase() === "receiver_smoke" || n.includes("receiver smoke") || n.includes("smoke test");
}
function hasIndustryCalibrationNote(notes) {
  return (notes ?? "").toLowerCase().includes("industry calibration");
}
function isoDate(ts) {
  if (!ts) return null;
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}
function hasBackfillDateSignature(record) {
  return isoDate(record.estimatedAt) === BACKFILL_SIGNATURE_DATE || isoDate(record.actual?.reportedAt) === BACKFILL_SIGNATURE_DATE || isoDate(record.actual?.completedAt) === BACKFILL_SIGNATURE_DATE;
}
function isExactMatch(estimatedHours, actualHours) {
  if (estimatedHours <= 0) return false;
  const ratio = actualHours / estimatedHours;
  return Math.abs(ratio - 1) <= EXACT_MATCH_EPSILON;
}
function isExcluded(record, now = /* @__PURE__ */ new Date()) {
  if (record.flags?.quarantined) return { excluded: true, reason: "quarantine_flag" };
  if (record.flags?.orphan) return { excluded: true, reason: "orphan" };
  if (isSyntheticId(record.id)) return { excluded: true, reason: "synthetic_id" };
  if (!record.actual) {
    if (record.expiresAt && Date.parse(record.expiresAt) < now.getTime()) {
      return { excluded: true, reason: "ttl_expired" };
    }
    return { excluded: false };
  }
  const { actual } = record;
  const explicitProvenance = normalizeProvenance(
    record.inputs?.["calibration_provenance"] ?? actual.calibrationProvenance ?? actual.calibration_provenance
  );
  const explicitUsage = normalizeUsage(
    record.inputs?.["calibration_usage"] ?? actual.calibrationUsage ?? actual.calibration_usage
  );
  if (explicitUsage === "exclude" || explicitProvenance === "synthetic" || explicitProvenance === "smoke") {
    return { excluded: true, reason: "explicit_exclude" };
  }
  if (actual.actualHours < MINIMUM_CALIBRATION_ACTUAL_HOURS) {
    return { excluded: true, reason: "below_calibration_threshold" };
  }
  if (explicitProvenance === "auto_wallclock" && !isAutoWallclockSane(actual.actualHours, record.estimatedHours)) {
    return { excluded: true, reason: "auto_wallclock_sanity_gate" };
  }
  const hasExplicitClassification = explicitProvenance !== void 0 || explicitUsage !== void 0;
  if (!hasExplicitClassification) {
    if (hasSeedNotes(actual.notes)) return { excluded: true, reason: "seed_notes" };
    if (hasSmokeSignature(record.tool, actual.notes)) return { excluded: true, reason: "smoke" };
    if (hasIndustryCalibrationNote(actual.notes)) return { excluded: true, reason: "industry_calibration_note" };
  }
  if (record.estimatedHours != null && record.estimatedHours > 0) {
    if (isExactMatch(record.estimatedHours, actual.actualHours) && hasBackfillDateSignature(record)) {
      return { excluded: true, reason: "backfill_signature" };
    }
    const ratio = actual.actualHours / record.estimatedHours;
    if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
      return { excluded: true, reason: "ratio_outlier" };
    }
  }
  return { excluded: false };
}

// src/lib/tool-aliases.ts
var CANONICAL_TOOL_NAMES = /* @__PURE__ */ new Set([
  "get_current_time",
  "convert_timezone",
  "parse_duration",
  "time_math",
  "add_business_days",
  "count_business_days",
  "pert_estimate",
  "cocomo_estimate",
  "sprint_forecast",
  "critical_path",
  "monte_carlo_schedule",
  "reference_class_estimate",
  "estimate_from_context",
  "calibrate_estimates",
  "token_time_bridge",
  "token_cost_estimate",
  "compare_models",
  "accuracy_trend",
  "schedule_risk",
  "cocomo_validate",
  "cocomo_ground_truth",
  "record_actual",
  "get_pending_estimates",
  "batch_record_actuals",
  "feedback_health"
]);
var ESTIMATION_TOOL_NAMES = /* @__PURE__ */ new Set([
  "pert_estimate",
  "reference_class_estimate",
  "cocomo_estimate",
  "sprint_forecast",
  "monte_carlo_schedule",
  "schedule_risk",
  "critical_path",
  "token_time_bridge",
  // estimate_from_context produces a real reference-class-delegated hour
  // estimate (correctedEstimate), so it joins the ledger and is eligible for
  // record_actual pairing, same as reference_class_estimate.
  "estimate_from_context"
]);
var NON_ESTIMATION_TOOL_NAMES = new Set(
  [...CANONICAL_TOOL_NAMES].filter((name) => !ESTIMATION_TOOL_NAMES.has(name))
);
var TOOL_COUNT = CANONICAL_TOOL_NAMES.size;
var ESTIMATION_TOOL_COUNT = ESTIMATION_TOOL_NAMES.size;
var TOOL_ALIASES = {
  manual_pert_estimate: "pert_estimate",
  manual_orchestration_pert: "pert_estimate"
};
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function camelToSnake(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase();
}
function canonicalizeToolName(name) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  if (UUID_PATTERN.test(trimmed)) return null;
  if (CANONICAL_TOOL_NAMES.has(trimmed)) return trimmed;
  const alias = TOOL_ALIASES[trimmed];
  if (alias) return alias;
  const snake = camelToSnake(trimmed);
  if (CANONICAL_TOOL_NAMES.has(snake)) return snake;
  return null;
}

// src/lib/feedback.ts
var DEFAULT_PENDING_TTL_DAYS = 30;
function pendingTtlDays() {
  const raw = process.env["EPOCH_PENDING_TTL_DAYS"];
  const n = raw !== void 0 ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PENDING_TTL_DAYS;
}
function dedupWindowMinutes() {
  const raw = process.env["EPOCH_DEDUP_WINDOW"];
  if (raw === void 0) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
var dedupHitCount = 0;
var unknownToolRejectionLogged = false;
function inputsSignature(inputs) {
  return JSON.stringify(sortKeysDeep(inputs));
}
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeysDeep(v)]));
  }
  return value;
}
function findDedupMatch(canonicalTool, inputs, sessionId, windowMinutes, estimatesFile, actualsFile) {
  const signature = inputsSignature(inputs);
  const cutoffMs = Date.now() - windowMinutes * 6e4;
  const nowMs = Date.now();
  const estimates = readLines(estimatesFile);
  const actualIds = new Set(readLines(actualsFile).map((a) => a.estimateId));
  const candidates = estimates.filter((e) => {
    if (actualIds.has(e.id)) return false;
    if ((canonicalizeToolName(e.tool) ?? e.tool) !== canonicalTool) return false;
    if (stringField(e.inputs["session_id"]) !== sessionId) return false;
    if (inputsSignature(e.inputs) !== signature) return false;
    const estimatedAtMs = Date.parse(e.estimatedAt);
    if (!Number.isFinite(estimatedAtMs) || estimatedAtMs < cutoffMs) return false;
    if (e.expiresAt) {
      const expiresMs = Date.parse(e.expiresAt);
      if (Number.isFinite(expiresMs) && expiresMs <= nowMs) return false;
    }
    return true;
  });
  if (candidates.length !== 1) return null;
  const [onlyCandidate] = candidates;
  return onlyCandidate ? onlyCandidate.id : null;
}
var DEFAULT_MIN_N_FOR_VERDICT = 20;
function minNForVerdict() {
  const raw = process.env["EPOCH_MIN_N_FOR_VERDICT"];
  const n = raw !== void 0 ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_N_FOR_VERDICT;
}
function calibrationRecommendation(pairs, metrics, minN, zeroMessage) {
  if (pairs === 0) {
    return `Insufficient sample (n=0). ${zeroMessage}`;
  }
  if (pairs < minN) {
    const needed = minN - pairs;
    return `Insufficient sample (n=${pairs}). Need ${needed} more matched pair${needed === 1 ? "" : "s"} before a calibration verdict is reported (minimum ${minN}).`;
  }
  const bl = biasLabel(metrics?.bias ?? null);
  if (pairs < 10) {
    return `Sufficient for calibration (${pairs} pairs, capped MdAPE: ${metrics?.cappedMdape?.toFixed(1) ?? "N/A"}%, ${bl}). Collect more to improve reliability.`;
  }
  return `Good coverage (${pairs} pairs, capped MdAPE: ${metrics?.cappedMdape?.toFixed(1) ?? "N/A"}%, ${bl}).${metrics && metrics.cappedMdape > 50 ? " Review outliers." : ""}`;
}
function biasLabel(bias) {
  if (bias === null) return "";
  if (bias > 2) return "systematic underestimation";
  if (bias > 0.5) return "mild underestimation";
  if (bias > -0.5) return "well-calibrated";
  if (bias > -3) return "mild overestimation";
  return "systematic overestimation";
}
function ensureDir() {
  const dir = dataDir2();
  if (existsSync4(dir)) return true;
  try {
    mkdirSync3(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}
function appendLine(filename, data) {
  if (!ensureDir()) return false;
  const path = join4(dataDir2(), filename);
  try {
    appendFileSync2(path, JSON.stringify(data) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}
var batchAppendWriteCalls = 0;
function appendLines(filename, records) {
  if (records.length === 0) return true;
  batchAppendWriteCalls++;
  if (!ensureDir()) return false;
  const path = join4(dataDir2(), filename);
  try {
    appendFileSync2(path, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}
function appendNewEstimate(canonicalTool, inputs, outputs, source, targetFile) {
  const id = randomUUID2();
  const record = {
    id,
    tool: canonicalTool,
    inputs,
    outputs,
    estimatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    expiresAt: new Date(Date.now() + pendingTtlDays() * 864e5).toISOString(),
    ...source && { source },
    // --- Ticket 11 (estimate-basis unification) — SEPARATE HUNK, lane H ---
    // Every newly written row carries the post-unification basis-version
    // stamp: from this point on the estimate a tool DISPLAYS is the estimate
    // the ledger RECORDS (PERT: raw `expected`; reference-class:
    // `correctedEstimate`). Legacy rows (no stamp) are implicitly v1 — the
    // era in which tools displayed an adjustedEstimate the ledger never
    // recorded — and ratio populations stay split by that era (coverage.ts),
    // with no automatic aging-out.
    basisVersion: CURRENT_BASIS_VERSION
  };
  const written = appendLine(targetFile, record);
  return written ? id : null;
}
function recordEstimate(tool, inputs, outputs, source) {
  const canonicalTool = canonicalizeToolName(tool) ?? tool;
  const targetFile = isDryRun() ? DRY_RUN_ESTIMATES_FILE : ESTIMATES_FILE;
  const sessionId = stringField(inputs["session_id"]);
  const windowMinutes = dedupWindowMinutes();
  if (sessionId && windowMinutes !== null) {
    const actualsFile = isDryRun() ? DRY_RUN_FILE : ACTUALS_FILE;
    try {
      return withLedgerWriteLock(
        targetFile,
        () => {
          const existingId = findDedupMatch(canonicalTool, inputs, sessionId, windowMinutes, targetFile, actualsFile);
          if (existingId) {
            dedupHitCount++;
            debugLog("feedback.dedup-hit", `reused pending estimate ${existingId} for tool ${canonicalTool}, session ${sessionId}`);
            return existingId;
          }
          return appendNewEstimate(canonicalTool, inputs, outputs, source, targetFile);
        },
        "recordEstimate-dedup"
      );
    } catch (err) {
      if (err instanceof LedgerLockTimeoutError || err instanceof LedgerLockUnavailableError) {
        debugLog("feedback.lock-failure", `dedup get-or-create for tool ${canonicalTool} abandoned: ${err.message}`);
      }
      return null;
    }
  }
  return appendNewEstimate(canonicalTool, inputs, outputs, source, targetFile);
}
var TOOL_CALLS_FILE = "tool-calls.jsonl";
var DRY_RUN_TOOL_CALLS_FILE = "tool-calls.dry-run.jsonl";
function recordToolCall(tool, inputs, outputs, source) {
  const id = randomUUID2();
  const record = {
    id,
    tool,
    inputs,
    outputs,
    calledAt: (/* @__PURE__ */ new Date()).toISOString(),
    ...source && { source }
  };
  appendLine(isDryRun() ? DRY_RUN_TOOL_CALLS_FILE : TOOL_CALLS_FILE, record);
  return id;
}
var UNKNOWN_TOOL_HINT = `Actuals can only join estimates produced by Epoch's estimation tools: ${[...ESTIMATION_TOOL_NAMES].join(", ")}.`;
function lockTimeoutHint(err) {
  return `Another process held the feedback ledger write lock past the timeout (${err.lockPath}). Retry shortly; a stale lock is removed automatically once its owner PID is gone or it exceeds the staleness window.`;
}
function lockUnavailableHint(err) {
  return `The feedback ledger write lock could not be created (${err.lockPath}) \u2014 check directory permissions and filesystem health. The write failed closed rather than racing unlocked; retry once the cause is fixed.`;
}
var DRY_RUN_FILE = "feedback.dry-run.jsonl";
var DRY_RUN_ESTIMATES_FILE = "estimates.dry-run.jsonl";
var MINIMUM_RECORDED_ACTUAL_HOURS = 0;
var ACTUAL_UNIT_TO_HOURS = {
  minutes: 1 / 60,
  hours: 1,
  days: 8,
  weeks: 40
};
var UNIT_SUSPECT_RATIO = 10;
var UNIT_SUSPECT_FLAG_HINT = "Suspected unit mismatch: the estimate and actual differ by more than 10x (either direction \u2014 the detection is symmetric) \u2014 check the units (hours vs days/weeks/person-months). The record is saved and flagged; it is excluded from calibration math if the ratio exceeds 50x.";
var ESTIMATE_UNIT_TO_HOURS = {
  hours: 1,
  days: 8,
  weeks: 40,
  months: 160
};
function normalizeActualHours(value, unit) {
  if (!unit) return value;
  return value * ACTUAL_UNIT_TO_HOURS[unit];
}
function isDryRun() {
  return process.env["EPOCH_DRY_RUN"] === "1" || process.env["EPOCH_DRY_RUN"] === "true";
}
function recordActual(estimateId, actualHours, notes, unit, calibrationProvenance) {
  const result = recordActualDetailed(estimateId, actualHours, notes, unit, calibrationProvenance);
  return result.ok;
}
function evaluateActualForWrite(estimateId, normalizedHours, notes, calibrationProvenance, matchedEstimate) {
  let flagged;
  let matchedEstimatedHours = null;
  if (matchedEstimate) {
    if (canonicalizeToolName(matchedEstimate.tool) === null) {
      if (!unknownToolRejectionLogged) {
        unknownToolRejectionLogged = true;
        debugLog(
          "feedback.unknown-tool",
          `rejecting actual for estimate ${estimateId}: tool "${matchedEstimate.tool}" is not in the canonical estimation set {${[...ESTIMATION_TOOL_NAMES].join(", ")}}`
        );
      }
      return { result: { ok: false, reason: "unknown_tool", hint: UNKNOWN_TOOL_HINT }, record: null };
    }
    matchedEstimatedHours = extractEstimatedHours(matchedEstimate.outputs);
    if (matchedEstimatedHours !== null && matchedEstimatedHours > 0 && normalizedHours > 0) {
      const ratio = Math.max(normalizedHours / matchedEstimatedHours, matchedEstimatedHours / normalizedHours);
      if (ratio > UNIT_SUSPECT_RATIO) flagged = "unit_suspect";
    }
  }
  if (calibrationProvenance === "auto_wallclock" && !isAutoWallclockSane(normalizedHours, matchedEstimatedHours)) {
    return { result: { ok: false, reason: "auto_wallclock_out_of_bounds" }, record: null };
  }
  const record = {
    estimateId,
    actualHours: normalizedHours,
    ...notes && { notes },
    reportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    ...calibrationProvenance && { calibrationProvenance },
    // Persist the unit-suspect verdict on the record itself (ticket 16) so
    // the flag survives as an audit artifact even though read-side exclusion
    // always recomputes the ratio (exclusion.ts's MAX_RATIO gate).
    ...flagged === "unit_suspect" && { unitSuspect: true }
  };
  return { result: flagged ? { ok: true, flagged } : { ok: true }, record };
}
function recordActualDetailed(estimateId, actualHours, notes, unit, calibrationProvenance) {
  const normalizedHours = normalizeActualHours(actualHours, unit);
  if (normalizedHours <= MINIMUM_RECORDED_ACTUAL_HOURS) return { ok: false, reason: "below_threshold" };
  if (isSyntheticId(estimateId)) return { ok: false, reason: "synthetic_id" };
  const dryRun = isDryRun();
  const actualsSource = dryRun ? DRY_RUN_FILE : ACTUALS_FILE;
  const estimatesSource = dryRun ? DRY_RUN_ESTIMATES_FILE : ESTIMATES_FILE;
  try {
    return withLedgerWriteLock(
      actualsSource,
      () => {
        const existing = readLines(actualsSource);
        if (existing.some((a) => a.estimateId === estimateId)) {
          return { ok: false, reason: "duplicate" };
        }
        const matchedEstimate = readLines(estimatesSource).find((e) => e.id === estimateId);
        const { result, record } = evaluateActualForWrite(estimateId, normalizedHours, notes, calibrationProvenance, matchedEstimate);
        if (!result.ok) return result;
        const written = appendLine(actualsSource, record);
        if (!written) return { ok: false, reason: "write_failed" };
        return result;
      },
      "recordActual"
    );
  } catch (err) {
    if (err instanceof LedgerLockTimeoutError || err instanceof LedgerLockUnavailableError) {
      debugLog("feedback.lock-failure", `record_actual for ${estimateId} abandoned: ${err.message}`);
      return {
        ok: false,
        reason: "write_failed",
        hint: err instanceof LedgerLockUnavailableError ? lockUnavailableHint(err) : lockTimeoutHint(err)
      };
    }
    throw err;
  }
}
function getPendingEstimates(limit = 50) {
  const estimates = readLines(ESTIMATES_FILE);
  const actuals = readLines(ACTUALS_FILE);
  const actualIds = new Set(actuals.map((a) => a.estimateId));
  return estimates.map((e) => ({ ...e, hasActual: actualIds.has(e.id) })).filter((e) => !e.hasActual).filter((e) => {
    const verdict = isExcluded({ id: e.id, tool: e.tool, estimatedAt: e.estimatedAt, expiresAt: e.expiresAt });
    return !(verdict.excluded && verdict.reason === "ttl_expired");
  }).slice(-limit);
}
function getCalibrationData(teamId, taskType, windowDays, tool, calibrationUsage = "correction") {
  const records = matchEstimatesToActuals(
    readLines(ESTIMATES_FILE),
    readLines(ACTUALS_FILE),
    { teamId, taskType, windowDays, tool },
    overlayFlagsById()
  );
  if (calibrationUsage === "all") return records;
  return records.filter((record) => record.calibrationUsage === calibrationUsage);
}
function stringField(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function happenedBefore(a, b) {
  if (!a || !b) return false;
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return false;
  return aTime < bTime - 6e4;
}
function provenanceForExclusionReason(reason) {
  switch (reason) {
    case "smoke":
      return "smoke";
    case "explicit_exclude":
    case "industry_calibration_note":
    case "seed_notes":
    case "synthetic_id":
    case "backfill_signature":
    case "ratio_outlier":
    case "below_calibration_threshold":
      return "synthetic";
    default:
      return "unknown";
  }
}
function classifyCalibrationRecord(est, act, estimatedHours, overlayFlags) {
  const actualAsRecord = act;
  const verdict = isExcluded({
    id: est.id,
    tool: est.tool,
    inputs: est.inputs,
    estimatedAt: est.estimatedAt,
    estimatedHours,
    actual: exclusionActualFields(act),
    ...overlayFlags && { flags: { quarantined: overlayFlags.quarantined, orphan: overlayFlags.orphan } }
  });
  if (verdict.excluded) {
    return { calibrationProvenance: provenanceForExclusionReason(verdict.reason), calibrationUsage: "exclude" };
  }
  const inputs = est.inputs;
  const actual = actualAsRecord;
  const explicitProvenance = normalizeProvenance2(
    inputs["calibration_provenance"] ?? actual["calibrationProvenance"] ?? actual["calibration_provenance"]
  );
  const explicitUsage = normalizeUsage2(
    inputs["calibration_usage"] ?? actual["calibrationUsage"] ?? actual["calibration_usage"]
  );
  if (explicitProvenance) {
    const defaultUsage = explicitProvenance === "prospective" || explicitProvenance === "auto_wallclock" ? "correction" : "baseline";
    return {
      calibrationProvenance: explicitProvenance,
      calibrationUsage: explicitUsage ?? defaultUsage
    };
  }
  const notes = (act.notes ?? "").toLowerCase();
  const hasExplicitUsage = explicitUsage !== void 0;
  if (!hasExplicitUsage) {
    if (notes.includes("ingested from")) {
      return { calibrationProvenance: "backfilled_real_session", calibrationUsage: "baseline" };
    }
    if (notes.includes("real data calibration")) {
      return { calibrationProvenance: "backfilled_calibration", calibrationUsage: "baseline" };
    }
  }
  if (happenedBefore(stringField(actual["completedAt"]), est.estimatedAt)) {
    return { calibrationProvenance: "backfilled_calibration", calibrationUsage: "baseline" };
  }
  return { calibrationProvenance: "prospective", calibrationUsage: explicitUsage ?? "correction" };
}
function unitSuspectFlag(act) {
  return act["unitSuspect"] === true;
}
function exclusionActualFields(act) {
  const asRecord = act;
  return {
    actualHours: act.actualHours,
    notes: act.notes,
    reportedAt: act.reportedAt,
    completedAt: act.completedAt,
    calibrationProvenance: act.calibrationProvenance,
    calibrationUsage: stringField(asRecord["calibrationUsage"]),
    calibration_provenance: stringField(asRecord["calibration_provenance"]),
    calibration_usage: stringField(asRecord["calibration_usage"]),
    ...unitSuspectFlag(act) && { unitSuspect: true }
  };
}
var VALID_PROVENANCE2 = /* @__PURE__ */ new Set([
  "prospective",
  "backfilled_real_session",
  "backfilled_calibration",
  "synthetic",
  "smoke",
  "unknown",
  "auto_wallclock"
]);
var VALID_USAGE2 = /* @__PURE__ */ new Set(["correction", "baseline", "exclude"]);
function normalizeProvenance2(value) {
  const raw = stringField(value);
  if (!raw) return void 0;
  return VALID_PROVENANCE2.has(raw) ? raw : void 0;
}
function normalizeUsage2(value) {
  const raw = stringField(value);
  if (!raw) return void 0;
  return VALID_USAGE2.has(raw) ? raw : void 0;
}
function overlayFlagsById() {
  const map = /* @__PURE__ */ new Map();
  for (const rec of loadLedgerWithOverlays()) {
    map.set(rec.id, rec.flags);
  }
  return map;
}
function matchEstimatesToActuals(estimates, actuals, filters, overlayFlags) {
  const actualsMap = joinActualsEarliestReported(actuals);
  const cutoff = filters?.windowDays ? new Date(Date.now() - filters.windowDays * 864e5).toISOString() : "0000";
  const records = [];
  for (const est of estimates) {
    if (est.estimatedAt < cutoff) continue;
    const act = actualsMap.get(est.id);
    if (!act) continue;
    const estHours = extractEstimatedHours(est.outputs);
    const canonicalTool = canonicalizeToolName(est.tool) ?? est.tool;
    const calibration = classifyCalibrationRecord(est, act, estHours, overlayFlags?.get(est.id));
    if (calibration.calibrationUsage === "exclude") continue;
    if (estHours === null) continue;
    const type = est.inputs["task_type"] ?? inferTaskType(canonicalTool);
    if (filters?.taskType && type !== filters.taskType) continue;
    if (filters?.teamId && est.inputs["team_id"] !== filters.teamId) continue;
    if (filters?.tool && canonicalTool !== filters.tool) continue;
    const complexity = typeof est.inputs["complexity"] === "number" ? est.inputs["complexity"] : void 0;
    const completedAt = stringField(act["completedAt"]) ?? act.reportedAt ?? "";
    records.push({
      taskType: type,
      estimatedHours: estHours,
      actualHours: act.actualHours,
      tool: canonicalTool,
      ...complexity !== void 0 && { complexity },
      ...filters?.teamId && { teamId: filters.teamId },
      completedAt,
      calibrationProvenance: calibration.calibrationProvenance,
      calibrationUsage: calibration.calibrationUsage
    });
  }
  return records.sort((a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? ""));
}
function extractEstimatedHours(outputs) {
  if (typeof outputs["totalHours"] === "number") return outputs["totalHours"];
  if (typeof outputs["estimatedHours"] === "number") return outputs["estimatedHours"];
  if (typeof outputs["estimatedMinutes"] === "number") return outputs["estimatedMinutes"] / 60;
  if (typeof outputs["estimatedSeconds"] === "number") return outputs["estimatedSeconds"] / 3600;
  if (typeof outputs["expected"] === "number") {
    const unit = outputs["unit"];
    if (unit === void 0) return outputs["expected"];
    const factor = ESTIMATE_UNIT_TO_HOURS[unit];
    return factor === void 0 ? null : outputs["expected"] * factor;
  }
  if (typeof outputs["personMonthsLlmAdjusted"] === "number") {
    return outputs["personMonthsLlmAdjusted"] * 160;
  }
  if (typeof outputs["correctedEstimate"] === "number") {
    return outputs["correctedEstimate"];
  }
  if (typeof outputs["total_duration"] === "number") {
    return outputs["total_duration"] * 8;
  }
  return null;
}
var TOOL_TASK_TYPE_FALLBACK = {
  pert_estimate: "feature",
  cocomo_estimate: "feature",
  sprint_forecast: "feature",
  reference_class_estimate: "feature",
  monte_carlo_schedule: "feature",
  critical_path: "feature",
  token_time_bridge: "infrastructure",
  token_cost_estimate: "infrastructure",
  calibrate_estimates: "feature",
  schedule_risk: "feature",
  feedback_health: "feature",
  accuracy_trend: "feature",
  compare_models: "feature"
};
function inferTaskType(tool) {
  return TOOL_TASK_TYPE_FALLBACK[tool] ?? "feature";
}
function batchRecordActuals(entries) {
  const perEntry = entries.map(() => void 0);
  const dryRun = isDryRun();
  const actualsSource = dryRun ? DRY_RUN_FILE : ACTUALS_FILE;
  const estimatesSource = dryRun ? DRY_RUN_ESTIMATES_FILE : ESTIMATES_FILE;
  const candidates = [];
  for (const [index, entry] of entries.entries()) {
    const normalizedHours = normalizeActualHours(entry.actualHours, entry.unit);
    if (normalizedHours <= MINIMUM_RECORDED_ACTUAL_HOURS) {
      perEntry[index] = { ok: false, reason: "below_threshold" };
      continue;
    }
    if (isSyntheticId(entry.estimateId)) {
      perEntry[index] = { ok: false, reason: "synthetic_id" };
      continue;
    }
    candidates.push({ entry, normalizedHours, index });
  }
  if (candidates.length > 0) {
    try {
      withLedgerWriteLock(
        actualsSource,
        () => {
          const existingIds = new Set(readLines(actualsSource).map((a) => a.estimateId));
          const estimatesById = /* @__PURE__ */ new Map();
          for (const estimate of readLines(estimatesSource)) estimatesById.set(estimate.id, estimate);
          const claimed = /* @__PURE__ */ new Set();
          const toAppend = [];
          for (const candidate of candidates) {
            if (existingIds.has(candidate.entry.estimateId) || claimed.has(candidate.entry.estimateId)) {
              perEntry[candidate.index] = { ok: false, reason: "duplicate" };
              continue;
            }
            const evaluation = evaluateActualForWrite(
              candidate.entry.estimateId,
              candidate.normalizedHours,
              candidate.entry.notes,
              candidate.entry.calibrationProvenance,
              estimatesById.get(candidate.entry.estimateId)
            );
            perEntry[candidate.index] = evaluation.result;
            if (evaluation.record !== null) {
              claimed.add(candidate.entry.estimateId);
              toAppend.push({ index: candidate.index, record: evaluation.record });
            }
          }
          if (toAppend.length > 0 && !appendLines(actualsSource, toAppend.map((p) => p.record))) {
            for (const pending of toAppend) perEntry[pending.index] = { ok: false, reason: "write_failed" };
          }
        },
        "batchRecordActuals"
      );
    } catch (err) {
      if (err instanceof LedgerLockTimeoutError || err instanceof LedgerLockUnavailableError) {
        debugLog("feedback.lock-failure", `batch_record_actuals (${candidates.length} entries) abandoned: ${err.message}`);
        const hint = err instanceof LedgerLockUnavailableError ? lockUnavailableHint(err) : lockTimeoutHint(err);
        for (const candidate of candidates) {
          if (perEntry[candidate.index] === void 0) {
            perEntry[candidate.index] = { ok: false, reason: "write_failed", hint };
          }
        }
      } else {
        throw err;
      }
    }
  }
  const errors = [];
  let succeeded = 0;
  for (const [index, entry] of entries.entries()) {
    const result = perEntry[index] ?? { ok: false, reason: "write_failed" };
    if (result.ok) {
      succeeded++;
    } else {
      errors.push(`Failed to record actual for estimate ${entry.estimateId} (reason: ${result.reason})${result.hint ? ` \u2014 ${result.hint}` : ""}`);
    }
  }
  return { total: entries.length, succeeded, failed: errors.length, errors };
}
var FEEDBACK_HEALTH_CALIBRATION_TOOLS = [...ESTIMATION_TOOL_NAMES];
function getFeedbackHealthReport() {
  const estimates = readLines(ESTIMATES_FILE);
  const actuals = readLines(ACTUALS_FILE);
  const actualIds = new Set(actuals.map((a) => a.estimateId));
  const duplicateActuals = countDuplicateActuals(actuals);
  const corruptLineCounts = getLedgerCorruptLines();
  const corruptLines = (corruptLineCounts.get(join4(dataDir2(), ESTIMATES_FILE)) ?? 0) + (corruptLineCounts.get(join4(dataDir2(), ACTUALS_FILE)) ?? 0);
  const totalEstimates = estimates.length;
  const totalActuals = actuals.length;
  const matchedEstimateCount = estimates.filter((estimate) => actualIds.has(estimate.id)).length;
  const matchRate = totalEstimates > 0 ? Math.round(matchedEstimateCount / totalEstimates * 1e3) / 10 : 0;
  const overlayFlags = overlayFlagsById();
  const allMatched = matchEstimatesToActuals(estimates, actuals, void 0, overlayFlags);
  const correctionMatched = allMatched.filter((record) => record.calibrationUsage !== "baseline");
  const baselineRecords = allMatched.length - correctionMatched.length;
  const estimatesById = /* @__PURE__ */ new Map();
  for (const e of estimates) estimatesById.set(e.id, e);
  const joinedActuals = joinActualsEarliestReported(actuals);
  let seedRecordsFiltered = 0;
  for (const a of joinedActuals.values()) {
    const est = estimatesById.get(a.estimateId);
    if (!est) continue;
    const estHours = extractEstimatedHours(est.outputs);
    const verdict = isExcluded({
      id: est.id,
      tool: est.tool,
      inputs: est.inputs,
      estimatedAt: est.estimatedAt,
      estimatedHours: estHours,
      actual: exclusionActualFields(a),
      flags: { quarantined: overlayFlags.get(est.id)?.quarantined, orphan: overlayFlags.get(est.id)?.orphan }
    });
    if (verdict.excluded) seedRecordsFiltered++;
  }
  const toolEstimates = /* @__PURE__ */ new Map();
  const toolActuals = /* @__PURE__ */ new Map();
  const toolRecords = /* @__PURE__ */ new Map();
  for (const e of estimates) {
    toolEstimates.set(e.tool, (toolEstimates.get(e.tool) ?? 0) + 1);
    if (actualIds.has(e.id)) {
      toolActuals.set(e.tool, (toolActuals.get(e.tool) ?? 0) + 1);
    }
  }
  for (const r of correctionMatched) {
    const toolKey = r.tool ?? "unknown";
    const records = toolRecords.get(toolKey) ?? [];
    records.push(r);
    toolRecords.set(toolKey, records);
  }
  const minN = minNForVerdict();
  const byTool = {};
  for (const [tool, count] of toolEstimates) {
    const matched = toolRecords.get(tool) ?? [];
    const metrics = matched.length >= 2 ? computeAccuracyMetrics(matched) : null;
    const pairs = matched.length;
    const recommendation2 = calibrationRecommendation(pairs, metrics, minN, "No matched pairs. Record actuals to start calibration.");
    byTool[tool] = { estimates: count, actuals: toolActuals.get(tool) ?? 0, matchedPairs: pairs, mape: metrics?.mape ?? null, mdape: metrics?.mdape ?? null, cappedMdape: metrics?.cappedMdape ?? null, bias: metrics?.bias ?? null, trend: metrics?.trend ?? null, recommendation: recommendation2 };
  }
  const typeGroups = /* @__PURE__ */ new Map();
  for (const r of correctionMatched) {
    const records = typeGroups.get(r.taskType) ?? [];
    records.push(r);
    typeGroups.set(r.taskType, records);
  }
  const typeEstimateCounts = /* @__PURE__ */ new Map();
  for (const e of estimates) {
    const type = e.inputs["task_type"] ?? inferTaskType(e.tool);
    typeEstimateCounts.set(type, (typeEstimateCounts.get(type) ?? 0) + 1);
  }
  const byTaskType = {};
  for (const [type, count] of typeEstimateCounts) {
    const records = typeGroups.get(type) ?? [];
    const metrics = records.length >= 2 ? computeAccuracyMetrics(records) : null;
    const pairs = records.length;
    const typeRec = calibrationRecommendation(pairs, metrics, minN, "No matched pairs. Use this task type in estimates and record actuals.");
    byTaskType[type] = { estimates: count, actuals: records.length, matchedPairs: pairs, mape: metrics?.mape ?? null, mdape: metrics?.mdape ?? null, cappedMdape: metrics?.cappedMdape ?? null, bias: metrics?.bias ?? null, trend: metrics?.trend ?? null, recommendation: typeRec };
  }
  const readyTypes = [];
  for (const [type, records] of typeGroups) {
    if (records.length >= 5) readyTypes.push(type);
  }
  const callsUntilUpdate = Math.max(0, 100 - totalEstimates);
  let overallMdape = null;
  let overallCappedMdape = null;
  let outlierRatio = 0;
  let recommendation;
  if (correctionMatched.length >= 5) {
    const metrics = computeAccuracyMetrics(correctionMatched);
    overallMdape = metrics.mdape;
    overallCappedMdape = metrics.cappedMdape;
    const outlierThreshold = metrics.cappedMdape * 3;
    const outliers = correctionMatched.filter((r) => {
      const err = Math.abs(r.actualHours - r.estimatedHours) / r.actualHours * 100;
      return err > outlierThreshold;
    });
    outlierRatio = Math.round(outliers.length / correctionMatched.length * 1e3) / 10;
    if (overallCappedMdape < 25) {
      recommendation = "Data quality is good. Capped MdAPE below 25% indicates reliable estimates.";
    } else if (overallCappedMdape < 50) {
      recommendation = "Data quality is moderate. Consider filtering outlier records or collecting more matched pairs.";
    } else {
      recommendation = "Data quality needs improvement. High capped MdAPE suggests systematic estimation bias. Review seed data for human/AI baseline mismatches.";
    }
  } else {
    recommendation = "Insufficient data for quality assessment. Need at least 5 matched estimate-actual pairs.";
  }
  const toolsWithData = Object.entries(byTool).filter(([, v]) => v.matchedPairs > 0).length;
  const typesWithData = Object.entries(byTaskType).filter(([, v]) => v.matchedPairs > 0).length;
  const mdapeLabel = overallMdape !== null ? `${Math.round(overallMdape)}%` : "N/A";
  const cappedLabel = overallCappedMdape !== null ? `${Math.round(overallCappedMdape)}%` : "N/A";
  const estimationTools = FEEDBACK_HEALTH_CALIBRATION_TOOLS;
  const toolsCalibrated = estimationTools.filter((t) => (byTool[t]?.matchedPairs ?? 0) >= 3).length;
  const toolScore = Math.round(toolsCalibrated / estimationTools.length * 40);
  const allTaskTypes = Object.keys(byTaskType);
  const typesCalibrated = allTaskTypes.filter((t) => (byTaskType[t]?.matchedPairs ?? 0) >= 3).length;
  const typeScore = allTaskTypes.length > 0 ? Math.round(typesCalibrated / allTaskTypes.length * 30) : 0;
  const pairScore = Math.min(30, Math.round(correctionMatched.length / 100 * 30));
  const dataCompletenessScore = toolScore + typeScore + pairScore;
  const seedLabel = seedRecordsFiltered > 0 ? ` (${seedRecordsFiltered} seed records filtered)` : "";
  const autoMatched = correctionMatched.filter((r) => r.calibrationProvenance === "auto_wallclock");
  const verifiedMatched = correctionMatched.filter((r) => r.calibrationProvenance !== "auto_wallclock");
  const autoMetrics = autoMatched.length >= 2 ? computeAccuracyMetrics(autoMatched) : null;
  const verifiedMetrics = verifiedMatched.length >= 2 ? computeAccuracyMetrics(verifiedMatched) : null;
  const byProvenance = {
    verified: { matchedPairs: verifiedMatched.length, mdape: verifiedMetrics?.mdape ?? null, cappedMdape: verifiedMetrics?.cappedMdape ?? null },
    auto: { matchedPairs: autoMatched.length, mdape: autoMetrics?.mdape ?? null, cappedMdape: autoMetrics?.cappedMdape ?? null }
  };
  const integrityLabel = duplicateActuals > 0 || corruptLines > 0 ? ` Data integrity: ${duplicateActuals} estimate id${duplicateActuals === 1 ? "" : "s"} with duplicate actuals (earliest-reported wins the join), ${corruptLines} corrupt ledger line${corruptLines === 1 ? "" : "s"} skipped.` : "";
  return {
    totalEstimates,
    totalActuals,
    matchedPairs: correctionMatched.length,
    seedRecordsFiltered,
    duplicateActuals,
    corruptLines,
    provenance: { correctionRecords: correctionMatched.length, baselineRecords, excludedRecords: seedRecordsFiltered },
    matchRate,
    byTool,
    byTaskType,
    byProvenance,
    selfImprovement: { readyTypes, callsUntilUpdate },
    dataQuality: { overallMdape, overallCappedMdape, outlierRatio, recommendation, dataCompletenessScore },
    humanReadable: `${correctionMatched.length} correction-eligible matched pairs across ${toolsWithData} tools and ${typesWithData} task types (capped MdAPE: ${cappedLabel}, raw MdAPE: ${mdapeLabel}; ${baselineRecords} baseline-only records held out). ${totalEstimates} estimates, ${totalActuals} actuals, match rate: ${matchRate}%${seedLabel}. ${recommendation}${integrityLabel}`
  };
}

// src/lib/telemetry-receiver.ts
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { appendFileSync as appendFileSync3, existsSync as existsSync5, mkdirSync as mkdirSync4, readFileSync as readFileSync4, statSync as statSync2 } from "fs";
import { homedir as homedir4 } from "os";
import { join as join5 } from "path";
var V1_TOP_LEVEL_FIELDS = /* @__PURE__ */ new Set([
  "schema_version",
  "installation_id",
  "epoch_version",
  "records",
  "generated_at"
]);
var V2_TOP_LEVEL_FIELDS = /* @__PURE__ */ new Set([
  ...V1_TOP_LEVEL_FIELDS,
  "client_name",
  "client_version",
  "transport",
  "runtime_hint"
]);
var RECORD_FIELDS = /* @__PURE__ */ new Set([
  "task_type",
  "complexity",
  "tool",
  "estimated_hours",
  "actual_hours",
  "ratio",
  "date",
  "completed_at"
]);
var VALID_TRANSPORTS = /* @__PURE__ */ new Set(["mcp-stdio", "mcp-http", "cli", "rest"]);
var VALID_RUNTIME_HINTS = /* @__PURE__ */ new Set(["agent", "human", "unknown"]);
var RATIO_CONSISTENCY_TOLERANCE = 0.02;
var HOURS_ROUNDING_HALF_SPAN = 5e-3;
var MIN_TELEMETRY_HOURS = MINIMUM_CALIBRATION_ACTUAL_HOURS;
var MAX_TELEMETRY_HOURS = 1e5;
var MAX_RECORDS_PER_PAYLOAD = 100;
var DEFAULT_MAX_RECORDS_PER_INSTALLATION = 1e4;
var DEFAULT_MAX_TOTAL_RECORDS = 1e6;
var QUARANTINE_REASON_UNTRUSTED_SOURCE = "untrusted_integrity_only_source";
var QUARANTINE_REASON_SMOKE_PROVENANCE = "smoke_provenance";
function hasOnlyAllowedKeys(obj, allowed) {
  return Object.keys(obj).every((key) => allowed.has(key));
}
function isNullableString(value) {
  return value === null || typeof value === "string";
}
function dataDir3() {
  return process.env["EPOCH_DATA_DIR"] ?? join5(homedir4(), ".epoch");
}
function receiptPath() {
  return join5(dataDir3(), "telemetry-receipts.jsonl");
}
function quarantinePath() {
  return join5(dataDir3(), "telemetry-quarantine.jsonl");
}
function recordKeysPath() {
  return join5(dataDir3(), "telemetry-record-keys.jsonl");
}
function safeEqualHex(a, b) {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
function isRecordArray(value) {
  return Array.isArray(value);
}
function isAnonymizedRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value;
  if (!hasOnlyAllowedKeys(record, RECORD_FIELDS)) return false;
  return typeof record["task_type"] === "string" && record["task_type"].length > 0 && (typeof record["complexity"] === "number" || record["complexity"] === null) && typeof record["tool"] === "string" && record["tool"].length > 0 && typeof record["estimated_hours"] === "number" && Number.isFinite(record["estimated_hours"]) && typeof record["actual_hours"] === "number" && Number.isFinite(record["actual_hours"]) && typeof record["ratio"] === "number" && Number.isFinite(record["ratio"]) && typeof record["date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record["date"]) && (record["completed_at"] === void 0 || typeof record["completed_at"] === "string");
}
function isRatioConsistent(estimatedHours, actualHours, ratio) {
  if (!Number.isFinite(estimatedHours) || !Number.isFinite(actualHours) || !Number.isFinite(ratio) || estimatedHours <= 0 || ratio <= 0) {
    return false;
  }
  const low = (actualHours - HOURS_ROUNDING_HALF_SPAN) / (estimatedHours + HOURS_ROUNDING_HALF_SPAN) / (1 + RATIO_CONSISTENCY_TOLERANCE);
  const high = (actualHours + HOURS_ROUNDING_HALF_SPAN) / Math.max(estimatedHours - HOURS_ROUNDING_HALF_SPAN, 1e-9) * (1 + RATIO_CONSISTENCY_TOLERANCE);
  return ratio >= low && ratio <= high;
}
function validateRecordStatistics(record, index) {
  if (record.estimated_hours < MIN_TELEMETRY_HOURS || record.estimated_hours > MAX_TELEMETRY_HOURS) {
    return `records[${index}]: estimated_hours ${record.estimated_hours} outside [${MIN_TELEMETRY_HOURS}, ${MAX_TELEMETRY_HOURS}]`;
  }
  if (record.actual_hours < MIN_TELEMETRY_HOURS || record.actual_hours > MAX_TELEMETRY_HOURS) {
    return `records[${index}]: actual_hours ${record.actual_hours} outside [${MIN_TELEMETRY_HOURS}, ${MAX_TELEMETRY_HOURS}]`;
  }
  if (record.ratio < MIN_RATIO || record.ratio > MAX_RATIO) {
    return `records[${index}]: ratio ${record.ratio} outside [${MIN_RATIO}, ${MAX_RATIO}] (exclusion.ts calibration bounds)`;
  }
  if (!isRatioConsistent(record.estimated_hours, record.actual_hours, record.ratio)) {
    const implied = record.actual_hours / record.estimated_hours;
    return `records[${index}]: ratio ${record.ratio} inconsistent with actual_hours/estimated_hours (expected \u2248 ${Math.round(implied * 1e4) / 1e4} within ${Math.round(RATIO_CONSISTENCY_TOLERANCE * 100)}% + rounding)`;
  }
  return null;
}
function countNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
function statFacts(path) {
  try {
    const s = statSync2(path);
    return { size: s.size, mtimeMs: s.mtimeMs, ino: String(s.ino) };
  } catch {
    return null;
  }
}
function statMatches(a, b) {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;
}
var knownRecordKeysByPath = /* @__PURE__ */ new Map();
var admissionsByPath = /* @__PURE__ */ new Map();
var recordKeyParsesByPath = /* @__PURE__ */ new Map();
function parseRecordKeys(path) {
  if (!existsSync5(path)) return /* @__PURE__ */ new Set();
  recordKeyParsesByPath.set(path, (recordKeyParsesByPath.get(path) ?? 0) + 1);
  return new Set(readFileSync4(path, "utf-8").split("\n").map((line) => line.trim()).filter(Boolean));
}
function loadRecordKeys() {
  const path = recordKeysPath();
  const stat = statFacts(path);
  const memo = knownRecordKeysByPath.get(path);
  if (stat !== null && memo !== void 0 && statMatches(memo.stat, stat)) return memo.keys;
  const keys = parseRecordKeys(path);
  if (stat !== null) knownRecordKeysByPath.set(path, { stat, keys });
  else knownRecordKeysByPath.delete(path);
  return keys;
}
function refreshRecordKeysMemo(keys) {
  const path = recordKeysPath();
  const stat = statFacts(path);
  if (stat === null) {
    knownRecordKeysByPath.delete(path);
    return;
  }
  const memo = knownRecordKeysByPath.get(path);
  if (memo !== void 0) memo.stat = stat;
  else knownRecordKeysByPath.set(path, { stat, keys });
}
function parseAdmissions(path) {
  const byInstallation = /* @__PURE__ */ new Map();
  if (!existsSync5(path)) return { total: 0, byInstallation };
  let total = 0;
  for (const line of readFileSync4(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let receipt;
    try {
      receipt = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof receipt !== "object" || receipt === null) continue;
    const r = receipt;
    const installationId = typeof r["installationId"] === "string" ? r["installationId"] : null;
    const admitted = countNonNegative(r["accepted"]) + countNonNegative(r["quarantined"]);
    if (!installationId || admitted <= 0) continue;
    total += admitted;
    byInstallation.set(installationId, (byInstallation.get(installationId) ?? 0) + admitted);
  }
  return { total, byInstallation };
}
function countNonEmptyLines(path) {
  try {
    return readFileSync4(path, "utf-8").split("\n").filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}
function loadAdmissions() {
  const path = receiptPath();
  const stat = statFacts(path);
  const memo = admissionsByPath.get(path);
  if (stat !== null && memo !== void 0 && statMatches(memo.stat, stat)) return memo.admissions;
  const admissions = parseAdmissions(path);
  const keysLineCount = countNonEmptyLines(recordKeysPath());
  if (keysLineCount > admissions.total) admissions.total = keysLineCount;
  if (stat !== null) admissionsByPath.set(path, { stat, admissions });
  else admissionsByPath.delete(path);
  return admissions;
}
function refreshAdmissionsMemo(admissions) {
  const path = receiptPath();
  const stat = statFacts(path);
  if (stat === null) {
    admissionsByPath.delete(path);
    return;
  }
  const memo = admissionsByPath.get(path);
  if (memo !== void 0) memo.stat = stat;
  else admissionsByPath.set(path, { stat, admissions });
}
function maxRecordsPerInstallation() {
  const raw = process.env["EPOCH_TELEMETRY_RECEIVER_MAX_PER_INSTALLATION"]?.trim();
  if (raw === void 0 || raw === "") return DEFAULT_MAX_RECORDS_PER_INSTALLATION;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_RECORDS_PER_INSTALLATION;
}
function maxTotalRecords() {
  const raw = process.env["EPOCH_TELEMETRY_RECEIVER_MAX_TOTAL"]?.trim();
  if (raw === void 0 || raw === "") return DEFAULT_MAX_TOTAL_RECORDS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_TOTAL_RECORDS;
}
function recordKey(installationId, record) {
  return createHash("sha256").update(JSON.stringify({ installationId, record })).digest("hex");
}
function rejection(error, status = 400) {
  return { ok: false, status, accepted: 0, deduplicated: 0, quarantined: 0, error };
}
function receiveTelemetry(rawBody, signature) {
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return rejection("invalid JSON body");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return rejection("payload must be a JSON object");
  }
  const payload = parsed;
  const installationId = payload["installation_id"];
  const schemaVersion = payload["schema_version"];
  const epochVersion = payload["epoch_version"];
  const records = payload["records"];
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    return rejection("unsupported schema_version");
  }
  const allowedTopLevel = schemaVersion === 2 ? V2_TOP_LEVEL_FIELDS : V1_TOP_LEVEL_FIELDS;
  if (!hasOnlyAllowedKeys(payload, allowedTopLevel)) {
    return rejection("payload contains disallowed fields");
  }
  if (typeof installationId !== "string" || installationId.length === 0) {
    return rejection("missing installation_id");
  }
  if (typeof epochVersion !== "string" || epochVersion.length === 0) {
    return rejection("missing epoch_version");
  }
  if (!isRecordArray(records)) {
    return rejection("records must be an array");
  }
  if (!records.every(isAnonymizedRecord)) {
    return rejection("records contain invalid anonymized telemetry fields");
  }
  if (records.length > MAX_RECORDS_PER_PAYLOAD) {
    return rejection(`too many records: ${records.length} exceeds ${MAX_RECORDS_PER_PAYLOAD} per payload`);
  }
  for (let index = 0; index < records.length; index++) {
    const error = validateRecordStatistics(records[index], index);
    if (error) return rejection(error);
  }
  let clientName = null;
  let clientVersion = null;
  let transport = null;
  let runtimeHint = null;
  if (schemaVersion === 2) {
    const rawClientName = payload["client_name"];
    const rawClientVersion = payload["client_version"];
    const rawTransport = payload["transport"];
    const rawRuntimeHint = payload["runtime_hint"];
    if (rawClientName !== void 0 && !isNullableString(rawClientName)) {
      return rejection("client_name must be a string or null");
    }
    if (rawClientVersion !== void 0 && !isNullableString(rawClientVersion)) {
      return rejection("client_version must be a string or null");
    }
    if (rawTransport !== void 0 && rawTransport !== null && (typeof rawTransport !== "string" || !VALID_TRANSPORTS.has(rawTransport))) {
      return rejection("invalid transport");
    }
    if (rawRuntimeHint !== void 0 && rawRuntimeHint !== null && (typeof rawRuntimeHint !== "string" || !VALID_RUNTIME_HINTS.has(rawRuntimeHint))) {
      return rejection("invalid runtime_hint");
    }
    clientName = rawClientName ?? null;
    clientVersion = rawClientVersion ?? null;
    transport = rawTransport ?? null;
    runtimeHint = rawRuntimeHint ?? null;
  }
  if (!signature) {
    return rejection("missing signature", 401);
  }
  const expected = createHmac("sha256", installationId).update(rawBody).digest("hex");
  if (!safeEqualHex(signature, expected)) {
    return rejection("invalid signature", 401);
  }
  const admissionLockPath = join5(dataDir3(), "telemetry-admission.lock");
  const admissionLock = acquireExclusiveFileLock(admissionLockPath, "epoch-receiver");
  if (!admissionLock.ok) {
    return rejection(
      admissionLock.reason === "unavailable" ? "receiver admission lock unavailable \u2014 storage or permissions problem; retry once fixed" : "receiver admission lock held past the timeout by another receive \u2014 retry shortly",
      503
    );
  }
  let admissions = null;
  let knownKeys = null;
  let quarantinedCount = 0;
  try {
    admissions = loadAdmissions();
    const perInstallationCap = maxRecordsPerInstallation();
    const alreadyAdmitted = admissions.byInstallation.get(installationId) ?? 0;
    if (alreadyAdmitted + records.length > perInstallationCap) {
      return rejection(
        `per-installation record cap exceeded: ${alreadyAdmitted} already admitted for this installation_id, payload of ${records.length} would exceed ${perInstallationCap}`
      );
    }
    const totalCap = maxTotalRecords();
    if (admissions.total + records.length > totalCap) {
      return rejection(
        `receiver total record cap exceeded: ${admissions.total} already admitted, payload of ${records.length} would exceed ${totalCap}`
      );
    }
    const dir = dataDir3();
    if (!existsSync5(dir)) mkdirSync4(dir, { recursive: true });
    const receivedAt = (/* @__PURE__ */ new Date()).toISOString();
    knownKeys = loadRecordKeys();
    const accepted = 0;
    let deduplicated = 0;
    let quarantined = 0;
    for (const record of records) {
      const key = recordKey(installationId, record);
      if (knownKeys.has(key)) {
        deduplicated += 1;
        continue;
      }
      const quarantineReason = record.tool === "receiver_smoke" ? QUARANTINE_REASON_SMOKE_PROVENANCE : QUARANTINE_REASON_UNTRUSTED_SOURCE;
      appendFileSync3(
        quarantinePath(),
        `${JSON.stringify({
          ...record,
          received_at: receivedAt,
          quarantine_reason: quarantineReason,
          ...schemaVersion === 2 ? {
            client_name: clientName,
            client_version: clientVersion,
            transport,
            runtime_hint: runtimeHint
          } : {}
        })}
`,
        "utf-8"
      );
      appendFileSync3(recordKeysPath(), `${key}
`, "utf-8");
      knownKeys.add(key);
      quarantined += 1;
      quarantinedCount = quarantined;
    }
    const receipt = {
      receivedAt,
      installationId,
      schemaVersion,
      epochVersion,
      accepted,
      deduplicated,
      quarantined
    };
    appendFileSync3(receiptPath(), `${JSON.stringify(receipt)}
`, "utf-8");
    return { ok: true, status: 200, accepted, deduplicated, quarantined };
  } finally {
    if (admissions !== null && quarantinedCount > 0) {
      admissions.total += quarantinedCount;
      admissions.byInstallation.set(
        installationId,
        (admissions.byInstallation.get(installationId) ?? 0) + quarantinedCount
      );
    }
    if (knownKeys !== null) refreshRecordKeysMemo(knownKeys);
    if (admissions !== null) refreshAdmissionsMemo(admissions);
    releaseExclusiveFileLock(admissionLock.lockPath, admissionLock.token);
  }
}

// src/lib/calibration-factors.ts
var MIN_RECORDS_PER_FACTOR = 3;
var MIN_FACTOR = 0.1;
var MAX_FACTOR = 3;
function roundFactor(value) {
  return Math.round(Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, value)) * 100) / 100;
}
function median(values, fallback) {
  if (values.length === 0) return fallback;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? ((values[mid - 1] ?? fallback) + (values[mid] ?? fallback)) / 2 : values[mid] ?? fallback;
}
function validRatios(records) {
  return records.filter((record) => record.estimatedHours > 0 && record.actualHours > 0).map((record) => ({ record, ratio: record.actualHours / record.estimatedHours }));
}
function weightedMedian(items, fallback) {
  const valid = items.filter((item) => item.weight > 0);
  if (valid.length === 0) return fallback;
  const sorted = [...valid].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  const half = total / 2;
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (!item) continue;
    cumulative += item.weight;
    if (cumulative > half) return item.value;
    if (cumulative === half && i + 1 < sorted.length) {
      return (item.value + (sorted[i + 1]?.value ?? item.value)) / 2;
    }
  }
  return sorted[sorted.length - 1]?.value ?? fallback;
}
function ageDaysOf(completedAt, asOfMs) {
  const t = Date.parse(completedAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (asOfMs - t) / 864e5);
}
function exponentialWeight(ageDays, halfLifeDays) {
  if (halfLifeDays <= 0) return 1;
  return Math.pow(2, -ageDays / halfLifeDays);
}
function computeToolTaskCorrectionFactors(records, recency) {
  const grouped = /* @__PURE__ */ new Map();
  for (const pair of validRatios(records)) {
    const tool = pair.record.tool ?? "unknown";
    let taskMap = grouped.get(tool);
    if (!taskMap) {
      taskMap = /* @__PURE__ */ new Map();
      grouped.set(tool, taskMap);
    }
    const arr = taskMap.get(pair.record.taskType) ?? [];
    arr.push(pair);
    taskMap.set(pair.record.taskType, arr);
  }
  const scheme = recency?.scheme ?? { kind: "none" };
  const asOfMs = recency?.asOf !== void 0 ? Date.parse(recency.asOf) : Date.now();
  const minRecords = recency?.minRecords ?? MIN_RECORDS_PER_FACTOR;
  const result = {};
  for (const [tool, taskMap] of grouped) {
    const toolFactors = {};
    for (const [taskType, pairs] of taskMap) {
      if (pairs.length < MIN_RECORDS_PER_FACTOR) continue;
      let factor;
      if (scheme.kind === "none") {
        factor = roundFactor(median(pairs.map((p) => p.ratio), 1.4));
      } else if (scheme.kind === "exponential") {
        const weighted = pairs.map((p) => ({
          value: p.ratio,
          weight: exponentialWeight(ageDaysOf(p.record.completedAt, asOfMs), scheme.halfLifeDays)
        }));
        factor = roundFactor(weightedMedian(weighted, 1.4));
      } else {
        const windowed = pairs.filter((p) => ageDaysOf(p.record.completedAt, asOfMs) <= scheme.windowDays);
        const effective = windowed.length >= minRecords ? windowed : pairs;
        factor = roundFactor(median(effective.map((p) => p.ratio), 1.4));
      }
      toolFactors[taskType] = factor;
    }
    result[tool] = toolFactors;
  }
  return result;
}
var PERT_TOOL = "pert_estimate";
function isPertLearnedCorrectionEnabled() {
  const raw = process.env["EPOCH_PERT_LEARNED_CORRECTION"];
  return raw === "1" || raw === "true";
}
function extractPertEstimatedHours(outputs) {
  if (typeof outputs["expected"] !== "number") return null;
  const expected = outputs["expected"];
  const unit = outputs["unit"];
  if (typeof unit !== "string") return expected;
  switch (unit) {
    case "hours":
      return expected;
    case "days":
      return expected * 8;
    case "weeks":
      return expected * 40;
    case "months":
      return expected * 160;
    default:
      return null;
  }
}
function loadPertMatchedRecords() {
  const merged = loadLedgerWithOverlays();
  const records = [];
  for (const rec of merged) {
    if (rec.tool !== PERT_TOOL) continue;
    if (!rec.actual) continue;
    if (!(rec.actual.actualHours > 0)) continue;
    const estimatedHours = extractPertEstimatedHours(rec.outputs);
    if (estimatedHours === null || !(estimatedHours > 0)) continue;
    const verdict = isExcluded({
      id: rec.id,
      tool: rec.tool,
      inputs: rec.inputs,
      estimatedAt: rec.estimatedAt,
      estimatedHours,
      actual: {
        actualHours: rec.actual.actualHours,
        notes: rec.actual.notes,
        reportedAt: rec.actual.reportedAt,
        completedAt: rec.actual.completedAt,
        calibrationProvenance: rec.actual.calibrationProvenance
      },
      flags: { quarantined: rec.flags.quarantined, orphan: rec.flags.orphan },
      ...rec.expiresAt && { expiresAt: rec.expiresAt }
    });
    if (verdict.excluded) continue;
    const taskType = typeof rec.inputs["task_type"] === "string" ? rec.inputs["task_type"] : "feature";
    const complexity = typeof rec.inputs["complexity"] === "number" ? rec.inputs["complexity"] : void 0;
    records.push({
      taskType,
      estimatedHours,
      actualHours: rec.actual.actualHours,
      tool: rec.tool,
      ...complexity !== void 0 && { complexity },
      completedAt: rec.actual.completedAt ?? rec.actual.reportedAt ?? ""
    });
  }
  return records;
}
var PERT_CORRECTION_RECENCY_DEFAULT = {
  scheme: { kind: "none" }
};
function getPertToolTaskCorrection(taskType, recency = PERT_CORRECTION_RECENCY_DEFAULT) {
  const records = loadPertMatchedRecords();
  const n = records.filter((r) => r.taskType === taskType).length;
  const factors = computeToolTaskCorrectionFactors(records, recency);
  const factor = factors[PERT_TOOL]?.[taskType] ?? 1;
  return { factor, n };
}
function composePertCorrectionFactor(learned, profileFactor) {
  if (learned.n >= MIN_RECORDS_PER_FACTOR) {
    return { factor: learned.factor, n: learned.n, source: "learned" };
  }
  if (profileFactor !== void 0) {
    return { factor: profileFactor, n: learned.n, source: "profile" };
  }
  return {
    factor: 1,
    n: learned.n,
    source: "default",
    note: `Insufficient learned-correction data for this (tool, task_type) pair (n=${learned.n} < ${MIN_RECORDS_PER_FACTOR}) and no developer-profile fallback available; using a neutral correction factor of 1.0.`
  };
}

// src/lib/reference-db-recalculation.ts
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function classifyReceiverRecord(record) {
  if (record.calibration_usage === "exclude" || record.calibration_provenance === "synthetic" || record.calibration_provenance === "smoke" || record.tool === "receiver_smoke") {
    return {
      calibrationProvenance: record.calibration_provenance ?? "smoke",
      calibrationUsage: "exclude",
      legacyReceiverBaseline: false
    };
  }
  if (record.calibration_usage) {
    return {
      calibrationProvenance: record.calibration_provenance ?? "unknown",
      calibrationUsage: record.calibration_usage,
      legacyReceiverBaseline: false
    };
  }
  if (record.calibration_provenance === "prospective") {
    return {
      calibrationProvenance: "prospective",
      calibrationUsage: "correction",
      legacyReceiverBaseline: false
    };
  }
  return {
    calibrationProvenance: record.calibration_provenance ?? "unknown",
    calibrationUsage: "baseline",
    legacyReceiverBaseline: record.calibration_provenance === void 0
  };
}
function receiverToHistorical(record) {
  const classification = classifyReceiverRecord(record);
  if (classification.calibrationUsage === "exclude") {
    return { excluded: true, legacyReceiverBaseline: false };
  }
  if (typeof record.task_type !== "string" || typeof record.tool !== "string" || !isFiniteNumber(record.estimated_hours) || !isFiniteNumber(record.actual_hours) || record.estimated_hours <= 0 || record.actual_hours <= 0) {
    return { excluded: true, legacyReceiverBaseline: false };
  }
  return {
    excluded: false,
    legacyReceiverBaseline: classification.legacyReceiverBaseline,
    record: {
      taskType: record.task_type,
      estimatedHours: record.estimated_hours,
      actualHours: record.actual_hours,
      tool: record.tool,
      ...typeof record.complexity === "number" && { complexity: record.complexity },
      completedAt: record.date,
      calibrationProvenance: classification.calibrationProvenance,
      calibrationUsage: classification.calibrationUsage
    }
  };
}

// src/lib/self-improve.ts
var REFERENCE_DB_PATH = resolveReferenceDbPath();
function resolveReferenceDbPath() {
  const configuredDataDir = process.env["EPOCH_DATA_DIR"];
  if (configuredDataDir) {
    const configuredPath = join6(configuredDataDir, "reference-database.json");
    if (existsSync6(configuredPath)) return configuredPath;
  }
  const userDataPath = join6(homedir5(), ".epoch", "reference-database.json");
  if (existsSync6(userDataPath)) return userDataPath;
  const devPath = join6(
    import.meta.dirname,
    "..",
    "data",
    "reference-database.json"
  );
  if (existsSync6(devPath)) return devPath;
  const distPath = join6(import.meta.dirname, "reference-database.json");
  if (existsSync6(distPath)) return distPath;
  const rootPath = join6(import.meta.dirname, "..", "reference-database.json");
  return rootPath;
}
function getUserDataDir() {
  const dir = process.env["EPOCH_DATA_DIR"] ?? join6(homedir5(), ".epoch");
  if (!existsSync6(dir)) mkdirSync5(dir, { recursive: true });
  return dir;
}
var MIN_CALLS_FOR_UPDATE = 100;
var callCounter = 0;
var lastUpdateAt = 0;
var isUpdating = false;
function notifyToolCall() {
  callCounter++;
  if (callCounter >= MIN_CALLS_FOR_UPDATE && Date.now() - lastUpdateAt > 864e5 && !isUpdating) {
    callCounter = 0;
    lastUpdateAt = Date.now();
    isUpdating = true;
    setImmediate(() => {
      updateReferenceDatabase().catch((err) => {
        debugLog("self-improve.update", err);
      }).finally(() => {
        isUpdating = false;
      });
    });
  }
}
async function updateReferenceDatabase() {
  const db = loadReferenceDb();
  if (!db) return;
  const watermarks = { ...db.mergeWatermarks ?? {} };
  const generatedAt = typeof db.generatedAt === "string" && db.generatedAt.length > 0 ? db.generatedAt : void 0;
  const sinceByTool = {};
  const knownTools = /* @__PURE__ */ new Set([
    ...Object.keys(db.toolExecutionBenchmarks ?? {}),
    ...Object.keys(db.mergeWatermarks ?? {})
  ]);
  for (const tool of knownTools) {
    sinceByTool[tool] = db.mergeWatermarks?.[tool] ?? generatedAt ?? "";
  }
  const telemetry = getTelemetry();
  const allStats = Object.keys(sinceByTool).length > 0 ? telemetry.getStats(void 0, 90, sinceByTool) : telemetry.getStats(void 0, 90);
  for (const stat of allStats) {
    const since = sinceByTool[stat.tool] ?? "";
    const candidate = stat.newestTimestamp ?? since;
    if (candidate > (watermarks[stat.tool] ?? "")) {
      watermarks[stat.tool] = candidate;
    }
    const existing = db.toolExecutionBenchmarks[stat.tool];
    if (existing) {
      const merged = mergeBenchmark(existing, stat);
      db.toolExecutionBenchmarks[stat.tool] = merged;
    } else {
      db.toolExecutionBenchmarks[stat.tool] = {
        p50_ms: stat.p50Ms,
        p95_ms: stat.p95Ms,
        mean_ms: stat.meanMs,
        stddev_ms: 0,
        min_ms: stat.p50Ms,
        max_ms: stat.p95Ms,
        sampleCount: stat.callCount
      };
    }
  }
  for (const tool of knownTools) {
    if (watermarks[tool] === void 0) {
      const bootstrap = sinceByTool[tool];
      if (bootstrap) watermarks[tool] = bootstrap;
    }
  }
  const feedbackRecords = getCalibrationData(void 0, void 0, 180);
  const receivedTelemetryRecords = loadReceivedTelemetryRecords();
  const calibrationRecords = [...feedbackRecords, ...receivedTelemetryRecords];
  if (calibrationRecords.length >= 5) {
    const newFactors = computeCorrectionFactors(calibrationRecords);
    for (const [taskType, factor] of Object.entries(newFactors)) {
      db.taskTypeCorrectionFactors[taskType] = factor;
    }
    db.toolTaskCorrectionFactors = computeToolCorrectionFactors(calibrationRecords);
    db.complexityCorrectionFactors = computeComplexityCorrectionFactors(calibrationRecords);
    db.globalCorrectionFactor = computeGlobalCorrection(calibrationRecords);
  }
  db.sampleSize = Object.values(db.toolExecutionBenchmarks).reduce(
    (sum, bench) => sum + (bench?.sampleCount ?? 0),
    0
  );
  db.mergeWatermarks = watermarks;
  db.generatedAt = (/* @__PURE__ */ new Date()).toISOString();
  db.source = "self-improvement";
  const dataDir4 = getUserDataDir();
  const targetPath = join6(dataDir4, "reference-database.json");
  const tmpPath = join6(dataDir4, "reference-database.json.tmp");
  writeFileSync2(tmpPath, JSON.stringify(db, null, 2), "utf-8");
  renameSync(tmpPath, targetPath);
  invalidateReferenceDbCache();
}
function loadReceivedTelemetryRecords() {
  const path = join6(getUserDataDir(), "telemetry-records.jsonl");
  if (!existsSync6(path)) return [];
  try {
    return readFileSync5(path, "utf-8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter(isReceivedTelemetryRecord).flatMap((record) => {
      const converted = receiverToHistorical(record);
      if (!converted.record) return [];
      const { estimatedHours, actualHours } = converted.record;
      const impliedRatio = actualHours / estimatedHours;
      if (impliedRatio < MIN_RATIO || impliedRatio > MAX_RATIO) return [];
      if (!isRatioConsistent(estimatedHours, actualHours, record.ratio)) return [];
      if (converted.record.calibrationUsage !== "correction") return [];
      return [converted.record];
    });
  } catch {
    return [];
  }
}
function isReceivedTelemetryRecord(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return typeof record["task_type"] === "string" && (typeof record["complexity"] === "number" || record["complexity"] === null) && typeof record["tool"] === "string" && typeof record["estimated_hours"] === "number" && Number.isFinite(record["estimated_hours"]) && record["estimated_hours"] > 0 && typeof record["actual_hours"] === "number" && Number.isFinite(record["actual_hours"]) && record["actual_hours"] > 0 && typeof record["ratio"] === "number" && Number.isFinite(record["ratio"]) && typeof record["date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record["date"]);
}
var _cachedDb;
var _cachedDbAt = 0;
var DB_CACHE_TTL = 6e4;
function loadReferenceDb() {
  if (_cachedDb !== void 0 && Date.now() - _cachedDbAt < DB_CACHE_TTL)
    return _cachedDb;
  try {
    const content = readFileSync5(REFERENCE_DB_PATH, "utf-8");
    _cachedDb = JSON.parse(content);
    _cachedDbAt = Date.now();
    return _cachedDb;
  } catch {
    _cachedDb = null;
    _cachedDbAt = Date.now();
    return null;
  }
}
function invalidateReferenceDbCache() {
  _cachedDb = void 0;
  _cachedDbAt = 0;
}
var _cachedDbPath = REFERENCE_DB_PATH;
function getReferenceDbStatus() {
  const db = loadReferenceDb();
  if (!db) {
    return {
      path: null,
      loaded: false,
      generatedAt: null,
      sampleSize: null,
      source: null,
      globalCorrectionFactor: null,
      taskTypeCorrectionFactorCount: 0,
      toolTaskCorrectionFactorCount: 0,
      complexityCorrectionFactorCount: 0
    };
  }
  return {
    path: _cachedDbPath,
    loaded: true,
    generatedAt: db.generatedAt ?? null,
    sampleSize: db.sampleSize ?? null,
    source: db.source ?? null,
    globalCorrectionFactor: db.globalCorrectionFactor ?? null,
    taskTypeCorrectionFactorCount: Object.keys(
      db.taskTypeCorrectionFactors ?? {}
    ).length,
    toolTaskCorrectionFactorCount: Object.keys(
      db.toolTaskCorrectionFactors ?? {}
    ).length,
    complexityCorrectionFactorCount: Object.keys(
      db.complexityCorrectionFactors ?? {}
    ).length
  };
}
function getTaskTypeCorrectionFactor(taskType) {
  const db = loadReferenceDb();
  if (!db) return 1.8;
  if (db.taskTypeCorrectionFactors?.[taskType]) {
    return db.taskTypeCorrectionFactors[taskType];
  }
  if (db.estimationAccuracy?.correctionFactors?.byTaskType) {
    const canaryKey = mapToCanaryKey2(taskType);
    const factor = db.estimationAccuracy.correctionFactors.byTaskType[canaryKey];
    if (factor) return factor;
  }
  if (db.estimationAccuracy?.taskTypes) {
    const canaryKey = mapToCanaryKey2(taskType);
    const entry = db.estimationAccuracy.taskTypes[canaryKey];
    if (entry?.correctionFactor) return entry.correctionFactor;
  }
  return 1.8;
}
function getToolTaskCorrectionFactor(tool, taskType) {
  const db = loadReferenceDb();
  if (!db?.toolTaskCorrectionFactors)
    return getTaskTypeCorrectionFactor(taskType);
  const toolFactors = db.toolTaskCorrectionFactors[tool];
  if (toolFactors?.[taskType]) return toolFactors[taskType];
  return getTaskTypeCorrectionFactor(taskType);
}
function getComplexityCorrectionFactor(taskType, complexity) {
  const db = loadReferenceDb();
  if (!db?.complexityCorrectionFactors) return null;
  const typeFactors = db.complexityCorrectionFactors[taskType];
  if (typeFactors?.[complexity]) return typeFactors[complexity];
  return null;
}
function mapToCanaryKey2(taskType) {
  const mapping = {
    feature: "pert_estimation",
    bugfix: "calendar_calculation",
    refactor: "cocomo_estimation",
    migration: "cocomo_estimation",
    infrastructure: "token_time_bridge",
    documentation: "other",
    testing: "calibration",
    design: "reference_class"
  };
  return mapping[taskType] ?? taskType;
}
function getGlobalCorrectionFactor() {
  const db = loadReferenceDb();
  return db?.globalCorrectionFactor ?? 1.07;
}
function mergeBenchmark(existing, stat) {
  const totalExisting = existing.sampleCount;
  const totalNew = stat.callCount;
  const total = totalExisting + totalNew;
  const w = totalExisting / total;
  const w2 = totalNew / total;
  return {
    p50_ms: Math.round((existing.p50_ms * w + stat.p50Ms * w2) * 100) / 100,
    p95_ms: Math.round((existing.p95_ms * w + stat.p95Ms * w2) * 100) / 100,
    mean_ms: Math.round((existing.mean_ms * w + stat.meanMs * w2) * 100) / 100,
    stddev_ms: Math.round(
      Math.sqrt(
        existing.stddev_ms ** 2 * w + (stat.p95Ms - stat.p50Ms) ** 2 * w2
      ) * 100
    ) / 100,
    min_ms: Math.round(Math.min(existing.min_ms, stat.p50Ms * 0.5) * 100) / 100,
    max_ms: Math.round(Math.max(existing.max_ms, stat.p95Ms * 1.5) * 100) / 100,
    sampleCount: total
  };
}
function computeCorrectionFactors(records) {
  const grouped = /* @__PURE__ */ new Map();
  for (const r of records) {
    if (r.estimatedHours <= 0 || r.actualHours <= 0) continue;
    const arr = grouped.get(r.taskType) ?? [];
    arr.push(r.actualHours / r.estimatedHours);
    grouped.set(r.taskType, arr);
  }
  const factors = {};
  for (const [type, ratios] of grouped) {
    if (ratios.length < 3) continue;
    ratios.sort((a, b) => a - b);
    const mid = Math.floor(ratios.length / 2);
    const median2 = ratios.length % 2 === 0 ? ((ratios[mid - 1] ?? 0) + (ratios[mid] ?? 0)) / 2 : ratios[mid] ?? 1.8;
    factors[type] = Math.round(Math.min(3, Math.max(0.1, median2)) * 100) / 100;
  }
  return factors;
}
function computeGlobalCorrection(records) {
  if (records.length === 0) return 1.07;
  const valid = records.filter(
    (r) => r.estimatedHours > 0 && r.actualHours > 0
  );
  if (valid.length === 0) return 1.07;
  const ratios = valid.map((r) => r.actualHours / r.estimatedHours);
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const median2 = ratios.length % 2 === 0 ? ((ratios[mid - 1] ?? 0) + (ratios[mid] ?? 0)) / 2 : ratios[mid] ?? 1.07;
  return Math.round(Math.min(3, Math.max(0.1, median2)) * 100) / 100;
}
function computeToolCorrectionFactors(records) {
  const grouped = /* @__PURE__ */ new Map();
  for (const r of records) {
    if (r.estimatedHours <= 0 || r.actualHours <= 0) continue;
    const tool = r.tool ?? "unknown";
    if (!grouped.has(tool)) grouped.set(tool, /* @__PURE__ */ new Map());
    const taskMap = grouped.get(tool);
    const arr = taskMap.get(r.taskType) ?? [];
    arr.push(r.actualHours / r.estimatedHours);
    taskMap.set(r.taskType, arr);
  }
  const result = {};
  for (const [tool, taskMap] of grouped) {
    result[tool] = {};
    for (const [taskType, ratios] of taskMap) {
      if (ratios.length < 3) continue;
      ratios.sort((a, b) => a - b);
      const mid = Math.floor(ratios.length / 2);
      const median2 = ratios.length % 2 === 0 ? ((ratios[mid - 1] ?? 0) + (ratios[mid] ?? 0)) / 2 : ratios[mid] ?? 1.4;
      result[tool][taskType] = Math.round(Math.min(3, Math.max(0.1, median2)) * 100) / 100;
    }
  }
  return result;
}
function computeComplexityCorrectionFactors(records) {
  const grouped = /* @__PURE__ */ new Map();
  for (const r of records) {
    if (r.estimatedHours <= 0 || r.actualHours <= 0) continue;
    if (r.complexity === void 0) continue;
    const taskMap = grouped.get(r.taskType) ?? /* @__PURE__ */ new Map();
    const arr = taskMap.get(r.complexity) ?? [];
    arr.push(r.actualHours / r.estimatedHours);
    taskMap.set(r.complexity, arr);
    grouped.set(r.taskType, taskMap);
  }
  const result = {};
  for (const [taskType, taskMap] of grouped) {
    result[taskType] = {};
    for (const [complexity, ratios] of taskMap) {
      if (ratios.length < 3) continue;
      ratios.sort((a, b) => a - b);
      const mid = Math.floor(ratios.length / 2);
      const median2 = ratios.length % 2 === 0 ? ((ratios[mid - 1] ?? 0) + (ratios[mid] ?? 0)) / 2 : ratios[mid] ?? 1;
      result[taskType][complexity] = Math.round(Math.min(3, Math.max(0.1, median2)) * 100) / 100;
    }
  }
  return result;
}

export {
  assertNever,
  pertEstimate,
  sprintForecast,
  cocomoEstimate,
  criticalPath,
  monteCarloSim,
  getTelemetry,
  resetTelemetry,
  ESTIMATES_FILE,
  ACTUALS_FILE,
  readLines,
  getLedgerCorruptLines,
  getLedgerCacheStatus,
  CURRENT_BASIS_VERSION,
  LEGACY_BASIS_VERSION,
  loadLedgerWithOverlays,
  getLedgerStaleRecoveryCount,
  inspectLedgerWriteLock,
  AUTO_WALLCLOCK_MIN_HOURS,
  AUTO_WALLCLOCK_MAX_HOURS,
  isAutoWallclockSane,
  isExcluded,
  CANONICAL_TOOL_NAMES,
  ESTIMATION_TOOL_NAMES,
  TOOL_COUNT,
  minNForVerdict,
  recordEstimate,
  recordToolCall,
  UNIT_SUSPECT_FLAG_HINT,
  ESTIMATE_UNIT_TO_HOURS,
  recordActual,
  recordActualDetailed,
  getPendingEstimates,
  getCalibrationData,
  extractEstimatedHours,
  batchRecordActuals,
  getFeedbackHealthReport,
  receiveTelemetry,
  isPertLearnedCorrectionEnabled,
  getPertToolTaskCorrection,
  composePertCorrectionFactor,
  notifyToolCall,
  updateReferenceDatabase,
  loadReferenceDb,
  invalidateReferenceDbCache,
  getReferenceDbStatus,
  getTaskTypeCorrectionFactor,
  getToolTaskCorrectionFactor,
  getComplexityCorrectionFactor,
  getGlobalCorrectionFactor,
  getModelPricing,
  getHumanBaselines,
  getEstimationResearch,
  getCocomoDerivedFactors,
  getAllModelPricing,
  getCocomoProjects,
  inferScopeFromComplexity,
  getScopeGuide,
  MODEL_CALIBRATIONS,
  tokenTimeBridge,
  referenceClassEstimate,
  computeAccuracyMetrics,
  calibrateEstimates
};
//# sourceMappingURL=chunk-K22BNBU4.js.map