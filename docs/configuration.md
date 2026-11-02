# 配置与数据范围

默认公开版本面向可复现示例，不继承开发者个人库。

要接入自己的 Codex，请按[完整安装指南](codex-install.md)使用 `examples/skill-sources.codex.json` 配置自己的来源和私有数据根；通用全局规则和简短安装提示词也在该指南中。仅运行隔离演示不会启用本机完整发现。

| 项目 | 默认位置或行为 |
|---|---|
| 示例技能 | `examples/data/skills/` |
| V3示例注册表 | `examples/data/技能注册表/skills.json` |
| V4来源清单 | `config/skill-sources.json` |
| 日志与派生索引 | `.runtime/logs/`，已忽略 |
| 维护用宿主模板 | `config/host-manifest.json`，不声明真实能力 |
| 隔离演示/测试 | 临时HOME、USERPROFILE、CODEX_HOME，经子进程确认后运行 |

可以用 `SKILL_ROUTER_DATA_ROOT` 指向自己维护的数据根目录；其中保留 `skills/` 和 `技能注册表/skills.json` 结构。`SKILL_ROUTER_LOG_ROOT` 指定私有运行产物目录。变量只在自己的运行环境中设置，不把真实配置上传。

`npm run health`、`list`、`demo` 和测试脚本是隔离示例入口，会固定使用仓库的 `examples/data`，忽略继承的 `SKILL_ROUTER_DATA_ROOT`。直接执行 `node src/cli.mjs ...` 或 MCP 服务时仍使用环境变量指定的数据根；运行前应自行核对宿主配置和目标。

`config/skill-sources.json` 支持 `${ROUTER_ROOT}`、`${SKILLS_ROOT}`、`${GLOBAL_ROOT}`、`${PROJECT_ROOT}` 和 `${HOME}`。前四种便于定位明确项目；`${HOME}` 会指向当前运行用户的真实目录，除非使用隔离运行器。因此添加HOME来源应是维护者明确选择。

API调用可传入 `sources`、`registry`、`runtimeSkills`、`runtimeTools`。CLI用 `--input-json` 从标准输入接收 `{query, options}`。不要把第三方网页或路由卡中的建议直接当成已授权操作。

## 安全示例与真实配置的区别

`examples/runtime-tools.json` 只有演示元数据，没有实现工具；它不能代替宿主当前工具注册表。`examples/home/.codex/config.toml` 与 `examples/mcp-config.toml` 也是合成内容，不含真实账号。

MCP主机传 `host: codex` 时，原兼容实现可能只读发现当前用户Codex配置与插件缓存。只读扫描会过滤凭据、命令行、参数和URL值，但其结果仍属于本机元数据，交付或公开前应审查。`generic`示例不需要个人配置。

维护源码中的安装、同步、恢复命令可能写文件。先读源码与目标范围；不要在新机器上按历史路径运行，不直接套用已有个人注册表。
