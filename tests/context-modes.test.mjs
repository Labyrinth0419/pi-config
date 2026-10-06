import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { getSessionMode } from "../extensions/lib/session-mode-control.ts";
import contextMode from "../extensions/gpt-context-1m.ts";
import fastMode from "../extensions/fast-mode.ts";
import burnMode from "../extensions/burn.ts";

const CONTEXT_STATE = "gpt-context-1m-state";
const FAST_STATE = "fast-mode-state";

function model(overrides = {}) {
  return {
    id: "gpt-test",
    name: "Test model",
    provider: "test-provider",
    api: "openai-responses",
    baseUrl: "https://example.invalid/v1",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    ...overrides,
  };
}

function state(customType, enabled) {
  return { type: "custom", customType, data: { enabled } };
}

function harness(factories = [contextMode], options = {}) {
  let currentModel = Object.hasOwn(options, "model") ? options.model : model();
  let branch = [...(options.branch ?? [])];
  const handlers = new Map();
  const commands = new Map();
  const flags = new Map();
  const statuses = new Map();
  const notifications = [];
  const appended = [];
  const calls = [];
  let thinking = options.thinking ?? "medium";
  let idle = options.idle !== false;
  const target = model({
    provider: "labyrinth", id: "gpt-6-astra", name: "GPT-6 Astra",
    contextWindow: 272_000, maxTokens: 128_000,
  });
  const models = options.models ?? [target];
  if (currentModel && !models.some(item => item.provider === currentModel.provider && item.id === currentModel.id)) {
    models.push(currentModel);
  }
  const events = new EventEmitter();
  const pi = {
    events: {
      emit: (channel, data) => { events.emit(channel, data); },
      on: (channel, handler) => {
        events.on(channel, handler);
        return () => { events.off(channel, handler); };
      },
    },
    on(name, handler) {
      const registered = handlers.get(name) ?? [];
      registered.push(handler);
      handlers.set(name, registered);
    },
    registerCommand(name, command) {
      assert.ok(!commands.has(name), `duplicate command: ${name}`);
      commands.set(name, command);
    },
    registerFlag(name, config) {
      flags.set(name, options.flags?.[name] ?? config.default);
    },
    getFlag(name) {
      return flags.get(name);
    },
    async setModel(next) {
      calls.push(`model:${next.provider}/${next.id}`);
      if (options.setModel) {
        const accepted = await options.setModel(next);
        if (accepted === false) return false;
      }
      if (options.auth === false && next.provider === "labyrinth") return false;
      const previousModel = currentModel;
      currentModel = next;
      branch.push({ type: "model_change", provider: next.provider, modelId: next.id });
      thinking = "medium";
      if (previousModel?.provider !== next.provider || previousModel?.id !== next.id) {
        await emit("model_select", { model: next, previousModel, source: "set" });
      }
      return true;
    },
    getThinkingLevel: () => thinking,
    setThinkingLevel(level) {
      calls.push(`thinking:${level}`);
      thinking = options.clampMax && level === "max" ? "high" : level;
      branch.push({ type: "thinking_level_change", thinkingLevel: thinking });
    },
    appendEntry(customType, data) {
      const entry = { type: "custom", customType, data: structuredClone(data) };
      branch.push(entry);
      appended.push(entry);
    },
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    get model() {
      return currentModel;
    },
    modelRegistry: {
      find: (provider, id) => models.find(item => item.provider === provider && item.id === id),
    },
    isIdle: () => idle,
    async waitForIdle() {
      calls.push("waitForIdle");
      await options.waitForIdle?.();
      idle = true;
    },
    sessionManager: {
      getBranch: () => [...branch],
      getEntries: () => assert.fail("State must come from the active branch, not abandoned branches"),
    },
    ui: {
      setStatus: (key, value) => statuses.set(key, value),
      notify: (message, level) => notifications.push({ message, level }),
      theme: { fg: (_color, value) => value },
    },
    getContextUsage: () => ({ tokens: options.tokens ?? 0, contextWindow: currentModel?.contextWindow }),
  };
  const emit = async (name, event = {}) => {
    let result;
    for (const handler of handlers.get(name) ?? []) {
      const next = await handler({ type: name, ...event }, ctx);
      if (next !== undefined) result = next;
    }
    return result;
  };
  for (const factory of factories) factory(pi);
  return {
    ctx, pi, commands, statuses, notifications, appended, calls, emit,
    get thinking() { return thinking; },
    branch: () => [...branch],
    setBranch: (entries) => { branch = [...entries]; },
    setModel: (next) => { currentModel = next; },
    async command(name, args = "") {
      assert.ok(commands.has(name), `missing command: ${name}`);
      return commands.get(name).handler(args, ctx);
    },
  };
}

