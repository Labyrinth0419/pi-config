# machines/ —— 按机器覆盖层

`setup.sh` / `setup.ps1` 先把根目录的**核心配置**同步到 `~/.pi/agent/`,再应用当前机器的 overlay。

**覆盖语义**:
- `settings.json` 按“已有运行时配置 → 根目录核心配置 → 机器 overlay”的顺序合并，后者覆盖同名键
- `machines/<name>/settings.json` 只需声明该机器的差异配置
- `machines/<name>/mcp.json` 存在 → 复制为 `~/.pi/agent/mcp.json`
- `machines/<name>/extensions/` 存在 → 复制并合并进 `~/.pi/agent/extensions/`

**机器选择**:
1. 显式指定:`PI_MACHINE=win-personal ./setup.sh` 或 `.\setup.ps1 -Machine win-personal`
2. 未指定时自动检测:
   - Windows → `win-personal`
   - Linux 无显示 + SSH/非交互 → `linux-headless`
   - 其余 Linux → `linux-personal`

目前:
- `win-personal` — Windows 个人机。带 drawio MCP(引用 `~/.codex` 本地路径)
- `linux-personal` — 有桌面的 Linux 个人机,直接用核心配置(无覆盖文件)
- `linux-headless` — 无头服务器,默认 deepseek(便宜),thinking 降到 high
