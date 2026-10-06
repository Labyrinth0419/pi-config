# 机器配置

[SETUP.md](../SETUP.md) 由 agent 先检查目标机器，再请用户确认覆盖层。没有自动检测或全量复制入口。

- `win-personal`：现有唯一 Windows 个人机，保留单机路径和工具偏好。
- `linux-personal`：有桌面的 Linux 个人机，目前没有额外 settings。
- `linux-headless`：无头 Linux，使用深色主题；模型按 MODELS.md 单独确认。

通用 settings 和机器 settings 按键合并，不替换本机整个文件。机器 settings 不管理默认 provider、model、thinking 或 enabledModels。模型、认证、MCP、SSH 端点及运行时状态不在覆盖层中迁移。
