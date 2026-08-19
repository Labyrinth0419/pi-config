#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const EXPECTED_VERSION = "0.23.0";
const EXPECTED_HASHES = {
  "index.ts": "89fc8d8c8ae644b510f0296130c3234a3d07a7d6f08af37bcc5bd024bacba641",
  "summary-review.ts": "3c27e2670c378bf17cce81709f83781e282a49771e612df10e8ea3bd09769f7f",
};

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function readNormalized(path) {
  return readFileSync(path, "utf8").replaceAll("\r\n", "\n");
}

function replaceOnce(text, oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected one match, found ${count}`);
  }
  return text.replace(oldText, newText);
}

function patchIndex(source) {
  if (source.includes("summaryThinkingLevel") && source.includes("getSummaryThinkingLevel()")) {
    return source;
  }

  source = replaceOnce(
    source,
    'import { StringEnum, complete, type Api, type ImageContent, type Model, type TextContent } from "@earendil-works/pi-ai/compat";',
    'import { StringEnum, complete, type Api, type ImageContent, type Model, type ThinkingLevel, type TextContent } from "@earendil-works/pi-ai/compat";',
    "index import",
  );
  source = replaceOnce(
    source,
    "\tworkflow?: string;\n\tcuratorTimeoutSeconds?: unknown;",
    "\tworkflow?: string;\n\tsummaryThinkingLevel?: ThinkingLevel;\n\tcuratorTimeoutSeconds?: unknown;",
    "index config type",
  );
  source = replaceOnce(
    source,
    `export function getSummaryGenerationDeadlineMs(): number {
\tconst value = loadConfig().summaryGenerationDeadlineMs;
\tif (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
\t\treturn SUMMARY_GENERATION_DEADLINE_MS;
\t}
\treturn Math.min(value, MAX_SUMMARY_GENERATION_DEADLINE_MS);
}
`,
    `export function getSummaryGenerationDeadlineMs(): number {
\tconst value = loadConfig().summaryGenerationDeadlineMs;
\tif (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
\t\treturn SUMMARY_GENERATION_DEADLINE_MS;
\t}
\treturn Math.min(value, MAX_SUMMARY_GENERATION_DEADLINE_MS);
}

function getSummaryThinkingLevel(): ThinkingLevel | undefined {
\tconst value = loadConfig().summaryThinkingLevel;
\treturn value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max"
\t\t? value
\t\t: undefined;
}
`,
    "index thinking-level resolver",
  );
  source = replaceOnce(
    source,
    "\t\t\t\tfeedback,\n\t\t\t\tundefined,\n\t\t\t\tgetSummaryGenerationDeadlineMs(),\n\t\t\t);",
    "\t\t\t\tfeedback,\n\t\t\t\tundefined,\n\t\t\t\tgetSummaryGenerationDeadlineMs(),\n\t\t\t\tgetSummaryThinkingLevel(),\n\t\t\t);",
    "index curator summary call",
  );
  source = replaceOnce(
    source,
    "\t\t\t\t\tundefined,\n\t\t\t\t\tundefined,\n\t\t\t\t\tgetSummaryGenerationDeadlineMs(),\n\t\t\t\t);",
    "\t\t\t\t\tundefined,\n\t\t\t\t\tundefined,\n\t\t\t\t\tgetSummaryGenerationDeadlineMs(),\n\t\t\t\t\tgetSummaryThinkingLevel(),\n\t\t\t\t);",
    "index auto-summary call",
  );
  return source;
}

function patchSummaryReview(source) {
  if (source.includes("const reasoningOptions = thinkingLevel")) {
    return source;
  }

  source = replaceOnce(
    source,
    'import { complete, type Api, type Message, type Model } from "@earendil-works/pi-ai/compat";',
    'import { complete, type Api, type Message, type Model, type ThinkingLevel } from "@earendil-works/pi-ai/compat";',
    "summary-review import",
  );
  source = replaceOnce(
    source,
    "\tcompleteFn?: CompleteFunction,\n\tdeadlineMs = SUMMARY_GENERATION_DEADLINE_MS,\n): Promise<{ summary: string; meta: SummaryMeta }> {",
    "\tcompleteFn?: CompleteFunction,\n\tdeadlineMs = SUMMARY_GENERATION_DEADLINE_MS,\n\tthinkingLevel?: ThinkingLevel,\n): Promise<{ summary: string; meta: SummaryMeta }> {",
    "summary-review function signature",
  );
  source = replaceOnce(
    source,
    "\t\t\t\tconst response = await raceSummaryOperation(Promise.resolve(completeFn(\n\t\t\t\t\tmodel,\n\t\t\t\t\t{ messages: [userMessage] },\n\t\t\t\t\tusesRegistryComplete ? { signal: completionSignal } : { apiKey, headers, signal: completionSignal },\n\t\t\t\t)));",
    "\t\t\t\tconst reasoningOptions = thinkingLevel ? { reasoningEffort: thinkingLevel } : {};\n\t\t\t\tconst response = await raceSummaryOperation(Promise.resolve(completeFn(\n\t\t\t\t\tmodel,\n\t\t\t\t\t{ messages: [userMessage] },\n\t\t\t\t\tusesRegistryComplete\n\t\t\t\t\t\t? { signal: completionSignal, ...reasoningOptions }\n\t\t\t\t\t\t: { apiKey, headers, signal: completionSignal, ...reasoningOptions },\n\t\t\t\t)));",
    "summary-review completion options",
  );
  return source;
}

const packageDir = resolve(process.argv[2] ?? "");
if (!packageDir) {
  throw new Error("Usage: node pi-web-access-patch.mjs <pi-web-access-package-dir>");
}

const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
if (packageJson.version !== EXPECTED_VERSION) {
  throw new Error(`Unsupported pi-web-access version ${packageJson.version}; expected ${EXPECTED_VERSION}`);
}

const paths = {
  index: join(packageDir, "index.ts"),
  summary: join(packageDir, "summary-review.ts"),
};
const before = {
  index: readNormalized(paths.index),
  summary: readNormalized(paths.summary),
};

if (
  sha256(before.index) === EXPECTED_HASHES["index.ts"] &&
  sha256(before.summary) === EXPECTED_HASHES["summary-review.ts"]
) {
  console.log(`pi-web-access ${EXPECTED_VERSION}: summary low-thinking patch already applied`);
  process.exit(0);
}

const after = {
  index: patchIndex(before.index),
  summary: patchSummaryReview(before.summary),
};

writeFileSync(paths.index, after.index, "utf8");
writeFileSync(paths.summary, after.summary, "utf8");

for (const [name, path] of Object.entries(paths)) {
  const actual = sha256(readFileSync(path, "utf8"));
  const expected = EXPECTED_HASHES[name === "index" ? "index.ts" : "summary-review.ts"];
  if (actual !== expected) {
    throw new Error(`${name} patch hash mismatch: ${actual}`);
  }
}

console.log(`pi-web-access ${EXPECTED_VERSION}: summary low-thinking patch applied and verified`);
