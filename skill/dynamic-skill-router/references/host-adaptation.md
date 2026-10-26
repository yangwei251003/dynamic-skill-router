# 其他宿主的只读共享核心适配

共享核心：<USER_HOME>/DeskBox/我的桌面/我的资源库/Assets/全局技能/动态技能路由器
Node：C:/Program Files/nodejs/node.exe（先核实存在）
MCP 入口：共享核心/src/mcp-server.mjs；CLI 后备：共享核心/src/cli.mjs。

复用核心功能与复制 Codex 插件包是两回事。支持 stdio MCP 的宿主可以接同一入口；插件市场、规则位置和工具发现机制由宿主自己的适配层实现，不假设能原样安装 Codex 插件。

2026-09-25 只读配置检查发现以下路径均包含 dynamic_skill_router 且指向共享核心：
- WorkBuddy：~/.workbuddy/mcp.json
- Antigravity：~/.gemini/antigravity/mcp_config.json
- Gemini：~/.gemini/settings.json
- Claude：~/.claude.json
- Cursor：~/.cursor/mcp.json

以上不是宿主会话验证，不自动证明当前工具已加载或认证完成。

## 宿主应完成

1. 只读读取共享 README、skill/dynamic-skill-router/SKILL.md、references/capability-routing.md、references/recovery-and-performance.md，以及本宿主实际规则。
2. 复用已存在的 MCP 配置；核实本机 Node/入口、实际可见工具与参数。不要新增重复服务。V3 保留；新行为显式 contractVersion:4。
3. host 使用 codex、workbuddy、antigravity、claude、cursor 或 generic；Gemini 与 Antigravity 接口使用 antigravity。未知宿主用 generic，不捏造标识。
4. 每个新任务开始一次 route_task；已有 routeId/钩子注入则复用。传真实 runtimeSkills/runtimeTools/runtimePlugins；无清单就标为未核实。简单任务走 fast/nativeSufficient；复杂任务按阶段搜索。
5. 新工具有 scan_capabilities、search_capabilities、plan_recovery。工具白名单如需调整，只修改本宿主规则/配置，先备份再读回。不要修改共享核心、注册表、源技能、Codex 插件目录或其他宿主配置。宿主专属脚本可放 ~/.agent-router-adapters/<host>/，复制的适配说明应标注上游来源，避免私有版本冒充共享核心。
6. 如果宿主钩子在主模型获得运行时能力前执行，注入 routeId 后让主模型按需补充 search_capabilities；不要再初始路由。钩子应有短截止时间并失败时回退到原生处理，不能阻塞普通任务。
7. 在本宿主的新会话实测：简单算术走 fast；开发任务选相关技能/工具；模拟低信心生成外部查证计划；复用 routeId；无关工具不调用。只测试路由/只读能力，不为验证而部署、发送或修改真实业务。
8. 如发现核心缺陷，报告复现和建议，由核心维护者统一修复。可以优化自己的包装、缓存和安装流程，但不能改变共享契约、绕过授权或把旧运行时清单当永久状态。
