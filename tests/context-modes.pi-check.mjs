import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const packageRoot = process.argv[2];
assert.ok(packageRoot, "Usage: node context-modes.pi-check.mjs <installed-pi-package-root>");
const fromPi = (path) => import(pathToFileURL(resolve(packageRoot, path)).href);
const { createExtensionRuntime, loadExtensions } = await fromPi("dist/core/extensions/loader.js");
const { SessionManager } = await fromPi("dist/core/session-manager.js");
const { AgentSession } = await fromPi("dist/core/agent-session.js");
const { createEventBus } = await fromPi("dist/core/event-bus.js");
const requireFromPi = createRequire(resolve(packageRoot, "package.json"));
const aiCompat = requireFromPi.resolve.paths("@earendil-works/pi-ai")
  .map(directory => join(directory, "@earendil-works/pi-ai/dist/compat.js"))
  .find(path => existsSync(path));
assert.ok(aiCompat, "Cannot find Pi's installed pi-ai/compat.js");
const { clampThinkingLevel } = await import(pathToFileURL(aiCompat).href);
const eventBus = createEventBus();
const extensionPaths = ["burn.ts", "gpt-context-1m.ts", "fast-mode.ts", "slow-mode.ts"]
  .map(name => fileURLToPath(new URL(`../extensions/${name}`, import.meta.url)));

const makeModel = () => ({
  id: "gpt-local-check",
  name: "GPT local check",
  provider: "local-check",
  api: "openai-responses",
  baseUrl: "https://example.invalid/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 16_384,
});

const makeTarget = () => ({
  ...makeModel(), provider: "labyrinth", id: "gpt-6-astra", name: "GPT-6 Astra",
  contextWindow: 272_000, maxTokens: 128_000,
  thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
});

globalThis.fetch = async () => { throw new Error("This local check must not use the network"); };

async function loadSession(sessionManager, model, reason) {
  let currentModel = model;
  let thinking = clampThinkingLevel(model, sessionManager.buildSessionContext().thinkingLevel ?? "medium");
  const target = makeTarget();
  const runtime = createExtensionRuntime();
  runtime.appendEntry = (type, data) => { sessionManager.appendCustomEntry(type, data); };
  const loaded = await loadExtensions(extensionPaths, sessionManager.getCwd(), eventBus, runtime);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 4);
  const statuses = new Map();
  const probe = {
    get model() { return currentModel; },
    sessionManager,
    _limitsModel: () => currentModel,
    settingsManager: {
      getCompactionSettings: () => ({ enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 }),
    },
  };
  const ctx = {
    get model() { return currentModel; },
    sessionManager,
    modelRegistry: { find: (provider, id) => [target, makeModel()].find(item => item.provider === provider && item.id === id) },
    isIdle: () => true,
    waitForIdle: async () => {},
    mode: "tui",
    hasUI: true,
    ui: {
      setStatus: (key, value) => statuses.set(key, value),
      notify: () => {},
      theme: { fg: (_color, value) => value },
    },
    getContextUsage: () => AgentSession.prototype.getContextUsage.call(probe),
  };
  const emit = async (name, event = {}) => {
    let result;
    for (const extension of loaded.extensions) {
      for (const handler of extension.handlers.get(name) ?? []) {
        const value = await handler({ type: name, ...event }, ctx);
        if (value !== undefined) result = value;
      }
    }
    return result;
  };
  const command = async (name, args = "") => {
    const registered = loaded.extensions.map(extension => extension.commands.get(name)).find(Boolean);
    assert.ok(registered, `Pi loader did not register /${name}`);
    await registered.handler(args, ctx);
  };
  runtime.setModel = async (next) => {
    const previousModel = currentModel;
    currentModel = next;
    sessionManager.appendModelChange(next.provider, next.id);
    thinking = clampThinkingLevel(next, thinking);
    if (next.provider !== previousModel.provider || next.id !== previousModel.id) {
      await emit("model_select", { model: next, previousModel, source: "set" });
    }
    return true;
  };
  runtime.getThinkingLevel = () => thinking;
  runtime.setThinkingLevel = (level) => {
    thinking = clampThinkingLevel(currentModel, level);
    sessionManager.appendThinkingLevelChange(thinking);
  };
  await emit("session_start", { reason });
  return {
    ctx, command, emit, statuses,
    get model() { return currentModel; },
    get thinking() { return thinking; },
    shouldCompact: () => AgentSession.prototype._exceedsCompactionThreshold.call(
      probe, currentModel, sessionManager.buildSessionProjection(),
    ),
    async shutdown(reason = "reload") {
      await emit("session_shutdown", { reason });
      runtime.invalidate();
    },
  };
}

