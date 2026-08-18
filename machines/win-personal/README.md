# win-personal — Windows 个人机

覆盖内容:
- `settings.json`:合并 `shellPath = E:\Git\usr\bin\bash.exe`(Git Bash;否则 pi 的 bash 工具会挂到 WSL 占位符)
- `mcp.json`:drawio MCP(路径引用 `~/.codex/mcp-servers/drawio-mcp`)

Windows 专属扩展(由 setup 自动装):`@4fu/pi-pwsh` —— 替换内置 bash 工具为 **pwsh 工具**(PowerShell 7),真 bash 命令可用 `bash -c "..."` 在 pwsh 里跑。

**fusion / background-tasks 子进程(可选)**:scoop 装的 pi 是独立二进制,没有 npm 包 `@earendil-works/pi-coding-agent`,导致 fusion 在 Windows 起子进程报"环境问题"(`PiLaunchResolutionError`)。要用 fusion 时跑一次:
```powershell
cd ~/.pi/agent/npm; npm install --no-save @earendil-works/pi-coding-agent@0.84.2
```
