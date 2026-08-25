# pi-config

个人 pi-coding-agent 配置库,一份核心配置跑三端:**Windows 个人机 / Linux 个人机 / Linux 无头服务器**。

结构:`machines/` 里的覆盖层吸收跨机器差异,核心配置三端共用。密钥不进库。

## 安装 pi(仅需一次)

- Windows:`scoop install pi-coding-agent`
- Linux (npm):`npm install -g @earendil-works/pi-coding-agent`

## 部署(新机器)

```bash
git clone git@github.com:Labyrinth0419/pi-config.git pi-config
# 或 https: git clone https://github.com/Labyrinth0419/pi-config.git pi-config
cd pi-config
./setup.sh            # Linux / Git Bash —— 交互式 TUI
# 或 Windows 原生:
.\setup.ps1           # 交互式 TUI
```

运行后出现交互菜单:
- `1` 全量同步(自动检测机器)
- `2` 选择机器覆盖层
- `3` 管理扩展(勾选装/卸)
- `4` 管理 API 密钥
- `5` 环境自检

**非交互模式**(自动化/CI/无 TTY):
```bash
./setup.sh --sync
# 或
.\setup.ps1 -Sync
```

指定机器:`PI_MACHINE=linux-headless ./setup.sh` 或 `.\setup.ps1 -Machine linux-headless`,或菜单里的"选择机器覆盖层"。

脚本会:
1. 检测机器 → 应用对应 `machines/<name>/` 覆盖层
2. 把核心配置 + 覆盖层同步到 `~/.pi/agent/`，并同步 `web-search.json` 与 `pi-blackhole/pi-blackhole-config.json`
3. 处理 `auth.json`:已有密钥保留;本机有 `~/.claude`/`~/.codex` 则自动提取;都没有则用模板
4. `pi install` 装齐核心扩展(subagents / mcp-adapter / `pi-web-access@0.24.2` / blackhole / background-tasks / hashline-edit / pi-mem-cc / pi-ssh-remote / planning-with-files / pi-todo-rail / `pi-thread-goal` / `pi-btw` / `@eko24ive/pi-ask@1.2.0`)
5. 校验并应用 `vendor/pi-task-routing-patch.mjs`;补丁失败时终止同步
6. 构建并安装 `vendor/` 中除 plannotator 外的扩展;plannotator 源码保留在库中但当前 setup 跳过安装

## 目录

| 路径 | 说明 |
|---|---|
| `AGENTS.md` | 全局行为规范 + 自动子代理规则(三端通用) |
| `settings.json` | 默认 provider/model/思考档位(Ctrl+P 模型列表) |
| `models.json` | deepseek + lucen + xiaomi + labyrinth + OpenRouter provider 定义(密钥只从环境变量或 `/login` 获取) |
| `web-search.json` | web_search 自动摘要、摘要模型与摘要推理级别 |
| `pi-blackhole/pi-blackhole-config.json` | blackhole 压缩/记忆 worker 基础模型 |
| `keybindings.json` | 快捷键(ctrl+p 等已避免与模型切换冲突) |
| `extensions/` | 本地扩展:slow-mode / notify / clipboard / rewind / branch-sessions / stash / environment-context(精选自 comonad/pi-config,MIT) |
| `skills/` | code-review / research / diagnosing-bugs / prototype(精选自 mattpocock/skills,经 comonad vendored,MIT) |
| `prompts/` | 交接模板(handoff, pickup) |
| `vendor/plannotator/` | 计划模式扩展源码(入库保存;当前 setup 跳过自动构建/安装) |
| `pi-thread-goal` / `pi-btw` | 社区扩展:持久化 `/goal` 与并行 `/btw` side session,由 setup 自动安装 |
| `pi-mem-cc` / `pi-ssh-remote` | 记忆与 SSH 远程扩展,由 setup 自动安装 |
| `planning-with-files` / `pi-todo-rail` | 文件化规划与分支感知 Todo 扩展,由 setup 自动安装 |
| `@eko24ive/pi-ask` | 社区问答扩展,替代本机自写的 `questionnaire.ts`,由 setup 自动安装 |
| `machines/win-personal/` | Windows:drawio MCP(引用 `~/.codex` 本地路径) |
| `machines/linux-personal/` | 直接用核心配置 |
| `machines/linux-headless/` | 无头服务器:默认 deepseek、thinking high |
| `setup.sh` / `setup.ps1` | 一键部署 |

