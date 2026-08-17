# skills/ —— 自用 skill

当前 skill(均自包含,纯提示词 + 子代理编排,三端通用):

| Skill | 用途 |
|---|---|
| `code-review` | 两轴代码审查(标准 + 规格),并行子代理跑 |
| `research` | 对高可信一手资料做调研,结果落成 Markdown |
| `diagnosing-bugs` | 疑难 bug / 性能回归的诊断循环 |
| `prototype` | 搭一次性原型回答设计问题(状态模型 / UI) |

这些精选自 [comonad/pi-config](https://codeberg.org/comonad/pi-config) 里 vendored 的 [mattpocock/skills](https://github.com/mattpocock/skills)(MIT),未修改。改的时候保留出处声明。

添加新 skill:放一个目录,内含 `SKILL.md`(frontmatter 带 `name` / `description`),setup 会同步到 `~/.pi/agent/skills/`。