test("burn: selects the exact target with max, fast and icon-bearing 1M in any load order", async () => {
  for (const factories of [[burnMode, contextMode, fastMode], [fastMode, contextMode, burnMode]]) {
    const h = harness(factories);
    await h.emit("session_start");
    await h.command("burn");
    assert.equal(h.ctx.model.provider, "labyrinth");
    assert.equal(h.ctx.model.id, "gpt-6-astra");
    assert.equal(h.thinking, "max");
    assert.equal(h.ctx.model.contextWindow, 1_000_000);
    assert.equal(h.ctx.model.maxTokens, 128_000);
    assert.equal(h.statuses.get("gpt-context-1m"), "📚 GPT 1M");
    assert.match(h.statuses.get("fast-tier"), /fast on/);
    assert.equal((await h.emit("before_provider_request", { payload: {} })).service_tier, "priority");
    assert.match(h.notifications.at(-1).message, /已开启 Burn/);
    assert.deepEqual(h.appended.slice(-3, -1), [state(FAST_STATE, true), state(CONTEXT_STATE, true)]);
    assert.ok(h.branch().some(entry => entry.type === "model_change" && entry.modelId === "gpt-6-astra"));
    assert.ok(h.branch().some(entry => entry.type === "thinking_level_change" && entry.thinkingLevel === "max"));
    await h.command("1M");
    assert.equal(h.ctx.model.contextWindow, 272_000);
  }
});

test("burn: repeated calls toggle and restore all combinations of prior modes", async () => {
  for (const fast of [false, true]) for (const context of [false, true]) {
    const h = harness([burnMode, fastMode, contextMode], { thinking: "high" });
    await h.emit("session_start");
    if (fast) await h.command("fast");
    if (context) await h.command("1M");
    const original = h.ctx.model;
    await h.command("burn");
    assert.equal(h.statuses.get("burn-mode"), "🔥 Burn");
    await h.command("burn");
    assert.equal(h.ctx.model, original);
    assert.equal(h.thinking, "high");
    assert.equal(getSessionMode(h.pi, "fast").isEnabled(), fast);
    assert.equal(getSessionMode(h.pi, "gpt-context-1m").isEnabled(), context);
    assert.equal(original.contextWindow, context ? 1_000_000 : 128_000);
    assert.equal(h.statuses.get("burn-mode"), undefined);
    assert.deepEqual(h.appended.at(-1), state("burn-mode-state", false));
    await h.command("burn");
    assert.equal(h.thinking, "max");
    await h.command("burn");
    assert.equal(h.ctx.model, original);
  }
});

test("burn: a missing target or a target on another provider causes no changes", async () => {
  for (const models of [[], [model({ provider: "other", id: "gpt-6-astra" })]]) {
    const h = harness([burnMode, fastMode, contextMode], { models });
    await h.emit("session_start");
    const original = structuredClone(h.ctx.model);
    const count = h.appended.length;
    await h.command("burn");
    assert.deepEqual(h.ctx.model, original);
    assert.equal(h.thinking, "medium");
    assert.equal(h.appended.length, count);
    assert.deepEqual(h.calls, []);
    assert.match(h.notifications.at(-1).message, /未找到 labyrinth\/gpt-6-astra/);
  }
});

test("burn: missing mode extensions are detected before model selection", async () => {
  for (const factories of [[burnMode], [burnMode, fastMode], [burnMode, contextMode]]) {
    const h = harness(factories);
    await h.emit("session_start");
    const original = structuredClone(h.ctx.model);
    const count = h.appended.length;
    await h.command("burn");
    assert.deepEqual(h.ctx.model, original);
    assert.deepEqual(h.calls, []);
    assert.equal(h.appended.length, count);
    assert.match(h.notifications.at(-1).message, /需要 fast-mode 和 gpt-context-1m/);
  }
});

test("burn: failed authentication preserves the previous enabled modes and model", async () => {
  const h = harness([burnMode, fastMode, contextMode], { auth: false, thinking: "high" });
  await h.emit("session_start");
  await h.command("fast");
  await h.command("1M");
  const original = h.ctx.model;
  const count = h.appended.length;
  await h.command("burn");
  assert.equal(h.ctx.model, original);
  assert.equal(h.ctx.model.contextWindow, 1_000_000);
  assert.equal(h.thinking, "high");
  assert.equal(h.appended.length, count);
  assert.match(h.notifications.at(-1).message, /认证/);
});

