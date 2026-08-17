# extensions/ —— 自写 pi 扩展

放自己写的 TypeScript 扩展(纯 TS、跨平台)。每个 `.ts` 文件导出 `default function (pi: ExtensionAPI)`。

被 setup 脚本同步到 `~/.pi/agent/extensions/`,pi 启动自动加载,`/reload` 热重载。

从 comonad/pi-config 里值得借鉴的纯 TS 扩展(按需复制进来):
`slow-mode`(写文件前审查)、`notify`(桌面通知)、`clipboard`(OSC52)、`branch-sessions`、`rewind`、`stash`。
