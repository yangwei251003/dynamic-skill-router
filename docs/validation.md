# 验证记录

## RC10公开副本 — 2026-11-01

Windows / Node.js v24.15.0：既有回归41/41、V4.3回归313/313通过；health、list、demo均通过，演示发现3个样例Skill并命中example-code-review。使用现有锁定依赖，未重新安装。运行器使用专用`SKILL_ROUTER_HOME`、`SKILL_ROUTER_STATE_ROOT`与`SKILL_ROUTER_LOG_ROOT`，保留系统HOME和CODEX_HOME；下方是早期归档的历史方法说明，不代表当前运行器仍覆盖系统变量。

上述公开副本代码验证未启动真实业务工具，未验证远端CI、其他平台或宿主生产切换。新19题随后完成一次性对照：专业9/12、原生3/3、边界1/4通过；路由契约FAIL、完整发布NOT_READY。原36题已知回归33/36通过，技能无关率相对降低25.71%，未达到50%；真实成果整体+5分未证。题目、库存及原始会话不公开，只归档[最终聚合状态与缺口](v43-rc10-status.md)。本次仅更新汇总文档，不重跑全测试。源码适配范围见[RC10归档范围](v43-rc10-archive.md)。

## 初次公开整理的历史记录

日期：2026-10-26。Windows / Node.js v24.15.0。

- `npm ci --ignore-scripts` 成功安装15个锁定依赖包；node_modules不发布。
- 隔离HOME、USERPROFILE、CODEX_HOME后运行health与list：ok=true，发现两个原创示例Skill和路由器自身，共3项。
- `npm run demo`：一次V4路由返回routeId并命中example-code-review，未执行外部工具。
- 相关既有13个测试文件：Node汇总41项通过，0失败、0跳过，包含独立stdio MCP进程、哈希版本、来源覆盖、阶段检索与恢复。
- 隔离运行器先通过新Node进程检查os.homedir()；不符合临时HOME则拒绝执行。

源服务未重启、原核心/个人库/真实宿主配置未修改。本次测试未连接真实第三方服务，也未验证所有宿主的新会话接入、模型效果或成本收益。Linux与Node22的在线CI仍待远端执行。

敏感信息、源码完整性与本地文档链接复核结果保存在本次迁移报告；静态扫描无命中不能证明不存在所有隐私类型。
