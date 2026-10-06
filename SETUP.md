# 给 agent 的部署指南

本文件是 pi-config 的部署入口。先比较目标机器与仓库，向用户说明差异，再执行用户确认的部分。不要把整个仓库复制到 Pi 的 agent 目录。

## 管理范围

| 仓库来源 | 目标位置 | 处理方式 |
|---|---|---|
| `AGENTS.md` | `<agent-dir>/AGENTS.md` | 展示差异后同步，保留用户未授权覆盖的规则 |
| `keybindings.json` | `<agent-dir>/keybindings.json` | 按键合并，先检查当前 Pi 支持的 action |
| `settings.json` | `<agent-dir>/settings.json` | 合并确认的设置，不替换整个文件 |
| `machines/<name>/settings.json` | 同上 | 应用用户选定的机器差异，不包含模型选择 |
| `extensions/` | `<agent-dir>/extensions/` | 逐文件比较，只同步确认的资源 |
| `machines/win-personal/extensions/` | 同上 | 仅用于现有 Windows 个人机 |
| `skills/`、`prompts/`、`agents/` | 对应资源目录 | 比较源码与资源过滤，不把目录存在当成已启用 |
| `pi-blackhole/pi-blackhole-config.json` | `<agent-dir>/pi-blackhole/pi-blackhole-config.json` | 采用本机同步的阶段级配置，先验证模型引用 |
| `web-search.json` | pi-web-access 当前版本实际读取的位置 | 先查已安装包的配置文档，不猜路径 |
| 本文的包清单 | Pi 包声明及安装目录 | 通过 Pi 的包命令管理，保留无关包和资源过滤 |
| `MODELS.md` | 本机模型与模型选择配置 | 按指南发现模型、询问用户后配置，不复制静态目录 |

不管理 MCP：不得创建、复制、覆盖或删除本机的 MCP 配置、缓存、认证文件，也不安装 MCP 适配器。Pi 内置 MCP 和用户现有服务器保持原样。

不管理图像 provider：不得同步或删除本机的 `labyrinth-images-provider.ts`、`labyrinth-images.ts` 或其资源过滤。它们的本机配置由用户单独维护。

不迁移凭据、SSH 端点、Herdr 集成、会话、记忆数据库、安装器状态或运行日志。`vendor/plannotator/` 只作源码存档，不自动构建、安装或更新依赖。

## 包清单

以下是当前使用的社区包来源，不固定发布版本。它们是候选安装清单，不代表用户已批准本次安装或更新。

```text
npm:pi-subagents
npm:pi-web-access
npm:pi-blackhole
npm:pi-mem-cc
npm:@narumitw/pi-btw
npm:@eko24ive/pi-ask
npm:pi-todo-rail
npm:@99percentpeople/pi-ssh-remote
npm:pi-goal-x
npm:pi-ocr
npm:pi-cliproxy-usage
```

| 包 | 用途 |
|---|---|
| `pi-subagents` | 子代理与工作流 |
| `pi-web-access` | 搜索和网页内容获取 |
| `pi-blackhole` | 上下文压缩 |
| `pi-mem-cc` | 跨会话记忆 |
| `@narumitw/pi-btw` | 轻量 side question |
| `@eko24ive/pi-ask` | 结构化问答 |
| `pi-todo-rail` | 分支感知 Todo |
| `@99percentpeople/pi-ssh-remote` | SSH 工作区 |
| `pi-goal-x` | 持久化目标 |
| `pi-ocr` | 图像和 PDF 文本提取 |
| `pi-cliproxy-usage` | 用量查看 |

不要安装旧清单里的 `pi-mcp-adapter`、`pi-background-tasks`、`@4fu/pi-pwsh`、旧的非 scoped SSH 包、`pi-thread-goal`、`planning-with-files`、`pi-hashline-edit` 或非 scoped `pi-btw`。如果目标机器仍声明这些包，报告其状态，不自动卸载；其中 MCP 适配器的退出也需要单独确认，不能顺带改写 MCP 文件。

## 1. 只读盘点

