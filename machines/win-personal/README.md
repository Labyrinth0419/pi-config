# Windows 个人机

只有这一台 Windows 机器，不做跨 Windows 迁移或路径适配。

- `settings.json` 保留现有 `E:\Git\usr\bin\bash.exe` 路径和工具集合。agent 按 SETUP.md 比较本机差异，确认后再应用，不擅自更换 shell 或工具。
- `extensions/user-pwsh.ts` 使用 Pi 内置 `createLocalPowerShellOperations` 处理用户 shell 命令，不依赖额外 PowerShell 适配器。
- MCP 和图像 provider 保持本机管理；仓库不提供这些配置，也不处理认证。

部署入口是 [SETUP.md](../../SETUP.md)，模型选择按 [MODELS.md](../../MODELS.md) 询问用户。包的停用、卸载和 Pi 主程序升级需要另行确认。
