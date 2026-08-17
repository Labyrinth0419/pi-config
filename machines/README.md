# machines/ —— 按机器覆盖层

`setup.sh` / `setup.ps1` 先把根目录的**核心配置**同步到 `~/.pi/agent/`,再应用当前机器的 overlay。

**覆盖语义**(简单直接,不搞复杂合并):
- `machines/<name>/settings.json` 存在 → **整体替换**核心 settings.json
- `machines/<name>/mcp.json` 存在 → 复制为 `~/.pi/agent/mcp.json`
- `machines/<name>/extensions/` 存在 → 合并进 `~/.pi/agent/extensions/`

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
