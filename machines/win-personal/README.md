# win-personal — Windows 个人机

覆盖内容:
- `settings.json`:合并 `shellPath = E:\Git\usr\bin\bash.exe`(Git Bash;否则 pi 的 bash 工具会挂到 WSL 占位符)
- `mcp.json`:drawio MCP(路径引用 `~/.codex/mcp-servers/drawio-mcp`)

Windows 专属扩展(由 setup 自动装):`@4fu/pi-pwsh` —— 替换内置 bash 工具为 **pwsh 工具**(PowerShell 7),真 bash 命令可用 `bash -c "..."` 在 pwsh 里跑。