## 密钥

- `auth.json` **已 gitignore**,由 setup 脚本自动生成/保留,绝不上库
- `models.json` 中的 labyrinth provider 使用 `$LABYRINTH_API_KEY`，OpenRouter 使用 `$OPENROUTER_API_KEY`;不要把真实 key 写进仓库
- 换机器时 setup 会自动从 `~/.claude`/`~/.codex` 提取;没有就填 `auth.json`、设置对应环境变量，或运行 `pi /login`
- `web-search.json` 的摘要模型需要在 `settings.json` 的 `enabledModels` 中启用；当前默认是 `labyrinth/gpt-5.6-luna` + `low`

## 日常

- `pi` — 默认 labyrinth gpt-5.5，主会话 thinking 为 `xhigh`；web_search 摘要独立使用 labyrinth gpt-5.6-luna 的 `low`
- `Shift+Tab` 循环思考档位,`/thinking <level>`,`Ctrl+P` 切模型
- 子代理:`Use reviewer to review this diff` / `Ask oracle ...`(规则见 `AGENTS.md`)

## 扩展模型↔档位绑定(可选)

`settings.json` 的 `enabledModels` 支持 `model:level` 后缀,如 `"gpt-5.6-sol:max"` 让 Ctrl+P 切过去自带档位:
```json
"enabledModels": ["gpt-5.6-sol:max", "deepseek-v4-flash:medium"]
```

## 注意

- 修改仓库后重新跑一遍 setup(交互式菜单或 `--sync`;Windows 是复制,记得重跑)
- `pi-web-access` 默认使用 `auto-summary`，不会为模型调用打开 curator 浏览器；手动 `/websearch` 仍是交互式 curator
- `pi-web-access@0.24.2` 原生支持 summary 模型的 thinking 后缀；当前 `web-search.json` 使用 `labyrinth/gpt-5.6-luna:low`，无需额外源码补丁
- `pi-web-access` 在无头服务器上需要 ffmpeg/yt-dlp,按需安装
- **后台任务 ID 路由**:`ps_XXXXXXXX` 属于 `@4fu/pi-pwsh`,只能使用 `pwsh taskId`;`bg_logs` 对误传的 `ps_` ID 会提示正确工具。`bg_run` 产生的任务才使用 `bg_status` / `bg_logs` / `bg_kill`
- `extensions/` 里的本地扩展来自 comonad/pi-config(MIT),改动前保留出处声明
- `vendor/plannotator/` 当前仅作为源码存档;setup 不会自动重新安装它
- **Windows shell**:`machines/win-personal/settings.json` 指了 `shellPath`(Git Bash),setup 自动装 `@4fu/pi-pwsh@0.8.10`(用 PowerShell 7 替换 bash 工具;真 bash 用 `bash -c` 在 pwsh 里跑)
- **Windows fusion/background-tasks**:scoop 装 pi 没有 `@earendil-works/pi-coding-agent` npm 包,`fusion` 起子进程会报环境问题;要用就 `cd ~/.pi/agent/npm && npm install --no-save @earendil-works/pi-coding-agent@0.84.3`(详见 win-personal/README)
- **goal / btw / ask / planning / todo**:`pi-thread-goal` 来自 GitHub(当前未发布 npm 包),`pi-btw`、`planning-with-files`、`pi-todo-rail` 来自 npm;`@eko24ive/pi-ask@1.2.0` 替代本机自写的 `questionnaire.ts`;扩展更新后可通过 `/reload` 生效
- **hashline 编辑**:默认装 `pi-hashline-edit`(替换内置 read/edit,对弱空间推理模型收益大)。⚠️ **别装 `pi-hashline-edit-pro`**——它要 `node:sqlite`,而 scoop 的 pi 是 bun 编译二进制不含该模块,加载直接报错
- `settings.json` 采用合并策略:仓库(含机器覆盖)的键覆盖手动改动,pi 管理的键(`packages`/`lastChangelogVersion`)保留
- **加 skill**:在 `skills/` 下建目录放 `SKILL.md`(frontmatter 必须带 `name` 和 `description`)。**别在 `skills/` 目录放 README/说明文件**——pi 会把它当 skill 解析并报 "description is required"
