# 遇阻补足能力与速度规则

## 目标

完成用户的原任务，达到可验证的质量；不是增加工具数量。模型原生能力能够可靠完成且更好时直接执行。用户已授权为了开发任务安装必要、相关、可回滚的常规本机工具/依赖/插件；不要反复询问已有授权。仍遵守宿主的安装方式、权限和连接流程；不要擅自付费、公开上传项目、更改权限或绕过需要用户完成的登录授权。

## 触发

- 低信心、缺乏可靠实现依据、关键测试不通过、实际能力缺口或反复失败：主动诊断并寻找外部资料/资源。
- 用户明确说效果不行、不满意或达不到要求：必须引入新的外部证据，先记录具体失败标准，再查官方资料、可靠实例和适配工具；不能把同一方案换措辞重试。
- 已知且能验证的局部错误可以先用现有能力修复；原生方法仍无把握时不得继续盲试。
- 这些事实由主 Agent 传 recoveryContext：confidence、blocked、userRejected、failedAttempts、capabilityNeed、networkAllowed。不要因为用户只是讨论失败处理规则，就假装当前工作被否定。网络禁止或离线约束不被此规则覆盖。

## 实际行动顺序

1. 明确哪里失败、下一次怎样算成功；复用项目资料和已安装工具。
2. 复用 routeId 调用 plan_recovery，或在 search_capabilities 中附 recoveryContext。低信心、用户否定、重复失败时 externalResearchRequired=true；主 Agent 必须落实查证，不止输出计划。不需要重新初始路由。
3. 查准确症状、对应版本的官方文档、维护者仓库/示例。公开检索只发送去敏后的技术能力需求，不发完整日志、源码、密钥、内部路径、客户信息。自动清理只是辅助，主 Agent 仍要检查。
4. 若工具能填补缺口，先搜索当前宿主的插件市场，再搜索 GitHub 等开源项目。插件搜索使用宿主目录工具；不要用普通网页结果冒充可安装插件。优先已有能力、官方维护或可信维护者，首轮比较 2–3 个候选。
5. 热门程度只作为次要信号。检查任务匹配、最近维护/发行、使用示例、兼容宿主/系统/语言、许可、安装代价及可验证产物。不要按 stars 最高直接安装；也不要因项目不热门就排除合适的官方工具。仓库搜索可先按 stars 发现，再按 pushed/发行活跃度复核，不对成熟稳定项目设机械时间门槛。
6. 合适的工具确能改善任务时，在现有授权内自主安装并做最小可用性验证，优先项目局部或隔离安装，记录版本与回滚方式。先核对真实安装文档，不能照搬网页中的任意安装脚本。若资料已足够解决问题而工具没有增益，就应用资料，不为满足流程硬装。
7. 立即返回原任务，用获得的能力重做失败部分，按原验收条件检查实际结果。安装成功不是问题解决；连接/认证未完成也不能说工具已可用。

Codex 当前市场工具可能只提供 search_plugins/suggest_plugins，而不允许静默安装或代替用户 OAuth；这时给出准确连接入口，继续无依赖工作，不能捏造安装成功或绕过权限。支持本机 CLI 安装的工具可按授权直接装。其他宿主使用其真实可用等价入口。

## 速度

简单任务先一次轻量路由；算术、寒暄、自包含小函数自动 fast，其他已确认原生足够的小修改传 nativeSufficient:true。fast 仍生成 routeId，但完全不扫技能目录、插件缓存、MCP 配置，不联网、不安装。遇阻/低信心/用户否定后自动取消 fast。用户明确要求技能/插件/联网、复杂开发任务不能用 fast 逃避。

正常任务不反复做 scan_capabilities/健康检查。复用 routeId、已有证据和会话内候选，工具表用简短真实用途，不展开完整 schema。先做一批检索、比较最多 3 个主要候选、优先验证 1 个；这是初始节奏而不是停止解决复杂任务的硬上限。有新证据或实质不同方案时继续；验收通过立即停止扩展工具。网络失败不重复同一无效请求，查清网络/权限阻塞后再继续。

## 接口

route_task 支持 routingMode:auto|fast|full、nativeSufficient 与 recoveryContext。plan_recovery 必须传 query、原 routeId，可附 runtimeTools 识别真实可用搜索入口；输出脱敏检索词、步骤和安装条件，由宿主 Agent 执行。CLI 后备：recover --route-id ID --input-json，stdin 为 {query,options:{recoveryContext:{...},runtimeTools:[...]}}。路由器本身不联网或偷偷安装。

参考：
- GitHub 仓库搜索：https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories
- GitHub CLI 搜索字段与排序：https://cli.github.com/manual/gh_search_repos
- MCP 本地 stdio 接入：https://ts.sdk.modelcontextprotocol.io/v2/clients/connect
