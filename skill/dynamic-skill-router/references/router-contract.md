# 路由与规划契约（3.0.0）

保持 `NO_SKILL`、`ONE_SKILL`、`COMPOSED`、`selected`、`potential`、`explanation` 的兼容语义。`selected[].path` 指向真实技能目录；`potential` 在激活前只提供入口、阶段、理由与触发条件。路由失败必须开放失败，不阻塞主任务。

宿主必须以 `[动态技能路由器]` 标记公布路由。建议进入执行前，宿主必须作范围、领域和动作检查。未通过的候选不得加载，记录简短跳过原因。通过的立即技能在实际使用前完整读取；潜在技能仅在领域与触发条件均满足后读取。默认最多两个立即技能和三个潜在候选；显式、必要主技能或明确请求的后续能力可超过该数量。

`coordination` 是建议，不扩大权限。复杂度必须含可解释的结构事实，不能由字数、技能数量或匹配次数推断。复杂开发有空槽且有独立工作时，计划应标记为需要原生协作；否则提供明确回退原因。工作项须描述目标、依赖、允许文件或职责边界、验收条件和唯一 writer。委派说明须包含 route ID、相关立即技能路径、范围和约束，子 Agent 复用路由。实际派发前再验证 DAG、writer 冲突和空槽；主 Agent 是最终 integrator。

模型计划只引用运行时实际可用模型。跨模型子 Agent 使用有界上下文 fork；全历史 fork 不做模型覆盖。主 Agent 保持当前模型，后续独立步骤可因失败、冲突或复杂度证据升级。未知能力输出 `null` 或回退理由，不猜测型号、成本或并行能力。

`plan_agents` 仅用于复杂且有可委派工作线的项目任务，使用 `planWorkItems(workItems, options)`。每项至少包含 `id`、`objective`、`dependsOn`、`owner`、`files.read/write`、`acceptance`、`contextRefs`、`role`、`modelPreference`、预算、`attempts`、状态与 `evidence`；`options` 传入真实槽位、授权、可用模型、工作区根路径、路径大小写、修订和重规划限制。结果包含任务、当前就绪任务、后续条件波次、违规、派发准备度、交接契约、关键路径和重规划策略。循环依赖使派发无效；未声明依赖的 writer/writer 或 reader/writer 重叠是错误，必须由主 Agent 声明依赖/交接或缩小范围，规划器不得臆造顺序；完成项必须附证据。规划不可用时由主 Agent 自行核对依赖与边界并继续。规划只做验证和建议，不自动启动 Agent。

只把即将应用的技能正文加载进上下文；按阶段推迟不同领域的后续技能。验证按实际改动和风险选择，避免默认全仓扫描或全量测试。参考：[OpenAI Model guidance](https://developers.openai.com/api/docs/guides/latest-model)。