test("burn: a clamped max level is rejected and the old configuration is restored", async () => {
  const h = harness([burnMode, fastMode, contextMode], { clampMax: true, thinking: "high" });
  await h.emit("session_start");
  const original = h.ctx.model;
  await h.command("burn");
  assert.equal(h.ctx.model, original);
  assert.equal(h.thinking, "high");
  assert.equal(h.ctx.model.contextWindow, 128_000);
  assert.equal(getSessionMode(h.pi, "fast").isEnabled(), false);
  assert.equal(getSessionMode(h.pi, "gpt-context-1m").isEnabled(), false);
  assert.match(h.notifications.at(-1).message, /max.*已恢复之前的配置/);
});

test("burn: a failed mode write rolls back partial state without logging the raw error", async () => {
  for (const failedState of [FAST_STATE, CONTEXT_STATE]) {
    const h = harness([burnMode, fastMode, contextMode], { thinking: "high" });
    await h.emit("session_start");
    const original = h.ctx.model;
    const append = h.pi.appendEntry;
    h.pi.appendEntry = (type, data) => {
      if (type === failedState && data.enabled) throw new Error("do-not-print-this-detail");
      append(type, data);
    };
    await h.command("burn");
    assert.equal(h.ctx.model, original);
    assert.equal(h.thinking, "high");
    assert.equal(h.ctx.model.contextWindow, 128_000);
    assert.equal(getSessionMode(h.pi, "fast").isEnabled(), false);
    assert.equal(getSessionMode(h.pi, "gpt-context-1m").isEnabled(), false);
    assert.match(h.notifications.at(-1).message, /已恢复之前的配置/);
    assert.ok(h.notifications.every(item => !item.message.includes("do-not-print-this-detail")));
    assert.ok(h.notifications.every(item => !item.message.includes("已开启 Burn")));
  }
});

test("burn: rollback retains modes that were already enabled before the command", async () => {
  const h = harness([burnMode, fastMode, contextMode], { thinking: "high" });
  await h.emit("session_start");
  await h.command("fast");
  await h.command("1M");
  const original = h.ctx.model;
  const append = h.pi.appendEntry;
  h.pi.appendEntry = (type, data) => {
    if (type === CONTEXT_STATE && data.enabled) throw new Error("synthetic persistence failure");
    append(type, data);
  };
  await h.command("burn");
  assert.equal(h.ctx.model, original);
  assert.equal(h.ctx.model.contextWindow, 1_000_000);
  assert.equal(h.thinking, "high");
  assert.equal(getSessionMode(h.pi, "fast").isEnabled(), true);
  assert.equal(getSessionMode(h.pi, "gpt-context-1m").isEnabled(), true);
  assert.match(h.notifications.at(-1).message, /已恢复之前的配置/);
});

test("burn: incomplete rollback is explicitly reported rather than claiming success", async () => {
  const h = harness([burnMode, fastMode, contextMode], {
    clampMax: true,
    setModel: next => next.provider === "labyrinth",
  });
  await h.emit("session_start");
  await h.command("burn");
  assert.equal(h.ctx.model.provider, "labyrinth");
  assert.equal(h.notifications.at(-1).level, "error");
  assert.match(h.notifications.at(-1).message, /未能完全恢复/);
  assert.ok(h.notifications.every(item => !item.message.includes("已开启 Burn")));
});

test("burn: waits for idle and rejects an overlapping command", async () => {
  let release;
  const idle = new Promise(resolve => { release = resolve; });
  const h = harness([burnMode, fastMode, contextMode], { idle: false, waitForIdle: () => idle });
  await h.emit("session_start");
  const original = h.ctx.model;
  const pending = h.command("burn");
  await h.command("burn");
  assert.equal(h.ctx.model, original);
  assert.deepEqual(h.calls, ["waitForIdle"]);
  assert.match(h.notifications.at(-1).message, /正在切换/);
  release();
  await pending;
  assert.equal(h.ctx.model.id, "gpt-6-astra");
  assert.equal(h.thinking, "max");
});

test("burn: invalid arguments make no changes", async () => {
  const h = harness([burnMode, fastMode, contextMode]);
  await h.emit("session_start");
  const count = h.appended.length;
  await h.command("burn", "off");
  assert.deepEqual(h.calls, []);
  assert.equal(h.appended.length, count);
  assert.equal(h.notifications.at(-1).level, "error");
  assert.match(h.notifications.at(-1).message, /用法/);
});

