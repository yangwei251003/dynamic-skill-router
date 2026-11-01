# 路由咨询契约 V4

V4 通过 `contractVersion: 4` 显式选择。`route_task` 接收完整用户原文 `query`、真实宿主 `host`、可选 `taskContext` 与当前可证实的运行时信息。宿主提供当前会话 Available skills 清单时，插件条目应以真实 `SKILL.md` 路径作为 `runtimeSkills: [{path, id?, provider?, enabled?}]` 输入。未提供时插件状态未核实；配置 enabled 与缓存不能证明当前启用，一次会话清单也不构成永久启用状态。`taskContext` 仅辅助解释当前事实，不能扩大授权。返回稳定 routeId、候选咨询卡、解释和适用能力信息；宿主负责最终的 `skip / consult / adapt / execute` 决策。路由不得写入日志或修改配置。

后续 `search_skills` 使用同一 routeId，按阶段或具体缺口检索。不得以查询替代新的用户授权，也不得把它当作第二次初始路由。候选卡可以被跳过；实际应用前须完整读取相应技能与当前阶段要求的资料。原生能力与技能建议并列比较，只有后者能改善任务结果时才加载。

协作建议只使用实测可用工具、型号和槽位。有界 `workItems` 应包含目标、依赖、职责/允许文件、唯一 writer、验收条件；不默认需要审查 Agent。V4 查询、卡片和日志不执行 SFT/RL，也不保证成本降低。宿主会话未实测的能力必须注明待验证。

V3 的 `NO_SKILL`、`ONE_SKILL`、`COMPOSED`、`selected`、`potential` 与 `explanation` 语义保持原契约，不得从 V4 卡片含义反推更改。

## V4.0.1 验证修复

MCP 的 route_task 与 search_skills 默认返回 responseDetail: compact；需要完整目录元数据时传 full。精简只缩短候选摘要、解释和来源展示，不裁剪实际技能正文。get_skill 仍完整读取；应用前须读取全部适用约束。候选 ID、分数、可用性、parentId 和 contentHash 保留。CLI 和模块默认 full 保持兼容；已有 --context 入口保持简短。

get_skill 的 purpose 接受 consult/adapt/execute。应将选中候选的 contentHash 传入可选 expectedContentHash；读取时对同一份正文重新计算 SHA-256，发生变化返回 content-hash-mismatch 且不返回正文。先重新评估变更版本，再决定是否读取。未传指纹的旧调用仍可读。

report_outcome 请复用任务 routeId。缺少任务标识的记录只供审计，不计入校准；同一宿主、任务类型、routeId、技能、版本和采用方式仅计一个样本，冲突结论不计分。候选 calibrationByMode 分别展示 consult/adapt/execute 的已验证反馈；只有 consult 的校准影响查阅排序，不把改编/执行的结果混入查阅得分。

明确要求使用带引号的技能名可以识别；当前要求制定未来时间范围的计划也保留检索。示例、引用、否定和未来可能执行的动作不扩大授权。

中文双语术语桥接与去重叠排名仍是实验项，仅模块参数 retrievalProfile: experimental 开启；MCP 和普通宿主默认未开启。真实库对照出现相关 UI 技能由 consult 降为 skip，尚未通过不退化门槛。不得将实验分数解释成任务成功概率。

## 4.2.1 可选接口示例

以下为参数示例；`local_reader` 必须替换为本次真实工具名，description/available/annotations 按当前注册表事实填写，不为通过门槛编造安全注解：

```json
{
  "contractVersion": 4,
  "host": "codex",
  "query": "请读取本地报告，整理三个要点。",
  "taskContext": {
    "capabilityRequests": [{
      "toolNames": ["local_reader"],
      "evidenceRefs": ["读取本地报告"],
      "reason": "需要先取得指定报告内容"
    }]
  },
  "invocationContext": {"mode": "read", "readOnly": true, "networkForbidden": true, "sourceScope": "provided-only", "preserveInputs": true},
  "taskMethods": {"maxCards": 2, "disabledIds": []},
  "qualityProfile": "balanced"
}
```

