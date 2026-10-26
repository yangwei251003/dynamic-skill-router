# 来源、排除范围与许可

本项目来自维护者本地的 `yangwei-dynamic-skill-router` 核心（4.2.0）及其自有Skill契约。Codex插件清单中的作者为yangwei。公开化在独立副本中进行，未改变原活动服务。

## 本次收录

CLI/MCP完整路由运行源码、发现/协调/恢复模块、自有Skill入口及契约、可移植既有回归测试；新增两个原创演示Skill、合成注册表和工具元数据。维护源码中个人根路径已泛化到公开数据根或环境变量。

## 本次未收录

- 第三方安装Skill的正文、模板库和私有素材。
- 原机器个人技能注册表、源库存、插件账号配置、偏好、运行日志和反馈。
- 真实历史请求与 `historical-no-skill-replay.mjs`、读取历史请求的 `astra-routing-evals.mjs`。
- 写死原机器能力库存与路径的 `generate-dashboard.mjs`、`generate-mcp-dashboard.mjs`。
- 依赖原机器完整技能目录的旧评测数据与脚本，未把它们改为虚假通过。
- node_modules、缓存、索引产物与备份。

这意味着本库是可运行的核心开源整理版，不是私人技能库的镜像。未收录文件不构成已备份到GitHub的资产，本地删除判定需另行核对。

自有部分按MIT发布。引用的外部规范和文档保留链接，依赖仍适用原作者许可，见THIRD_PARTY_NOTICES.md。