1. 确认仓库工作区状态，保留已有未提交修改；记录目标 cwd 和本地/SSH 环境。
2. 确认实际 Pi 版本、agent 目录及安装方式。尊重 `PI_CODING_AGENT_DIR`；没有设置时才使用 `~/.pi/agent`。Windows 使用 PowerShell 7。
3. 阅读当前安装版本的 Pi 配置、包、模型文档，以及将要修改的扩展配置文档。仓库说明与当前 API 不一致时先报告，不照抄旧格式。
4. 读取目标 settings 的包声明和资源过滤，比较上表中的配置和文件。不要仅凭 `node_modules` 目录判断是否启用，也不要执行启动时会连接服务的扩展来完成盘点。
5. 模型盘点按 [MODELS.md](MODELS.md) 执行。默认不连接 MCP、不刷新认证、不发送模型请求。

已有机器优先保留当前可用配置；新机器先询问用途、需要的包、provider 和认证方式。只有一台 Windows 个人机，不设计 Windows 迁移或跨 Windows 路径适配。

## 2. 提交计划并询问用户

展示按文件和包拆分的计划，至少说明：

- 要安装、更新、停用或卸载的包；升级可能改变哪些工具和配置格式。
- 要新增或修改的配置键、扩展、skills、prompts 和 agents；哪些本机内容保持不动。
- 默认模型、思考等级、模型选择范围及摘要/压缩模型的建议和来源。
- 备份位置、验证方法，以及需要用户处理的认证或依赖。

使用结构化提问确认有选择空间的事项。安装、更新、覆盖、停用、卸载和付费验证都需要在本次计划中明确获得授权。用户仅要求审查时，到这里停止。

## 3. 应用已确认的部分

- 备份将被修改的文件到仓库外、用户确认的受保护目录。涉及凭据的备份不能打印内容或提交到 Git；记录新增文件以便回退。
- 按语义合并 JSON，保留无关字段。数组和嵌套对象要逐项比较；`packages`、模型选择和资源过滤不能被通用设置覆盖。
- 新包使用不带版本号的 `pi install <source>`。已安装包需要更新时，按当前 CLI 的语法定向更新；不要执行范围更大的 `pi update --all`。
- 本机声明中仍有版本锁时，保留原有资源过滤，仅移除确认过的版本限定，再更新该包。不要把带过滤的对象条目改成字符串，导致禁用资源重新加载。
- 退出管理的本机文件和包保持原样。只有用户明确批准时才通过 `pi remove <source>` 等当前受支持的命令移除包，不能直接删除 npm 安装树。
- Pi 主程序使用 latest 发布通道，但升级要单独确认。先检查安装方式和当前 `pi update` 用法，不擅自绕过受管安装器。
- 按 MODELS.md 更新本机模型配置。blackhole 的阶段模型、备用链和 `compactAfterRatio` 必须与确认的方案一致；不重新加入固定 `compactAfterTokens`。
- Windows 保留现有单机路径，按用户确认的设置应用 `win-personal` 文件。`user-pwsh.ts` 处理用户 shell 命令，不是替换整个工具集合的扩展。

## 4. 验证和交付

1. 校验 JSON、资源路径、包过滤、当前版本支持的设置与模型引用。认证只检查状态，不输出 key/token，不触发刷新；实际网络或付费测试另行确认。
2. 改本仓库资源时，在支持 TypeScript 类型剥离的 Node 版本运行：
   ```text
   node --test tests/context-modes.test.mjs tests/setup-policy.test.mjs
   node tests/context-modes.pi-check.mjs <installed-pi-package-root>
   ```
   集成检查使用临时会话和模拟模型，不发送模型请求；它不证明目标机器的所有包和模型都可用。
3. 检查 `git diff --check` 和修改清单。失败时报告原因与已发生的部分修改，用备份恢复确认需要回退的文件，不声称部署成功。
4. 交付变更、验证结果、未完成项及备份路径。提醒用户 `/reload` 或重启；未经授权不代替用户重载当前会话，也不提交或推送仓库。
