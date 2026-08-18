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
2. 把核心配置 + 覆盖层同步到 `~/.pi/agent/`
3. 处理 `auth.json`:已有密钥保留;本机有 `~/.claude`/`~/.codex` 则自动提取;都没有则用模板
4. `pi install` 装齐核心扩展(subagents / mcp-adapter / web-access / blackhole / background-tasks)
5. 构建并安装 `vendor/` 里的扩展(plannotator:源码入库,`npm install` + `node build.mjs` 后 `pi install`)

## 目录

| 路径 | 说明 |
|---|---|
| `AGENTS.md` | 全局行为规范 + 自动子代理规则(三端通用) |
| `settings.json` | 默认 provider/model/思考档位(Ctrl+P 模型列表) |
| `models.json` | deepseek + lucen 双 provider 定义 |
| `keybindings.json` | 快捷键(ctrl+p 等已避免与模型切换冲突) |
| `extensions/` | 本地扩展:slow-mode / notify / clipboard / rewind / branch-sessions / stash / questionnaire / environment-context(精选自 comonad/pi-config,MIT) |
| `skills/` | code-review / research / diagnosing-bugs / prototype(精选自 mattpocock/skills,经 comonad vendored,MIT) |
| `prompts/` | 交接模板(handoff, pickup) |
| `vendor/plannotator/` | 计划模式扩展(源码入库,setup 自动构建+安装;构建产物 gitignore) |
| `machines/win-personal/` | Windows:drawio MCP(引用 `~/.codex` 本地路径) |
| `machines/linux-personal/` | 直接用核心配置 |
| `machines/linux-headless/` | 无头服务器:默认 deepseek、thinking high |
| `setup.sh` / `setup.ps1` | 一键部署 |

## 密钥

- `auth.json` **已 gitignore**,由 setup 脚本自动生成/保留,绝不上库
- 换机器时 setup 会自动从 `~/.claude`/`~/.codex` 提取;没有就填 `auth.json` 或 `pi /login`

## 日常

- `pi` — 默认 lucen gpt-5.6-sol
- `Shift+Tab` 循环思考档位,`/thinking <level>`,`Ctrl+P` 切模型
- 子代理:`Use reviewer to review this diff` / `Ask oracle ...`(规则见 `AGENTS.md`)

## 扩展模型↔档位绑定(可选)

`settings.json` 的 `enabledModels` 支持 `model:level` 后缀,如 `"gpt-5.6-sol:max"` 让 Ctrl+P 切过去自带档位:
```json
"enabledModels": ["gpt-5.6-sol:max", "deepseek-v4-flash:medium"]
```

## 注意

- 修改仓库后重新跑一遍 setup(交互式菜单或 `--sync`;Windows 是复制,记得重跑)
- `pi-web-access` 在无头服务器上需要 ffmpeg/yt-dlp,按需安装
- `extensions/` 里的本地扩展来自 comonad/pi-config(MIT),改动前保留出处声明
- **Windows shell**:`machines/win-personal/settings.json` 指了 `shellPath`(Git Bash),setup 自动装 `@4fu/pi-pwsh`(用 PowerShell 7 替换 bash 工具;真 bash 用 `bash -c` 在 pwsh 里跑)
- **Windows fusion/background-tasks**:scoop 装 pi 没有 `@earendil-works/pi-coding-agent` npm 包,`fusion` 起子进程会报环境问题;要用就 `cd ~/.pi/agent/npm && npm install --no-save @earendil-works/pi-coding-agent@0.84.2`(详见 win-personal/README)
- `settings.json` 采用合并策略:仓库(含机器覆盖)的键覆盖手动改动,pi 管理的键(`packages`/`lastChangelogVersion`)保留
- **加 skill**:在 `skills/` 下建目录放 `SKILL.md`(frontmatter 必须带 `name` 和 `description`)。**别在 `skills/` 目录放 README/说明文件**——pi 会把它当 skill 解析并报 "description is required"