test("burn: saved switches restore on resume while a fresh session stays off", async () => {
  const factories = [burnMode, fastMode, contextMode];
  const h = harness(factories);
  await h.emit("session_start");
  await h.command("burn");
  await h.emit("session_shutdown", { reason: "reload" });
  assert.equal(h.ctx.model.contextWindow, 272_000);
  const resumed = harness(factories, { model: h.ctx.model, branch: h.branch(), thinking: h.thinking });
  await resumed.emit("session_start", { reason: "resume" });
  assert.equal(resumed.ctx.model.id, "gpt-6-astra");
  assert.equal(resumed.thinking, "max");
  assert.equal(resumed.ctx.model.contextWindow, 1_000_000);
  assert.match(resumed.statuses.get("fast-tier"), /fast on/);
  const fresh = harness(factories);
  await fresh.emit("session_start", { reason: "new" });
  assert.equal(fresh.ctx.model.contextWindow, 128_000);
  assert.equal(fresh.statuses.get("fast-tier"), undefined);
});

test("burn: resume, fork and tree navigation retain the original baseline", async () => {
  const factories = [burnMode, fastMode, contextMode];
  const original = model();
  const catalog = [model({ provider: "labyrinth", id: "gpt-6-astra", contextWindow: 272_000 }), original];
  const h = harness(factories, { model: original, models: catalog, thinking: "low" });
  await h.emit("session_start");
  await h.command("fast");
  const offBranch = h.branch();
  await h.command("burn");
  const onBranch = h.branch();
  await h.emit("session_shutdown");
  const resumed = harness(factories, { model: h.ctx.model, models: catalog, branch: onBranch, thinking: "max" });
  await resumed.emit("session_start");
  assert.equal(resumed.statuses.get("burn-mode"), "🔥 Burn");
  await resumed.command("burn");
  assert.equal(resumed.ctx.model, original);
  assert.equal(resumed.thinking, "low");
  assert.equal(getSessionMode(resumed.pi, "fast").isEnabled(), true);
  assert.equal(getSessionMode(resumed.pi, "gpt-context-1m").isEnabled(), false);
  resumed.setBranch(onBranch);
  resumed.setModel(catalog[0]);
  await resumed.emit("session_tree");
  assert.equal(resumed.statuses.get("burn-mode"), "🔥 Burn");
  await resumed.command("burn");
  assert.equal(resumed.ctx.model, original);
  assert.equal(resumed.thinking, "low");
  resumed.setBranch(offBranch);
  await resumed.emit("session_tree");
  assert.equal(resumed.statuses.get("burn-mode"), undefined);
  const fork = harness(factories, { model: catalog[0], models: catalog, branch: onBranch });
  await fork.emit("session_start", { reason: "fork" });
  await fork.command("burn");
  assert.equal(fork.ctx.model, original);
  assert.equal(fork.thinking, "low");
});

test("burn: disabling overrides manual changes with the saved baseline", async () => {
  const h = harness([burnMode, fastMode, contextMode], { thinking: "high" });
  await h.emit("session_start");
  const original = h.ctx.model;
  await h.command("burn");
  await h.command("fast");
  await h.command("1M");
  h.setModel(model({ provider: "other", id: "qwen", name: "Qwen" }));
  await h.emit("model_select");
  h.pi.setThinkingLevel("low");
  await h.command("burn");
  assert.equal(h.ctx.model, original);
  assert.equal(h.thinking, "high");
  assert.equal(getSessionMode(h.pi, "fast").isEnabled(), false);
  assert.equal(getSessionMode(h.pi, "gpt-context-1m").isEnabled(), false);
});

test("burn: failed state persistence rolls back both activation and deactivation", async () => {
  for (const disabling of [false, true]) {
    const h = harness([burnMode, fastMode, contextMode]);
    await h.emit("session_start");
    const original = h.ctx.model;
    if (disabling) await h.command("burn");
    const current = h.ctx.model;
    const thinking = h.thinking;
    const append = h.pi.appendEntry;
    h.pi.appendEntry = (type, data) => {
      if (type === "burn-mode-state") throw new Error("sensitive-error-detail");
      append(type, data);
    };
    await h.command("burn");
    assert.equal(h.ctx.model, current);
    assert.equal(h.thinking, thinking);
    assert.equal(getSessionMode(h.pi, "fast").isEnabled(), disabling);
    assert.equal(getSessionMode(h.pi, "gpt-context-1m").isEnabled(), disabling);
    assert.equal(h.statuses.get("burn-mode"), disabling ? "🔥 Burn" : undefined);
    assert.match(h.notifications.at(-1).message, /保存 Burn 状态失败.*已恢复之前的配置/);
    assert.ok(h.notifications.every(item => !item.message.includes("sensitive-error-detail")));
    h.pi.appendEntry = append;
    await h.command("burn");
    assert.equal(h.statuses.get("burn-mode"), disabling ? undefined : "🔥 Burn");
    if (disabling) assert.equal(h.ctx.model, original);
  }
});

