# 任务方法库的证据与取舍

核实截止日：2026-10-29。本文区分原作主张、研究结果和本项目的设计推断。方法卡为自主表达；其存在不代表本机产物质量已获验证。

## 原作读取与许可边界

- 来源：[数字生命卡兹克的原始抖音图文](https://www.douyin.com/note/7676403117654641926)，发布日 2026-08-21。用户短链解析为精确作品 ID `7676403117654641926`。
- 公开 feed 没有返回该 ID，因此未使用其推荐作品。Firecrawl 读取精确图文页，确认作者和 16 张图片，再从页面返回的原图地址逐张读取并实际观察全部 16 张。研究过程中仅用内存，未保存原图到公开项目。
- 页码：1 苏格拉底提问；2 双层解释；3 反向拆解；4 纵横分析；5 事实核查；6 专家会诊；7 第一性原理；8 跨领域借解；9 双向钢人；10 最小实验；11–12 天赋探索；13–16 人生设计。
- 这是图文作品，未将其描述为经过全音轨 ASR 或连续视频听审。图文内容已逐页阅读，作者方法的实际效果仍需独立评估。
- [第三方 twelve-prompts 包](https://github.com/hskelp9527-pixel/twelve-prompts) 可作来源线索；其 MIT 说明仅覆盖打包结构、菜单和文档，提示词正文归原作者。本项目未安装该包，不逐字转载十二篇模板，不把第三方提示词误标为本项目原创或 MIT。
- 采用：识别具体缺口、依据事实调整判断、用行动取得反馈。调整：取消固定篇幅、固定提问数和固定专家数。限制：个人探索只在当前用户主动要求时出现，不自动产生个人画像。

## 一手研究

| ID / 来源 | 核实版本或日期 | 支持的设计 | 适用限制 |
| --- | --- | --- | --- |
| `anthropic-agent-evals`：[Demystifying evals for AI agents](https://www.anthropic.com/research/demystifying-evals-for-ai-agents) | 2026-01-09；主任务已打开核实 | 以任务结果、可执行检查和必要人工审视建立验收；真实失败反馈进入修正 | 工程实践不能证明本路由器收益；固定工具轨迹不是唯一正确解 |
| `anthropic-context`：[Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) | 2025-09-29；主任务已打开核实 | 按需组织上下文，保留关键事实，避免无关信息占用 | 具体记忆与加载能力依赖宿主，不能假定全局自动生效 |
| `anthropic-skills`：[Equipping agents for the real world with Agent Skills](https://www.anthropic.com/research/equipping-agents-for-the-real-world-with-agent-skills) | 2025-10-16，含 2025-12-18 更新；主任务已核实 | 按需求逐步发现、读取和应用技能 | 发现技能不等于需要执行；完整适用约束不能被摘要替代 |
| `skillsbench-v4`：[SkillsBench](https://arxiv.org/abs/2602.12670v4) | v4，2026-06-14；本工作项核实摘要 | 在匹配的有无技能条件下比较结果；短小聚焦的技能值得优先考察 | 基准跨域平均收益不能外推到本机每项技能或任意模型 |
| `swe-skills-bench-v2`：[SWE-Skills-Bench](https://arxiv.org/abs/2603.15401v2) | v2，2026-10-27；本工作项核实摘要 | 保留无技能基线和弃用通道；查证技能是否提供遗漏能力 | 研究中多数技能没有显著收益，少数有害；与 SkillsBench 设置不同，不简单合并统计 |
| `clarification-information-gain`：[Uncertainty-Aware Clarification in LLM Agents with Information Gain](https://arxiv.org/abs/2606.03135) | v1，2026-06-02；本工作项核实摘要 | 判断提问是否减少目标不确定性；降低无价值打扰 | 研究训练 clarifier 并在特定环境评估；本项目的提示和规则并未复现训练过程或报告增益 |
| `self-correction-limits`：[Large Language Models Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798) | 初版 2023-10-03；主任务已打开核实 | 避免没有新信息的反复自我批评；重视外部证据 | 不表示任何自查都无价值，模型和任务条件重要 |
| `self-correction-conditions`：[Large Language Models have Intrinsic Self-Correction Ability](https://arxiv.org/abs/2406.15673v2) | v2，2024-12-23；本工作项核实摘要 | 保留自查可有益的条件性反证，避免单边结论 | 摘要强调公平提示和零温度；不保证本宿主当前设置获得相同效果 |
| `agentpoison`：[AgentPoison](https://arxiv.org/abs/2407.12784) | 初版 2024-07-17；主任务已打开核实 | 检索材料及记忆内容不能自动变成可信指令，持久化前核实来源与范围 | 方法建议不是完整的提示注入防御，仍需宿主隔离与安全边界 |

论文结果相异是测试设计需要保留的事实。本文没有将论文指标转写为本项目收益，也没有把来源列举当作方法已被本机实测。

## 本项目的设计推断

1. 十二种方法适合成为可拒绝的建议库。方法不应替代用户目标、宿主判断或专项硬约束。
2. 八项补充机制与原作有重叠，已在 `config/task-methods.json` 的 `deduplication` 中记录。澄清价值与苏格拉底方法同组，参考校准与反向拆解同组；每轮不重复建议同组方法。
3. 普通任务不会因为“优秀”“世界级”“质量高”等形容词自动激活一套流程。触发需要具体缺口、用户明确点名或真实恢复信息。
4. 初始上限为每轮 0–2 张建议卡；这是一项可检验的工程选择，不是论文推荐的固定最优数。允许禁用全部或指定方法以便对照、弃用和回滚。
5. 主动探索的“两线、20%”是本轮获批准的范围上限，不是来源中的科学常数。没有明确资源预算时，不宣称精确测量了百分比；不得用上限推导新授权。
6. 不设置后台常驻、自我训练、自动修改稳定规则或自动发布。新增偏好文本仅写在方法文档供主任务审阅，本工作项不改全局文件。

## 验证范围

`tests/task-methods-v4.test.mjs` 检查方法建议的选择边界、最大数量、相近方法去重、显式禁用、个人场景限制、引用不触发、恢复条件、来源完整性及纯咨询契约。它验证路由行为，不验证最终作品已达世界级。

完整升级仍应使用冻结的旧版基线、同模型同权限的候选对照和未用于调参的真实任务；区分静态检查、方法/路由行为、工具实际执行和最终产物验收。未执行的层次保留 `NOT_TESTED`。
