import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerSessionMode } from "./lib/session-mode-control.ts";

const CONTEXT_WINDOW = 1_000_000;
const STATE_TYPE = "gpt-context-1m-state";
const STATUS_KEY = "gpt-context-1m";

function hasGptName(model: Model<any> | undefined): boolean {
  return !!model && /gpt/i.test(`${model.id} ${model.name ?? ""}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default function (pi: ExtensionAPI) {
  let active = false;
  let overridden: { model: Model<any>; contextWindow: number } | undefined;

  const restoreDefault = () => {
    if (!overridden) return;
    // Do not undo a newer context-window change made by another extension.
    if (overridden.model.contextWindow === CONTEXT_WINDOW) {
      overridden.model.contextWindow = overridden.contextWindow;
    }
    overridden = undefined;
  };

  const updateStatus = (ctx: ExtensionContext) => {
    ctx.ui.setStatus(
      STATUS_KEY,
      active
        ? ctx.ui.theme.fg(
            hasGptName(ctx.model) ? "accent" : "muted",
            hasGptName(ctx.model) ? "📚 GPT 1M" : "📚 1M on (GPT only)",
          )
        : undefined,
    );
  };

  const syncModel = (ctx: ExtensionContext) => {
    const model = ctx.model;
    if (overridden && (!active || overridden.model !== model || !hasGptName(model))) {
      restoreDefault();
    }
    if (active && model && hasGptName(model)) {
      // Model selection and registry refreshes may supply a new object for the same ID.
      if (!overridden || model.contextWindow !== CONTEXT_WINDOW) {
        overridden = { model, contextWindow: model.contextWindow };
      }
      model.contextWindow = CONTEXT_WINDOW;
    }
    updateStatus(ctx);
  };

  const setEnabled = (enabled: boolean, ctx: ExtensionContext) => {
    pi.appendEntry(STATE_TYPE, { enabled });
    active = enabled;
    syncModel(ctx);
  };

  registerSessionMode(pi, "gpt-context-1m", { isEnabled: () => active, setEnabled });

  const restoreState = (ctx: ExtensionContext) => {
    restoreDefault();
    active = false;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
      if (isRecord(entry.data) && typeof entry.data.enabled === "boolean") {
        active = entry.data.enabled;
      }
    }
    syncModel(ctx);
  };

  const notifyStatus = (ctx: ExtensionContext) => {
    const model = ctx.model;
    const mode = active ? "已开启（仅当前会话）" : "已关闭，使用默认配置";
    const current = model
      ? `当前模型：${model.provider}/${model.id}；上下文：${model.contextWindow.toLocaleString("en-US")} tokens。`
      : "当前尚未选择模型。";
    const scope = active && !hasGptName(model) ? "切换到名称或 ID 包含 GPT 的模型后生效。" : "";
    const limit = active ? "此开关只调整 Pi 的上下文判断，服务端仍须支持相应容量。" : "";
    ctx.ui.notify([`1M ${mode}。`, current, scope, limit].filter(Boolean).join("\n"), "info");
  };

  pi.registerCommand("1M", {
    description: "Toggle 1M context for GPT models in this session; disabling restores defaults",
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify("用法：/1M（不带参数，切换开关）。", "error");
        return;
      }
      setEnabled(!active, ctx);
      notifyStatus(ctx);
      if (!active && ctx.model) {
        const usage = ctx.getContextUsage();
        if (usage?.tokens != null && usage.tokens >= ctx.model.contextWindow) {
          ctx.ui.notify("当前对话已达到恢复后的上下文上限，建议先执行 /compact。", "warning");
        }
      }
    },
  });

  pi.on("session_start", (_event, ctx) => restoreState(ctx));
  pi.on("session_tree", (_event, ctx) => restoreState(ctx));
  pi.on("model_select", (_event, ctx) => syncModel(ctx));
  // Input precedes pre-prompt compaction; same-ID reselection does not emit model_select.
  pi.on("input", (_event, ctx) => syncModel(ctx));
  pi.on("before_agent_start", (_event, ctx) => syncModel(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    restoreDefault();
    active = false;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