const temp = mkdtempSync(join(tmpdir(), "pi-context-modes-"));
try {
  const manager = SessionManager.create(temp, join(temp, "sessions"));
  manager.appendMessage({ role: "user", content: "Local test only", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "Synthetic response; no model call was made." }],
    provider: "local-check",
    model: "gpt-local-check",
    api: "openai-responses",
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 199_000, output: 1_000, cacheRead: 0, cacheWrite: 0, totalTokens: 200_000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  const first = await loadSession(manager, makeModel(), "startup");
  assert.equal(first.shouldCompact(), true);
  for (const arg of ["on", "off", "status"]) {
    await first.command("slow-mode", arg);
    assert.equal(first.statuses.get("slow-mode"), undefined);
  }
  await first.command("slow-mode");
  assert.match(first.statuses.get("slow-mode"), /slow/);
  await first.command("slow-mode", "off");
  assert.match(first.statuses.get("slow-mode"), /slow/);
  await first.command("slow-mode");
  assert.equal(first.statuses.get("slow-mode"), undefined);
  console.log("PASS: /slow-mode toggles and rejects arguments through the real Pi loader");
  await first.command("1M");
  await first.command("fast");
  const enabledLeaf = manager.getLeafId();
  assert.equal(first.ctx.getContextUsage().contextWindow, 1_000_000);
  assert.equal(first.ctx.getContextUsage().percent, 20);
  assert.equal(first.shouldCompact(), false);
  assert.equal(first.model.maxTokens, 16_384);
  assert.equal((await first.emit("before_provider_request", { payload: {} })).service_tier, "priority");
  assert.equal(manager.buildSessionContext().messages.length, 2);
  console.log("PASS: Pi loader registers /1M and /fast; custom state stays out of model context");
  console.log("PASS: Pi context meter and real compaction threshold use 1,000,000 tokens");

  await first.shutdown();
  assert.equal(first.model.contextWindow, 128_000);
  let staleControl;
  eventBus.emit("session-mode:fast:get", { reply: control => { staleControl = control; } });
  assert.equal(staleControl, undefined);
  const reopened = SessionManager.open(manager.getSessionFile());
  const second = await loadSession(reopened, makeModel(), "resume");
  assert.equal(second.model.contextWindow, 1_000_000);
  assert.match(second.statuses.get("fast-tier"), /fast on/);
  assert.equal(second.shouldCompact(), false);
  console.log("PASS: disk-backed session reload restores both switches and original model baseline");

  await second.command("1M");
  await second.command("fast");
  const disabledLeaf = reopened.getLeafId();
  assert.equal(second.model.contextWindow, 128_000);
  assert.equal(second.shouldCompact(), true);
  assert.equal(await second.emit("before_provider_request", { payload: {} }), undefined);
  reopened.branch(enabledLeaf);
  await second.emit("session_tree");
  assert.equal(second.model.contextWindow, 1_000_000);
  assert.match(second.statuses.get("fast-tier"), /fast on/);
  reopened.branch(disabledLeaf);
  await second.emit("session_tree");
  assert.equal(second.model.contextWindow, 128_000);
  assert.equal(second.statuses.get("fast-tier"), undefined);
  console.log("PASS: real session-tree navigation restores branch-local on/off values");
  await second.shutdown("new");

  const third = await loadSession(SessionManager.inMemory(temp), makeModel(), "new");
  assert.equal(third.model.contextWindow, 128_000);
  assert.equal(third.statuses.get("fast-tier"), undefined);
  await third.shutdown("quit");
  console.log("PASS: fresh session stays off; shutdown restores defaults without changing saved state");

  const burnManager = SessionManager.create(temp, join(temp, "burn-sessions"));
  burnManager.appendMessage({ role: "user", content: "Offline burn check", timestamp: Date.now() });
  const burn = await loadSession(burnManager, makeModel(), "startup");
  const originalThinking = burn.thinking;
  await burn.command("burn");
  assert.equal(burn.model.provider, "labyrinth");
  assert.equal(burn.model.id, "gpt-6-astra");
  assert.equal(burn.thinking, "max");
  assert.equal(burn.model.contextWindow, 1_000_000);
  assert.equal(burn.model.maxTokens, 128_000);
  assert.equal(burn.statuses.get("gpt-context-1m"), "📚 GPT 1M");
  assert.match(burn.statuses.get("fast-tier"), /fast on/);
  assert.equal((await burn.emit("before_provider_request", { payload: {} })).service_tier, "priority");
  assert.equal(burnManager.buildSessionContext().messages.length, 1);
  console.log("PASS: /burn uses Pi's event bus and max-level clamping");
  await burn.shutdown();
  assert.equal(burn.model.contextWindow, 272_000);
  const burnReopened = SessionManager.open(burnManager.getSessionFile());
  const saved = burnReopened.buildSessionContext();
  assert.equal(saved.model.provider, "labyrinth");
  assert.equal(saved.model.modelId, "gpt-6-astra");
  assert.equal(saved.thinkingLevel, "max");
  const resumedBurn = await loadSession(burnReopened, makeTarget(), "resume");
  assert.equal(resumedBurn.thinking, "max");
  assert.equal(resumedBurn.model.contextWindow, 1_000_000);
  assert.equal(resumedBurn.statuses.get("gpt-context-1m"), "📚 GPT 1M");
  assert.match(resumedBurn.statuses.get("fast-tier"), /fast on/);
  await resumedBurn.command("burn");
  assert.equal(resumedBurn.model.provider, "local-check");
  assert.equal(resumedBurn.model.id, "gpt-local-check");
  assert.equal(resumedBurn.thinking, originalThinking);
  assert.equal(resumedBurn.model.contextWindow, 128_000);
  assert.equal(resumedBurn.statuses.get("fast-tier"), undefined);
  assert.equal(resumedBurn.statuses.get("burn-mode"), undefined);
  await resumedBurn.shutdown("quit");
  console.log("PASS: all four Burn settings survive disk-backed resume; old event-bus listeners are removed");
  console.log("PASS: /burn toggles off after disk-backed resume and restores its saved baseline");
  console.log("All Pi integration checks passed without model requests.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