另传真实 `runtimeTools`。`evidenceRefs` 是同时存在于完整 query 和当前 activeText 的字面片段，不是任意证据编号；引文里的要求不据此变成当前授权。精确名称匹配仅产生独立 `capabilityConsultations`，`available=false` 排除、缺失可用性或效果保持未知，注册不代表来源已读或动作已执行。

`requestContext.rawQuery` 保留原文，`hostInterpretation` 分列宿主解释。`mode` 接受 plan/read/execute；plan/read、readOnly=true、networkForbidden=true、sourceScope、preserveInputs=true 和 allowedActions 只收紧，false/execute 不能取消已有约束。宿主可依据原文把其识别出的全任务来源和输入保护限制放入 invocationContext；这些字段不构成新的用户授权。显式 allowedActions 中不含 network 时，远程访问不在本次允许动作内；未提供列表时不凭缺省推断禁网。纯文本 context 仅在有卡/限制时附简短条件段。

`methodCandidates` 为 0–2 张可拒绝咨询卡；`taskMethods=false` 关闭，maxCards=0 也不选卡。无相关缺口时允许空，已有 fast 不读取目录。qualityProfile 的 economy/balanced/quality 只调整建议阅读预算和核验深度，默认旧预算不变，必要验收与安全约束不省略。

反馈 `report_outcome` 可附真实 `modelId`、`observedAt` 与 `revoked`。后续路由用真实 `currentModel`；直接校准使用 `context.modelId` 与当前 `contentHashes`。只有已采用、有验证/用户证据、同模型和当前内容hash、90天内的独立观察参与有界校准。无日期/模型/当前hash、未来、过期、撤销和冲突仅保留审计，不是模型训练；测试中的固定时间与模型标识只是可复现fixture，不能冒充生产运行事实。

## 4.3 请求证据与能力建议

`requestContext.rawQuery` 仍是用户原文。出现引用、代码或附件上下文时，`sourceSegments` 可用 UTF-16 的 `start/end` 指向原文片段；`boundary: unclosed` 表示无法可靠识别结束位置，宿主应结合原文判断，不能将后续材料当成授权。识别结果是辅助信息，并非完整语言理解或安全边界的替代。

`taskConstraints` 分开表示全任务 `readOnly`、`networkForbidden`、`sourceScope: provided-only` / `specified-site-only` 与 `preserveInputs`。仅用所给资料不自动禁止读取用户提供的 URL；只用指定网站时在该站范围内查证，不凭机构名称猜造域名；保护输入不自动禁止创建用户要求的单独输出。若原文和宿主分别要求这两类来源限制，应同时满足，查看 `sourceScopes` 与交集说明，不得将其当作可任选其一。当前字段仍表示全任务，不能精确表达不同部分各有来源限制；宿主须核对原文并分阶段保守处理。当前范围、结构化宿主限制与用户指令都只能收紧，模型仍需结合原始任务和具体工具检查权限与输入。对未确认副作用的工具不得据名称猜测可安全写入、联网或发送。旧 MCP 进程可能不识别新增输入字段，须核对实际工具 schema 与返回的有效限制。

MCP 的 `openWorldHint: false` 表示工具作用于封闭的交互范围，并不证明工具离线或不访问远程系统。禁网时未知网络效果的候选返回 `defer`，宿主仍可基于实际工具信息确认并使用符合限制的本地能力；路由建议不是网络隔离机制，也不能替代宿主权限控制。

工具候选可能包含 `intentMatches` 与 `inputEvidence`，表示当前动作与工具自述用途的可解释匹配、用户明确给出的输入，不代表已调用、已登录或结果可用。复合任务优先覆盖不同缺口，仍可选择跳过；对于不确定的动作、阶段或效果，应读取精确工具说明并核实范围。当前 `runtimeTools` 注册表证明入口可见；仅由名称清单推断时可用性保持未知，`declaredAvailable` 保留宿主明确声明，认证与业务结果分别为未知。不得用这些候选信息推断认证或实际任务成功。
