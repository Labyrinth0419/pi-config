# 本地 Pi 扩展

仓库保存本地 TypeScript 扩展，Pi 在 agent 目录中发现其入口。agent 按 [SETUP.md](../SETUP.md) 逐文件比较和同步；更新后由用户执行 `/reload`。不全量覆盖目录或清理本机独有扩展。

当前包括 branch-sessions、clipboard、environment-context、notify、rewind、stash，以及 fast、GPT 1M、Burn、slow-mode 模式。共享代码放在 `lib/`。四个模式命令只接受裸指令翻转，不接受 on/off/status。

图像 provider 不在本仓库管理范围。Windows 的 user-pwsh 扩展位于机器覆盖层；Herdr 管理的文件由 Herdr 安装流程提供。保留精选自 comonad/pi-config 的出处和许可证说明。
