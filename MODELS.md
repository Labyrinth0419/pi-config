# 给 agent 的模型配置指南

仓库不保存静态模型目录，也不在 settings 中指定默认 provider、模型、思考等级或 `enabledModels`。每次配置时核实当前可用模型，并让用户确认选择。本机的 `models.json` 和 settings 仍可保存已确认的配置，但它们不能作为“上游最新版”的证据。

## 1. 确认 provider 和现有配置

- 按 [SETUP.md](SETUP.md) 确认实际 agent 目录、Pi 版本和部署授权。
- 优先保留本机已有可用 provider；询问用户需要官方 API、订阅登录、已有兼容网关，还是新增 provider。不要预设网关地址或从别的应用自动提取凭据。
- 检查 Pi 内置目录是否已提供所需模型。内置 provider 优先用 `/login` 或其受支持的环境变量；仅在需要兼容端点或经验证的元数据覆盖时修改本机 `models.json`。
- 可以检查本机 model IDs、API 类型、上下文容量、输出上限和资源引用，但不得打印 endpoint 中的认证信息、API key、header token 或凭据命令的输出。

## 2. 核实最新模型

证据按以下顺序交叉核对：provider 官方文档和发布说明、用户使用的网关所支持的目录、当前 Pi 的模型目录及兼容能力。记录来源链接和核实日期。

用户允许联网后，可查询公开资料；刷新 Pi 模型目录需要单独说明会改动本机缓存，再按当前 CLI 文档使用 `pi update --models`。它不能替代网关目录确认，也不会自动更新用户自定义 provider。已有本机目录可先用当前 CLI 的离线模型列表命令检查；不要为了列模型启动会连接 MCP 的完整会话。

MiMo 当前的配置目标是 v2.6 系列，provider 由用户确认，可继续使用本机已有的 `xiaomi` 或 `anno`。不要沿用旧 v2.5 定义，也不要仅把 ID 中的版本数字替换掉。需要核实准确 ID、Flash/Pro 等变体、是否有 ultraspeed 变体、API 类型、推理参数、上下文及输出限制。上游若已发布更新系列，向用户说明证据并询问是否采用；资料不足时保留可用配置并报告未核实项。

其他模型也按相同流程发现，不把 MiMo 当作唯一默认选择。最新发布不代表当前账户可用、当前网关支持或当前 Pi 兼容。

## 3. 向用户确认模型方案

给出候选模型及适用差异，再确认：

- 默认 provider 和 model，以及主会话的思考等级。
- `enabledModels` 的候选范围，是否保留当前仍可用的模型。
- 摘要和 blackhole 各阶段的主模型、备用链、成本与冷却策略。
- 是否需要最小实际请求验证。此类验证可能产生费用，默认不执行。

不要用当前会话正在使用的模型推断用户的新会话默认值。除非用户明确批准，不删除其他 provider、不清空模型 scope、不修改已有认证。

## 4. 应用本机配置

1. 阅读当前安装版本的 `docs/models.md`、`docs/settings.md` 和 provider 配置说明；备份待改文件。
2. 优先使用内置模型。自定义 provider 按当前 schema 写入本机 `models.json`，保留未涉及的 provider 和 modelOverrides；认证使用本机凭据或环境变量，不进入仓库。
3. 只填写有来源的 model ID、API、输入类型、contextWindow、maxTokens、reasoning、thinkingLevelMap 和兼容参数。不能把未知参数猜成已验证配置，也不能只靠扩大全局上下文容量宣称服务端支持。
4. 在本机 settings 中保存用户确认的 `defaultProvider`、`defaultModel`、`defaultThinkingLevel` 和 `enabledModels`。不要把这些选择写回仓库的通用 settings 或机器覆盖层。
5. 检查模型引用：`web-search.json`、blackhole 各阶段及 fallback、`agents/worker-fast.md`、`extensions/burn.ts` 都可能引用精确 ID。用户只更换主模型时，不顺带改变这些用途；引用失效时报告并询问。blackhole 仓库配置是当前本机同步的基准，不是上游最新模型目录。

## 5. 验证

- 检查 JSON 和当前 Pi 的模型加载结果，确认每个修改的引用指向实际注册的模型。
- 认证检查使用当前版本的无凭据输出、无刷新方式。若 CLI 支持，可用 `pi auth check --provider <provider> --model <id> --no-refresh`；不要使用打印 key/token 或附带 credentials 的选项。
- 不自动刷新登录、不连接 MCP、不发送模型请求。认证状态通过不等于服务端模型请求一定成功。
- 缺少官方或网关数据、认证或兼容支持时停止对应配置，给出需要用户补充的信息，不静默切换 provider。
- 交付本机变更、模型来源和日期、未核实项及 `/reload` 提醒。模型更新后仍需下次重新核实，Markdown 指南本身不会自动追踪发布。
