# Dynamic Skill Router

本分支归档 **4.3.0-rc.17 可移植候选源码**，仍在测试中，**没有切换生产 4.2.0**。本次增加带来源引用的宿主能力建议契约，修复当前工具状态、给定材料呈现及只读/禁网范围处理。41项基础检查、408项专项检查与公开示例通过；实际成果质量和生效范围见 [RC17 验证记录](docs/v43-rc17-verification.md)。

RC17 的8道新短题共42次真实尝试、126项必达检查全部通过；旧版和候选均分99.375，最小路由100，未证明成果提高5分。新增结构化能力字段在这批模型调用中未被实际采用，宿主输入边界和原生工具观测限制另有记录，完整发布仍为 **NOT_READY**。此前 [RC16成果与失败](docs/v43-rc16-artifacts.md)、[RC16状态](docs/v43-rc16-status.md)、[RC10状态](docs/v43-rc10-status.md)及[早期评测](docs/v43-evaluation.md)按原版本保留。

面向 AI 编程工具的本地技能与能力路由器。面对一个任务，它先区分当前请求、未来想法和明确限制，再把相关 Skill、插件或 MCP 工具整理成咨询卡，供宿主决定是否查阅或采用。

它提供 CLI 与 stdio MCP 两个入口，也支持在同一 `routeId` 下继续按阶段检索。路由结果不会自行操作外部工具或扩大用户授权。

![源码架构示意](docs/architecture.svg)

> 图按本项目实际模块生成，是架构示意，不是运行界面截图。

## 功能

- 发现配置来源中的 Skill，记录来源、重复项、失效链接、版本哈希及覆盖情况。
- V4 咨询卡区分 `skip / consult / adapt / execute`；支持显式技能名称、阶段查询和同一任务复用。
- 联合处理宿主提供的 `runtimeTools`、插件元数据和只读配置清单；配置存在不等于当前可调用。
- 简单任务可走原生快速路径；遇阻时生成可核验的恢复与资料查询建议。
- MCP 接口提供发现、读取、路由、阶段查询、协作规划及反馈记录；不执行被推荐的业务工具。

## 技术栈

Node.js **22+**、ES modules；锁定依赖 `@modelcontextprotocol/server`、`smol-toml`、`zod`。MCP 集成测试使用 `@modelcontextprotocol/client`。本仓库不需要云端 API Key。

## 快速上手

```powershell
git clone --branch codex/router-v43-evaluation --single-branch https://github.com/yangwei251003/dynamic-skill-router.git
cd dynamic-skill-router
npm ci --ignore-scripts
npm run health
npm run list
npm run demo
```

三个演示命令使用专用的临时 `SKILL_ROUTER_HOME` 与日志目录，再启动子进程；保留系统 HOME 和 CODEX_HOME。默认仅扫描仓库自带的两个原创示例 Skill 和路由器自身 Skill；不连接第三方服务，不读取你的个人技能库、账号配置或历史记录。输出中的本地路径属于你自己的克隆目录。

`npm run demo` 应返回 `ok: true`，并选出 `example-code-review`。`examples/runtime-tools.json` 是合成元数据，仅展示数据格式，不是真实会话工具清单，也不代表示例工具可被执行。

### 直接使用 CLI

```powershell
node src/cli.mjs route '使用 example-code-review 审查代码' --host generic --contract-version 4 --dry-run --context
node src/cli.mjs health --host generic --contract-version 4
```

省略 `--contract-version 4` 会保留原 V3 兼容行为。若要传入完整 JSON，可以通过标准输入使用 `--input-json`，不要把私人信息拼接进 shell 命令。

### MCP 接入

需要支持 stdio MCP 的 AI 工具。命令为 `node`，参数为你本机克隆目录中 `src/mcp-server.mjs` 的**绝对路径**。Codex 的安全示例见 [mcp-config.toml](examples/mcp-config.toml)；替换 `CORE_PATH` 后，手工合并该段到自己的有效配置，保留其他设置。

启动脚本只提供本地 MCP 服务，不自带网络部署或宿主账户。使用 `host: generic` 时默认读取仓库示例来源；选择 `host: codex` 或显式指定配置来源，可能只读检查对应机器的配置与插件登记。真实宿主应提供本次会话的 `runtimeSkills` 和 `runtimeTools`；复制示例元数据不能证明工具在线。

## 配置自己的技能来源

1. 先阅读 [配置说明](docs/configuration.md)。
2. 将自己有权使用的 Skill 目录加入 `config/skill-sources.json`，或通过代码 API 的 `sources` 参数显式传入。
3. 用 `health/list/coverage` 检查覆盖情况，再进行路由。
4. 不把自己的技能注册表、配置、反馈、日志或技能正文提交到此公共仓库。

## 目录结构

```text
src/                  CLI、MCP、发现、路由、恢复与维护源码
skill/                路由器本身的Skill入口与契约
config/               通用示例来源与未知状态宿主模板
examples/             原创示例Skill、示例注册表和合成工具元数据
scripts/              隔离运行和无外部动作的演示
tests/                可移植的既有回归与MCP测试
docs/                 结构示意、配置和验证范围
```

原机器的能力仪表板、第三方 Skill 全文、个人注册表、真实账号配置、运行日志、反馈和历史请求回放未收录。排除范围见 [PROVENANCE.md](PROVENANCE.md)。

## 验证

```powershell
npm test
npm run test:v43
```

测试使用路由器专用的临时目录和合成输入，不执行被建议的业务工具。RC17公开副本已在本机独立验证，远端CI须按对应提交另查，见 [验证记录](docs/v43-rc17-verification.md)。公开副本保留便携路径与合成元数据适配，不能照搬私人候选的结果。这些检查不替代独立保留集、真实宿主接入或最终成果对照。

## 4.3 候选改动

- 保留原始请求；区分引用、宿主解释与执行限制。新增验收条件、能力缺口和证据引用字段。
- 按请求动作、输入与输出对象、工具主要用途判断建议；支持同一服务中的读取与写入区分，显式禁网约束单独保留。
- 完整给定材料的简单聊天操作可直接采用原生路径；额外文件、外部动作、点名能力和恢复需求仍需单独判断。
- 中文整词匹配、适用领域与明确排除条件约束；保留显式点名及 V3 接口。
- [十二方法与八类补充机制](skill/dynamic-skill-router/references/task-methods.md) 按缺口建议 0–2 张卡，允许完全不用，不增加固定问卷或角色数量。
- 质量档位影响建议阅读与验证深度，不承诺产物质量；[研究依据](references/research-evidence.md) 保留结论边界。
- 反馈区分型号、版本、采用方式、证据、过期与撤销；全局规则新增内容保持简短，插入和恢复均保护其他并发更新。

只发布候选代码、原创方法概括与可移植测试。本分支不包含私人运行时清单、全局规则快照、任务反馈、原作全文或账户配置。

## 维护边界

`src/` 保留旧版同步、宿主规则安装与恢复源码，供维护者按需使用。这些维护入口可能写文件；演示和 `npm test` 不会把它们应用到真实用户目录。公开的宿主模板默认 `syncManaged/catalogManaged=false`、模型与能力未知。不要未经核实就把旧机的能力状态复制到新机器。

## 更新与许可

见 [CHANGELOG.md](CHANGELOG.md)。自有代码与文档采用 [MIT](LICENSE)；依赖许可与来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [PROVENANCE.md](PROVENANCE.md)。
