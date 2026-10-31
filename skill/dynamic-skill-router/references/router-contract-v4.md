# 路由咨询契约 V4

V4 通过 `contractVersion: 4` 显式选择。`route_task` 接收完整用户原文 `query`、真实宿主 `host`、可选 `taskContext` 与当前可证实的运行时信息。宿主提供当前会话 Available skills 清单时，插件条目应以真实 `SKILL.md` 路径作为 `runtimeSkills: [{path, id?, provider?, enabled?}]` 输入。未提供时插件状态未核实；配置 enabled 与缓存不能证明当前启用，一次会话清单也不构成永久启用状态。`taskContext` 仅辅助解释当前事实，不能扩大授权。返回稳定 routeId、候选咨询卡、解释和适用能力信息；宿主负责最终的 `skip / consult / adapt / execute` 决策。路由不得写入日志或修改配置。

后续 `search_skills` 使用同一 routeId，按阶段或具体缺口检索。不得以查询替代新的用户授权，也不得把它当作第二次初始路由。候选卡可以被跳过；实际应用前须完整读取相应技能与当前阶段要求的资料。原生能力与技能建议并列比较，只有后者能改善任务结果时才加载。

### 结构化能力缺口（4.3 候选）

宿主已理解的具体缺口可作为 `taskContext.capabilityRequests` 提供，不必再次压成关键词。每项需要 `purpose`、非空 `evidenceRefs`，以及 `role` 或 `toolNames` 中至少一个。`evidenceRefs` 精确引用同一次 `taskContext.evidence` 条目的 `reference`；引用只建立来源联系，不证明该断言正确，更不授予权限。

`role` 为 `local-execution / public-web-access / image-generation / image-observation / document-runtime / interface-observation / compilation-diagnostics`。角色只匹配工具真实用途；`toolNames` 只匹配当前运行时的精确名称。两者同时提供时必须同时匹配。每次最多 10 项缺口，每项最多 10 个名称；无需为没有缺口的任务填写。

```json
{
  "taskContext": {
    "evidence": [{"source":"user","reference":"input-data","claim":"用户要求只读指定本地数据并解释异常"}],
    "capabilityRequests": [{"role":"local-execution","purpose":"读取指定源文件并在聊天返回统计","evidenceRefs":["input-data"]}]
  },
  "invocationContext": {"phase":"validation","readOnly":true,"networkForbidden":true}
}
```

原文完整保存在 `task.originalRequest`。能力缺口在 `task.capabilityRequests` 与 `hostCapabilityCoverage` 单独呈现，不改变用户 `explicit` 点名、不永久保存运行时清单、不确认认证或联网可用。未知名称、缺少用途、证据引用不成立和不可用状态都有明确 unresolved 记录。指向另一个任务的旧工具条目不能替代当前元数据。

`invocationContext.mode: plan`、`readOnly: true`、`networkForbidden: true` 只收紧范围；false 不解除用户原文的限制。建议可能保留为 `defer / skip / discover-first / check-scope`。宿主核对原文、输入、受保护对象及准确 schema 后决定调用，不因建议重复索要已有授权。没有能力缺口且原生足够时仍使用 `nativeSufficient:true`；有效缺口存在时不能同时靠它跳过发现。

协作建议只使用实测可用工具、型号和槽位。有界 `workItems` 应包含目标、依赖、职责/允许文件、唯一 writer、验收条件；不默认需要审查 Agent。V4 查询、卡片和日志不执行 SFT/RL，也不保证成本降低。宿主会话未实测的能力必须注明待验证。

V3 的 `NO_SKILL`、`ONE_SKILL`、`COMPOSED`、`selected`、`potential` 与 `explanation` 语义保持原契约，不得从 V4 卡片含义反推更改。

## V4.0.1 验证修复

MCP 的 route_task 与 search_skills 默认返回 responseDetail: compact；需要完整目录元数据时传 full。精简只缩短候选摘要、解释和来源展示，不裁剪实际技能正文。get_skill 仍完整读取；应用前须读取全部适用约束。候选 ID、分数、可用性、parentId 和 contentHash 保留。CLI 和模块默认 full 保持兼容；已有 --context 入口保持简短。

get_skill 的 purpose 接受 consult/adapt/execute。应将选中候选的 contentHash 传入可选 expectedContentHash；读取时对同一份正文重新计算 SHA-256，发生变化返回 content-hash-mismatch 且不返回正文。先重新评估变更版本，再决定是否读取。未传指纹的旧调用仍可读。

report_outcome 请复用任务 routeId。缺少任务标识的记录只供审计，不计入校准；同一宿主、任务类型、routeId、技能、版本和采用方式仅计一个样本，冲突结论不计分。候选 calibrationByMode 分别展示 consult/adapt/execute 的已验证反馈；只有 consult 的校准影响查阅排序，不把改编/执行的结果混入查阅得分。

明确要求使用带引号的技能名可以识别；当前要求制定未来时间范围的计划也保留检索。示例、引用、否定和未来可能执行的动作不扩大授权。

中文双语术语桥接与去重叠排名仍是实验项，仅模块参数 retrievalProfile: experimental 开启；MCP 和普通宿主默认未开启。真实库对照出现相关 UI 技能由 consult 降为 skip，尚未通过不退化门槛。不得将实验分数解释成任务成功概率。
