import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSessionMode } from "./lib/session-mode-control.ts";

const PROVIDER = "labyrinth";
const MODEL_ID = "gpt-6-astra";
const STATE_TYPE = "burn-mode-state";
const STATUS_KEY = "burn-mode";
type Thinking = ReturnType<ExtensionAPI["getThinkingLevel"]>;
interface Configuration {
  provider: string;
  modelId: string;
  thinking: Thinking;
  fast: boolean;
  context: boolean;
}

function isConfiguration(value: unknown): value is Configuration {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  return typeof data.provider === "string" && typeof data.modelId === "string" &&
    typeof data.thinking === "string" &&
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(data.thinking) &&
    typeof data.fast === "boolean" && typeof data.context === "boolean";
}

export default function (pi: ExtensionAPI) {
  let switching = false;
  let previous: Configuration | undefined;

  const updateStatus = (ctx: ExtensionContext) => {
    ctx.ui.setStatus(STATUS_KEY, previous ? ctx.ui.theme.fg("accent", "🔥 Burn") : undefined);
  };
  const restoreState = (ctx: ExtensionContext) => {
    previous = undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
      if (typeof entry.data !== "object" || entry.data === null) continue;
      const data = entry.data as Record<string, unknown>;
      if (data.enabled === false) previous = undefined;
      else if (data.enabled === true && isConfiguration(data.previous)) previous = data.previous;
    }
    updateStatus(ctx);
  };

  pi.registerCommand("burn", {
    description: "Toggle Burn preset; disabling restores the configuration from before activation",
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify("用法：/burn（不带参数，切换开关）。", "error");
        return;
      }
      if (switching) {
        ctx.ui.notify("/burn 正在切换，请勿重复执行。", "warning");
        return;
      }

      switching = true;
      try {
        if (!ctx.isIdle()) {
          ctx.ui.notify("等待当前回复结束后切换 Burn 配置。", "info");
          await ctx.waitForIdle();
        }
        const disabling = previous !== undefined;
        const destination = previous;
        const target = ctx.modelRegistry.find(destination?.provider ?? PROVIDER, destination?.modelId ?? MODEL_ID);
        if (!target) {
          ctx.ui.notify(`未找到 ${destination?.provider ?? PROVIDER}/${destination?.modelId ?? MODEL_ID}，当前配置未改变。`, "error");
          return;
        }
        const fast = getSessionMode(pi, "fast");
        const context = getSessionMode(pi, "gpt-context-1m");
        if (!fast || !context) {
          ctx.ui.notify(
            "/burn 需要 fast-mode 和 gpt-context-1m 扩展。请启用更新后的扩展并执行 /reload；当前配置未改变。",
            "error",
          );
          return;
        }
        const originalModel = ctx.model;
        if (!originalModel) {
          ctx.ui.notify("当前尚未选择模型，请先选择模型再切换 Burn。", "error");
          return;
        }
        const current: Configuration = {
          provider: originalModel.provider,
          modelId: originalModel.id,
          thinking: pi.getThinkingLevel(),
          fast: fast.isEnabled(),
          context: context.isEnabled(),
        };
        let failure = "切换模型失败";
        try {
          if (!(await pi.setModel(target))) {
            ctx.ui.notify("无法使用目标模型，请检查该提供商的认证。当前配置未改变。", "error");
            return;
          }
          const thinking = destination?.thinking ?? "max";
          failure = `目标模型未能启用 ${thinking} 思考等级`;
          pi.setThinkingLevel(thinking);
          if (pi.getThinkingLevel() !== thinking) throw new Error(failure);

          failure = "设置 fast 失败";
          fast.setEnabled(destination?.fast ?? true, ctx);
          failure = "设置 GPT 1M 失败";
          context.setEnabled(destination?.context ?? true, ctx);

          failure = "最终配置校验失败";
          if (
            ctx.model?.provider !== target.provider || ctx.model.id !== target.id ||
            pi.getThinkingLevel() !== thinking || fast.isEnabled() !== (destination?.fast ?? true) ||
            context.isEnabled() !== (destination?.context ?? true) ||
            (!disabling && ctx.model.contextWindow !== 1_000_000)
          ) throw new Error(failure);

          failure = "保存 Burn 状态失败";
          // Persist only identifiers so reload does not retain stale model objects.
          pi.appendEntry(STATE_TYPE, disabling ? { enabled: false } : { enabled: true, previous: current });
        } catch {
          let restored = true;
          const restore = (action: () => void) => {
            try { action(); } catch { restored = false; }
          };
          // Compensating entries preserve append-only history while restoring effective state.
          restore(() => {
            if (context.isEnabled() !== current.context) context.setEnabled(current.context, ctx);
          });
          restore(() => {
            if (fast.isEnabled() !== current.fast) fast.setEnabled(current.fast, ctx);
          });
          try {
            if (ctx.model !== originalModel && !(await pi.setModel(originalModel))) restored = false;
          } catch {
            restored = false;
          }
          restore(() => {
            pi.setThinkingLevel(current.thinking);
            if (pi.getThinkingLevel() !== current.thinking) restored = false;
          });
          ctx.ui.notify(
            `/burn：${failure}。${restored ? "已恢复之前的配置。" : "未能完全恢复，请检查 /model、/thinking 和状态栏。"}`,
            "error",
          );
          return;
        }

        previous = disabling ? undefined : current;
        updateStatus(ctx);
        ctx.ui.notify(
          disabling
            ? "Burn 已关闭，已恢复开启前的模型、思考等级、fast 和 1M 状态。"
            : "🔥 已开启 Burn：(labyrinth) gpt-6-astra • max + ⚡ fast + 📚 GPT 1M（仅当前会话）。",
          "info",
        );
      } finally {
        switching = false;
      }
    },
  });

  pi.on("session_start", (_event, ctx) => restoreState(ctx));
  pi.on("session_tree", (_event, ctx) => restoreState(ctx));
  pi.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus(STATUS_KEY, undefined));
}