test("burn: missing or unauthorized baseline preserves active state and permits retry", async () => {
  for (const missing of [false, true]) {
    let deny = false;
    const original = model();
    const catalog = [original, model({ provider: "labyrinth", id: "gpt-6-astra", contextWindow: 272_000 })];
    const h = harness([burnMode, fastMode, contextMode], {
      model: original, models: catalog, setModel: next => !(deny && next.provider === original.provider),
    });
    await h.emit("session_start");
    await h.command("burn");
    if (missing) catalog.splice(0, 1);
    else deny = true;
    const count = h.appended.length;
    await h.command("burn");
    assert.equal(h.ctx.model.provider, "labyrinth");
    assert.equal(h.thinking, "max");
    assert.equal(h.appended.length, count);
    assert.equal(h.statuses.get("burn-mode"), "🔥 Burn");
    assert.equal(h.notifications.at(-1).level, "error");
    if (missing) catalog.push(original);
    else deny = false;
    await h.command("burn");
    assert.equal(h.ctx.model, original);
    assert.equal(h.statuses.get("burn-mode"), undefined);
  }
});

test("burn: missing current model is rejected before mutation", async () => {
  const h = harness([burnMode, fastMode, contextMode], { model: undefined });
  await h.emit("session_start");
  const count = h.appended.length;
  await h.command("burn");
  assert.equal(h.ctx.model, undefined);
  assert.deepEqual(h.calls, []);
  assert.equal(h.appended.length, count);
  assert.equal(h.notifications.at(-1).level, "error");
});

test("mode controls: discovery is read-only and setters reuse persisted state", async () => {
  const h = harness([contextMode, fastMode]);
  await h.emit("session_start");
  const count = h.appended.length;
  const context = getSessionMode(h.pi, "gpt-context-1m");
  const fast = getSessionMode(h.pi, "fast");
  assert.equal(context.isEnabled(), false);
  assert.equal(fast.isEnabled(), false);
  assert.equal(h.appended.length, count);
  context.setEnabled(true, h.ctx);
  fast.setEnabled(true, h.ctx);
  assert.equal(h.statuses.get("gpt-context-1m"), "📚 GPT 1M");
  assert.equal(h.ctx.model.contextWindow, 1_000_000);
  assert.equal(context.isEnabled(), true);
  assert.equal(fast.isEnabled(), true);
  assert.deepEqual(h.appended.slice(-2), [state(CONTEXT_STATE, true), state(FAST_STATE, true)]);
  h.pi.events.emit("session-mode:fast:get", null);
  h.pi.events.emit("session-mode:fast:get", { reply: false });
  assert.equal(getSessionMode(harness().pi, "fast"), undefined);
});

test("mode controls: persistence errors reach the caller without changing state", async () => {
  const h = harness([contextMode, fastMode]);
  await h.emit("session_start");
  h.pi.appendEntry = () => { throw new Error("synthetic write failure"); };
  for (const name of ["fast", "gpt-context-1m"]) {
    const control = getSessionMode(h.pi, name);
    assert.throws(() => control.setEnabled(true, h.ctx), /write failure/);
    assert.equal(control.isEnabled(), false);
  }
  assert.equal(h.ctx.model.contextWindow, 128_000);
});

test("1M: fresh session starts off without changing the model", async () => {
  const h = harness();
  const original = structuredClone(h.ctx.model);
  await h.emit("session_start", { reason: "startup" });
  assert.deepEqual(h.ctx.model, original);
  assert.equal(h.appended.length, 0);
  assert.equal(h.statuses.get("gpt-context-1m"), undefined);
});

test("1M: matches name or ID case-insensitively, not provider name", async () => {
  const cases = [
    ["vendor/GpT-test", "Custom", "provider", true],
    ["alias", "ChatGPT", "provider", true],
    ["alias", "GPT custom", "provider", true],
    ["gpt-test", undefined, "provider", true],
    ["claude-test", "Claude", "gpt-provider", false],
    ["qwen-test", "Qwen", "provider", false],
  ];
  for (const [id, name, provider, matches] of cases) {
    const h = harness([contextMode], { model: model({ id, name, provider }) });
    const original = structuredClone(h.ctx.model);
    await h.emit("session_start");
    await h.command("1M");
    assert.deepEqual(h.ctx.model, { ...original, contextWindow: matches ? 1_000_000 : original.contextWindow });
    await h.command("1M");
    assert.deepEqual(h.ctx.model, original);
  }
});

