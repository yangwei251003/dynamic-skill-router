# 验证记录

日期：2026-10-26。Windows / Node.js v24.15.0。

- `npm ci --ignore-scripts` 成功安装15个锁定依赖包；node_modules不发布。
- 隔离HOME、USERPROFILE、CODEX_HOME后运行health与list：ok=true，发现两个原创示例Skill和路由器自身，共3项。
- `npm run demo`：一次V4路由返回routeId并命中example-code-review，未执行外部工具。
- 相关既有13个测试文件：Node汇总41项通过，0失败、0跳过，包含独立stdio MCP进程、哈希版本、来源覆盖、阶段检索与恢复。
- 隔离运行器先通过新Node进程检查os.homedir()；不符合临时HOME则拒绝执行。

源服务未重启、原核心/个人库/真实宿主配置未修改。本次测试未连接真实第三方服务，也未验证所有宿主的新会话接入、模型效果或成本收益。Linux与Node22的在线CI仍待远端执行。

敏感信息、源码完整性与本地文档链接复核结果保存在本次迁移报告；静态扫描无命中不能证明不存在所有隐私类型。
