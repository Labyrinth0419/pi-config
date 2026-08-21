#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const EXPECTED = {
  piPwsh: {
    version: "0.8.10",
    relativePath: "npm/node_modules/@4fu/pi-pwsh/src/index.ts",
    hash: "624f541f537abc5c152d52f4d54cd191c486ad4c5a56bee9b964cafa33a67695",
  },
  backgroundTasks: {
    version: "2.4.2",
    relativePath: "npm/node_modules/pi-background-tasks/src/extension.ts",
    hash: "9b0973b12fdbcd7c69d710059efaf2cfc32a1455ea7b8b1606255c876e602b6d",
  },
};

const requirePwsh = process.argv.includes("--require-pwsh");

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function readNormalized(path) {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function replaceOnce(source, oldText, newText, label) {
  const count = source.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(oldText, newText);
}

function packageVersion(agentDir, relativePath) {
  const packageDir = relativePath.includes("pi-background-tasks")
    ? join(agentDir, "npm/node_modules/pi-background-tasks")
    : join(agentDir, "npm/node_modules/@4fu/pi-pwsh");
  return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version;
}

function isPwshPatched(source) {
  return source.includes("[PI_TASK_ROUTING_PATCH] Task IDs beginning with ps_")
    && source.includes("Route every ps_XXXXXXXX task ID to pwsh with taskId");
}

function isBackgroundTasksPatched(source) {
  return source.includes("IDs beginning with ps_ belong to @4fu/pi-pwsh and must be queried with pwsh taskId, not bg_logs.")
    && source.includes("If the ID starts with ps_, it belongs to @4fu/pi-pwsh")
    && source.includes("Task ID ${params.taskId} belongs to @4fu/pi-pwsh");
}

function patchPwsh(source) {
  source = replaceOnce(
    source,
    "Task IDs are usable only in the parent session that launched them.",
    "Task IDs are usable only in the parent session that launched them.\n\n[PI_TASK_ROUTING_PATCH] Task IDs beginning with ps_ belong to this PowerShell tool. Inspect or stop them only with pwsh using taskId; never pass ps_ IDs to bg_logs, bg_status, or bg_kill, which belong to pi-background-tasks.",
    "pwsh task description",
  );
  const guideline = source.split("\n").filter((line) => line.startsWith("export const PROMPT_GUIDELINE = "));
  if (guideline.length !== 1) throw new Error(`pwsh prompt guideline: expected one line, found ${guideline.length}`);
  source = source.replace(
    guideline[0],
    `${guideline[0].slice(0, -2)} Route every ps_XXXXXXXX task ID to pwsh with taskId; never send it to bg_logs, bg_status, or bg_kill.";`,
  );
  return source;
}

function patchBackgroundTasks(source) {
  source = replaceOnce(
    source,
    "    description: `Read bounded output from a background task for deliberate inspection; this is not a waiting primitive. Output is capped at ${formatSize(MAX_LOG_BYTES)} for model safety and points to the full output file when truncated.`,",
    "    description: `Read bounded output from a background task for deliberate inspection; this is not a waiting primitive. Output is capped at ${formatSize(MAX_LOG_BYTES)} for model safety and points to the full output file when truncated. [PI_TASK_ROUTING_PATCH] IDs beginning with ps_ belong to @4fu/pi-pwsh and must be queried with pwsh taskId, not bg_logs.`,",
    "bg_logs description",
  );
  source = replaceOnce(
    source,
    "      'Use bg_status first only when a deliberate inspection requires the current task state; do not reconfirm a terminal notification.',",
    "      'Use bg_status first only when a deliberate inspection requires the current task state; do not reconfirm a terminal notification.',\n      'If the ID starts with ps_, it belongs to @4fu/pi-pwsh; use pwsh with taskId instead of bg_logs.',",
    "bg_logs prompt guideline",
  );
  source = replaceOnce(
    source,
    "    parameters: BgLogsParams,\n    async execute(_toolCallId, params) {\n      const task = registry.resolveTask(params.taskId);",
    "    parameters: BgLogsParams,\n    async execute(_toolCallId, params) {\n      if (/^ps_/i.test(params.taskId)) {\n        throw new Error(`Task ID ${params.taskId} belongs to @4fu/pi-pwsh, not pi-background-tasks. Use pwsh with taskId=\\\"${params.taskId}\\\" to inspect it; tasks from another Pi session must be queried from their originating session.`);\n      }\n      const task = registry.resolveTask(params.taskId);",
    "bg_logs ps ID routing error",
  );
  return source;
}

const agentDir = resolve(process.argv[2] ?? "");
if (!agentDir) throw new Error("Usage: node pi-task-routing-patch.mjs <pi-agent-dir> [--require-pwsh]");

const pending = [];
for (const [name, spec] of Object.entries(EXPECTED)) {
  const path = join(agentDir, spec.relativePath);
  let before;
  try {
    before = readNormalized(path);
    const version = packageVersion(agentDir, spec.relativePath);
    if (version !== spec.version) throw new Error(`unsupported ${name} version ${version}; expected ${spec.version}`);
  } catch (error) {
    if (error?.code === "ENOENT" && name === "piPwsh" && !requirePwsh) {
      console.log(`${name}: package not installed; skipped`);
      continue;
    }
    if (error?.code === "ENOENT") throw new Error(`${name}: required package is not installed`);
    throw error;
  }

  if (name === "piPwsh" ? isPwshPatched(before) : isBackgroundTasksPatched(before)) {
    console.log(`${name}: routing patch already applied`);
    continue;
  }
  const beforeHash = sha256(before);
  if (beforeHash !== spec.hash) {
    throw new Error(`unsupported ${name} source hash ${beforeHash}; expected ${spec.hash}`);
  }
  pending.push({ path, content: name === "piPwsh" ? patchPwsh(before) : patchBackgroundTasks(before) });
}

for (const item of pending) {
  const temporary = `${item.path}.${process.pid}.tmp`;
  writeFileSync(temporary, item.content, "utf8");
  renameSync(temporary, item.path);
}
console.log(`task routing patch complete (${pending.length} package${pending.length === 1 ? "" : "s"} patched)`);