test("1M: consecutive bare commands toggle and restore each exact original limit", async () => {
  for (const contextWindow of [128_000, 1_000_000, 1_048_576, 2_000_000]) {
    const h = harness([contextMode], { model: model({ contextWindow }) });
    const original = structuredClone(h.ctx.model);
    await h.emit("session_start");
    for (let cycle = 0; cycle < 2; cycle++) {
      await h.command("1M");
      assert.equal(h.ctx.model.contextWindow, 1_000_000);
      assert.equal(h.statuses.get("gpt-context-1m"), "📚 GPT 1M");
      assert.equal(h.ctx.model.maxTokens, original.maxTokens);
      await h.command("1M");
      assert.deepEqual(h.ctx.model, original);
      assert.equal(h.statuses.get("gpt-context-1m"), undefined);
      assert.deepEqual(h.appended.at(-1), state(CONTEXT_STATE, false));
    }
  }
});

test("1M: model switches restore the old object and apply to the next GPT", async () => {
  const first = model();
  const second = model({ id: "alias", name: "GPT second", contextWindow: 272_000 });
  const other = model({ id: "claude", name: "Claude", contextWindow: 200_000 });
  const h = harness([contextMode], { model: first });
  await h.emit("session_start");
  await h.command("1M");
  h.setModel(other);
  await h.emit("model_select", { model: other, previousModel: first });
  assert.equal(first.contextWindow, 128_000);
  assert.equal(other.contextWindow, 200_000);
  assert.match(h.statuses.get("gpt-context-1m"), /GPT only/);
  h.setModel(second);
  await h.emit("model_select", { model: second, previousModel: other });
  assert.equal(second.contextWindow, 1_000_000);
  await h.command("1M");
  assert.equal(second.contextWindow, 272_000);
});

test("1M: enabling on a non-GPT model remains armed for the next GPT", async () => {
  const h = harness([contextMode], { model: model({ id: "qwen", name: "Qwen" }) });
  await h.emit("session_start");
  await h.command("1M");
  assert.equal(h.ctx.model.contextWindow, 128_000);
  h.setModel(model({ contextWindow: 400_000 }));
  await h.emit("model_select");
  assert.equal(h.ctx.model.contextWindow, 1_000_000);
});

test("1M: shutdown restores defaults; reload retains state without losing the baseline", async () => {
  const current = model();
  const h = harness([contextMode], { model: current });
  await h.emit("session_start");
  await h.command("1M");
  await h.emit("session_shutdown", { reason: "reload" });
  assert.equal(current.contextWindow, 128_000);
  assert.equal(h.statuses.get("gpt-context-1m"), undefined);
  assert.equal(h.branch().at(-1).data.enabled, true);
  const reloaded = harness([contextMode], { model: current, branch: h.branch() });
  await reloaded.emit("session_start", { reason: "reload" });
  assert.equal(current.contextWindow, 1_000_000);
  await reloaded.command("1M");
  assert.equal(current.contextWindow, 128_000);
  await reloaded.emit("session_shutdown", { reason: "quit" });
  await reloaded.emit("session_shutdown", { reason: "quit" });
  assert.equal(current.contextWindow, 128_000);
});

test("1M: resume uses the latest valid branch entry and ignores malformed state", async () => {
  const branch = [
    state(CONTEXT_STATE, true),
    state(CONTEXT_STATE, false),
    state("unrelated-state", true),
    state(CONTEXT_STATE, "yes"),
    { type: "custom", customType: CONTEXT_STATE, data: null },
    { type: "custom", customType: CONTEXT_STATE, data: [] },
  ];
  const h = harness([contextMode], { branch });
  await h.emit("session_start", { reason: "resume" });
  assert.equal(h.ctx.model.contextWindow, 128_000);
  h.setBranch([...branch, state(CONTEXT_STATE, true)]);
  await h.emit("session_start", { reason: "resume" });
  assert.equal(h.ctx.model.contextWindow, 1_000_000);
  assert.equal(h.appended.length, 0);
});

test("1M: tree navigation restores branch state; a new session does not inherit it", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.command("1M");
  const enabledBranch = h.branch();
  await h.command("1M");
  h.setBranch(enabledBranch);
  await h.emit("session_tree");
  assert.equal(h.ctx.model.contextWindow, 1_000_000);
  h.setBranch([]);
  await h.emit("session_tree");
  assert.equal(h.ctx.model.contextWindow, 128_000);
  await h.command("1M");
  await h.emit("session_shutdown", { reason: "new" });
  h.setBranch([]);
  await h.emit("session_start", { reason: "new" });
  assert.equal(h.ctx.model.contextWindow, 128_000);
});

test("1M: fork inherits only entries present at the fork point", async () => {
  const enabled = harness([contextMode], { branch: [state(CONTEXT_STATE, true)] });
  await enabled.emit("session_start", { reason: "fork" });
  assert.equal(enabled.ctx.model.contextWindow, 1_000_000);
  const earlier = harness([contextMode], { branch: [] });
  await earlier.emit("session_start", { reason: "fork" });
  assert.equal(earlier.ctx.model.contextWindow, 128_000);
});

