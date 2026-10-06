# pi-config

个人 Pi 配置与部署指南。保存通用偏好、本地扩展和选定的 skills、prompts、agents；模型和安装步骤由 agent 根据目标机器判断，并向用户确认。

## 使用

```text
git clone git@github.com:Labyrinth0419/pi-config.git
```

让 agent 阅读仓库 `AGENTS.md`，再按 [SETUP.md](SETUP.md) 工作。例如：

> 阅读 SETUP.md 和 MODELS.md，只读比较本机 Pi 与仓库。列出建议同步、安装、更新或退出管理的内容，先问我，不要直接覆盖配置。

确认方案后，再授权 agent 应用需要的部分。仓库没有一键执行的 setup 脚本，也不会自动升级、卸载或修改本机配置。

## 模型和包

- [MODELS.md](MODELS.md) 指导 agent 核实官方资料、网关支持和当前 Pi 模型目录，再确认默认模型、思考等级及候选范围。MiMo 当前目标为 v2.6 系列，后续新版本需重新核实。
- 仓库不保存 `models.json`，通用 settings 和机器覆盖层不包含固定模型选择。本机仍可使用自己的模型配置。
- 包清单在 [SETUP.md](SETUP.md#包清单)，以当前使用的包为基准，不固定 npm 发布版本；安装和更新都需要用户确认。
- Pi 本身使用 latest 发布通道。agent 先检查实际安装方式和当前 CLI 文档，再询问是否升级，不另装一个版本覆盖已有安装器。

## 目录

| 路径 | 说明 |
|---|---|
| `SETUP.md` | agent 部署流程、包清单、确认和验证要求 |
| `MODELS.md` | 动态模型发现与本机配置流程 |
| `AGENTS.md` | 通用行为规则 |
| `settings.json` | 与模型无关的通用交互偏好 |
| `keybindings.json` | 快捷键 |
| `pi-blackhole/pi-blackhole-config.json` | 与当前本机同步的阶段级压缩策略，应用前检查模型引用 |
| `web-search.json` | 搜索摘要策略，应用前检查摘要模型 |
| `extensions/` | 本地扩展及共享代码 |
| `skills/` | 仓库选定的 skills；不代表本机全部已安装 skills |
| `agents/` | `worker-fast` 子代理及其精确模型依赖 |
| `prompts/` | handoff、pickup 模板 |
| `machines/` | 用户确认后应用的机器差异 |
| `tests/` | 模式扩展和部署策略回归检查 |
| `auth.example.json` | 空凭据示例，不作为部署源，不覆盖本机 auth |

## 本地模式指令

`/fast`、`/1M`、`/burn`、`/slow-mode` 都只接受裸指令，执行一次翻转状态。`on/off/status` 等参数会报错，不改变状态。

- `/fast`：GPT 命名模型的 best-effort priority tier。
- `/1M`：修改 Pi 的 GPT 上下文判断，关闭时恢复原容量；不保证服务端支持 1M。
- `/burn`：开启代码中指定的模型、max、fast 和 1M 组合；关闭时恢复开启前配置，支持会话恢复。
- `/slow-mode`：只读工具直接执行，其余工具需要审批；不新增 `/slow` 别名。

## 管理边界

- MCP 完全由本机维护，仓库不部署服务器配置、认证或 MCP 适配器。
- 图像 provider 不入库、不部署；agent 不改动本机对应文件或禁用过滤。
- Windows 只有现有个人机，保留其单机路径，不做迁移设计。`user-pwsh.ts` 使用 Pi 内置 PowerShell operations 处理用户 shell 命令。
- 凭据、SSH 端点、Herdr 集成、会话、记忆、日志和安装器状态不迁移。忽略规则是防误提交措施，不代表可以把敏感文件复制到仓库。
- 已退出清单的本机包或文件不会因仓库删除而自动消失。停用或卸载必须另行确认。

## 验证

使用支持 TypeScript 类型剥离的 Node：

```text
node --test tests/context-modes.test.mjs tests/setup-policy.test.mjs
node tests/context-modes.pi-check.mjs <installed-pi-package-root>
git diff --check
```

集成检查使用模拟模型和临时会话，不发送模型请求。部署指南还要求检查目标机器的配置格式、包过滤和模型引用；回归测试通过不能替代这些检查。手动更新配置后执行 `/reload` 或重启 Pi。