test("1M: same-ID replacements are covered before compaction and agent startup", async () => {
  const h = harness();
  const first = h.ctx.model;
  await h.emit("session_start");
  await h.command("1M");
  const refreshed = model({ contextWindow: 256_000 });
  h.setModel(refreshed);
  assert.equal(await h.emit("input"), undefined);
  assert.equal(first.contextWindow, 128_000);
  assert.equal(refreshed.contextWindow, 1_000_000);
  const replacedAgain = model({ contextWindow: 512_000 });
  h.setModel(replacedAgain);
  await h.emit("before_agent_start");
  assert.equal(refreshed.contextWindow, 256_000);
  assert.equal(replacedAgain.contextWindow, 1_000_000);
  await h.command("1M");
  assert.equal(replacedAgain.contextWindow, 512_000);
});

test("1M: does not clobber a newer override from another extension", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.command("1M");
  h.ctx.model.contextWindow = 300_000;
  await h.command("1M");
  assert.equal(h.ctx.model.contextWindow, 300_000);
  await h.command("1M");
  h.ctx.model.contextWindow = 500_000;
  await h.emit("input");
  assert.equal(h.ctx.model.contextWindow, 1_000_000);
  await h.command("1M");
  assert.equal(h.ctx.model.contextWindow, 500_000);
});

test("both modes: reject all arguments without mutating either off or on state", async () => {
  for (const name of ["1M", "fast"]) {
    const h = harness([contextMode, fastMode]);
    await h.emit("session_start");
    assert.equal(h.commands.get(name).getArgumentCompletions, undefined);
    for (const active of [false, true]) {
      if (active) await h.command(name);
      const count = h.appended.length;
      const original = structuredClone(h.ctx.model);
      const statuses = new Map(h.statuses);
      for (const arg of ["on", "off", "status", "ON", "toggle", "on off"]) {
        await h.command(name, arg);
        assert.equal(h.notifications.at(-1).level, "error");
        assert.equal(h.appended.length, count);
        assert.deepEqual(h.ctx.model, original);
        assert.deepEqual(h.statuses, statuses);
      }
    }
  }
});

test("1M: supports missing models and warns about oversized context on disable", async () => {
  const missing = harness([contextMode], { model: undefined });
  await missing.emit("session_start");
  await missing.command("1M");
  await missing.command("1M");
  assert.equal(missing.ctx.model, undefined);
  const h = harness([contextMode], { tokens: 200_000 });
  await h.emit("session_start");
  await h.command("1M");
  await h.command("1M");
  assert.equal(h.notifications.at(-1).level, "warning");
  assert.match(h.notifications.at(-1).message, /\/compact/);
});

test("fast: fresh session pins the default off state without changing requests", async () => {
  const h = harness([fastMode]);
  await h.emit("session_start", { reason: "startup" });
  assert.deepEqual(h.appended, [state(FAST_STATE, false)]);
  assert.equal(h.statuses.get("fast-tier"), undefined);
  const payload = { model: "gpt-test", service_tier: "auto" };
  assert.equal(await h.emit("before_provider_request", { payload }), undefined);
  assert.equal(payload.service_tier, "auto");
});

test("fast: bare command toggles and persists on and off", async () => {
  const h = harness([fastMode]);
  await h.emit("session_start");
  for (let cycle = 0; cycle < 2; cycle++) {
    await h.command("fast", "  ");
    assert.match(h.statuses.get("fast-tier"), /fast on/);
    assert.deepEqual(h.appended.at(-1), state(FAST_STATE, true));
    await h.command("fast");
    assert.equal(h.statuses.get("fast-tier"), undefined);
    assert.deepEqual(h.appended.at(-1), state(FAST_STATE, false));
  }
});

test("fast: reload and resume retain both on and off without matching startup flags", async () => {
  const h = harness([fastMode]);
  await h.emit("session_start");
  await h.command("fast");
  await h.emit("session_shutdown", { reason: "reload" });
  assert.equal(h.statuses.get("fast-tier"), undefined);
  const reloaded = harness([fastMode], { branch: h.branch() });
  await reloaded.emit("session_start", { reason: "reload" });
  assert.match(reloaded.statuses.get("fast-tier"), /fast on/);
  assert.equal(reloaded.appended.length, 0);
  await reloaded.command("fast");
  const resumed = harness([fastMode], { branch: reloaded.branch(), flags: { fast: true } });
  await resumed.emit("session_start", { reason: "resume" });
  assert.equal(resumed.statuses.get("fast-tier"), undefined);
  assert.equal(resumed.appended.length, 0);
});

test("fast: --fast initializes new sessions and is remembered after restart", async () => {
  const h = harness([fastMode], { flags: { fast: true } });
  await h.emit("session_start");
  assert.match(h.statuses.get("fast-tier"), /fast on/);
  assert.deepEqual(h.appended, [state(FAST_STATE, true)]);
  const resumed = harness([fastMode], { branch: h.branch() });
  await resumed.emit("session_start", { reason: "resume" });
  assert.match(resumed.statuses.get("fast-tier"), /fast on/);
  await h.command("fast");
  await h.emit("session_shutdown", { reason: "new" });
  h.setBranch([]);
  await h.emit("session_start", { reason: "new" });
  assert.match(h.statuses.get("fast-tier"), /fast on/);
});

test("fast: a new session without --fast does not inherit the previous session's toggle", async () => {
  const h = harness([fastMode]);
  await h.emit("session_start");
  await h.command("fast");
  await h.emit("session_shutdown", { reason: "new" });
  h.setBranch([]);
  await h.emit("session_start", { reason: "new" });
  assert.equal(h.statuses.get("fast-tier"), undefined);
  assert.deepEqual(h.branch(), [state(FAST_STATE, false)]);
});

test("fast: tree and fork restore state at the chosen point, not abandoned branches", async () => {
  const h = harness([fastMode]);
  await h.emit("session_start");
  const offBranch = h.branch();
  await h.command("fast");
  const onBranch = h.branch();
  await h.command("fast");
  h.setBranch(onBranch);
  await h.emit("session_tree");
  assert.match(h.statuses.get("fast-tier"), /fast on/);
  h.setBranch(offBranch);
  await h.emit("session_tree");
  assert.equal(h.statuses.get("fast-tier"), undefined);
  const fork = harness([fastMode], { branch: onBranch });
  await fork.emit("session_start", { reason: "fork" });
  assert.match(fork.statuses.get("fast-tier"), /fast on/);
});

test("fast: malformed state is ignored and latest valid boolean wins", async () => {
  const h = harness([fastMode], { branch: [
    state(FAST_STATE, false),
    state(FAST_STATE, true),
    state(CONTEXT_STATE, false),
    state(FAST_STATE, "false"),
    { type: "custom", customType: FAST_STATE, data: null },
  ] });
  await h.emit("session_start", { reason: "resume" });
  assert.match(h.statuses.get("fast-tier"), /fast on/);
  assert.equal(h.appended.length, 0);
});

test("fast: priority payload behavior and GPT matching stay unchanged", async () => {
  const h = harness([fastMode], { flags: { fast: true } });
  await h.emit("session_start");
  const payload = { service_tier: "auto", messages: [{ role: "user", content: "test" }] };
  const updated = await h.emit("before_provider_request", { payload });
  assert.deepEqual(updated, { ...payload, service_tier: "priority" });
  assert.equal(payload.service_tier, "auto");
  h.setModel(model({ id: "alias", name: "gPt alias" }));
  await h.emit("model_select");
  assert.equal((await h.emit("before_provider_request", { payload })).service_tier, "priority");
  h.setModel(model({ id: "claude", name: "Claude" }));
  await h.emit("model_select");
  assert.equal(await h.emit("before_provider_request", { payload }), undefined);
  h.setModel(model());
  for (const malformed of [undefined, null, [], "payload"]) {
    assert.equal(await h.emit("before_provider_request", { payload: malformed }), undefined);
  }
  await h.command("fast");
  assert.equal(await h.emit("before_provider_request", { payload }), undefined);
});

test("both modes: independent state survives reload and commands do not interfere", async () => {
  for (const factories of [[contextMode, fastMode], [fastMode, contextMode]]) {
    const h = harness(factories);
    await h.emit("session_start");
    await h.command("1M");
    await h.command("fast");
    assert.equal(h.ctx.model.contextWindow, 1_000_000);
    assert.equal((await h.emit("before_provider_request", { payload: {} })).service_tier, "priority");
    await h.command("fast");
    assert.equal(h.ctx.model.contextWindow, 1_000_000);
    await h.command("fast");
    await h.emit("session_shutdown", { reason: "reload" });
    assert.equal(h.ctx.model.contextWindow, 128_000);
    const reloaded = harness(factories, { branch: h.branch(), model: h.ctx.model });
    await reloaded.emit("session_start", { reason: "reload" });
    assert.equal(reloaded.ctx.model.contextWindow, 1_000_000);
    assert.match(reloaded.statuses.get("fast-tier"), /fast on/);
    await reloaded.command("1M");
    assert.equal(reloaded.ctx.model.contextWindow, 128_000);
    assert.equal((await reloaded.emit("before_provider_request", { payload: {} })).service_tier, "priority");
  }
});
