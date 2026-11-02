# 在自己的 Codex 中完整安装

最省事的方式是把[安装提示词](install-prompt.md)交给目标电脑上的 Codex，让它完成本页流程。本文面向 Codex 桌面版与 CLI 的本地环境；只在 GitHub 云端执行的任务不能替你修改个人电脑配置。

## 移植的范围

移植相同的路由源码和 V4 字段、完整 MCP 接口、CLI 后备、Skill 入口、二十张按需方法卡及通用全局工作规则。当前核心版本见 `src/version.mjs`，本页验证基线为 **4.3.21**；服务名统一为 `dynamic_skill_router`。不需要单独的路由器 API Key。

Skill、MCP、插件和登录状态来自安装者自己的电脑；本机能力盘点随之不同。模型、宿主权限、软件与认证条件会影响实际成果。作者的个人工具库、账号、反馈历史、仪表板和私人插件包装不在公开仓库内；不能承诺另一台电脑的所有业务成果一致。完整接入以以下实际验收为准，不能仅运行演示。

## 1. 取得代码与依赖

使用 Node.js **22+**、npm 和 Git。选择当前用户可写且会长期保留的目录，避免临时下载目录。已有安装先核对 Git 来源、版本和本地修改；不要覆盖另一个项目。

```sh
git clone https://github.com/yangwei251003/dynamic-skill-router.git
cd dynamic-skill-router
npm ci --ignore-scripts
```

记录克隆目录绝对路径为 `ROUTER_ROOT`、实际 Node 可执行文件绝对路径为 `NODE_PATH`。不要把 `NODE_PATH` 设置为全局环境变量，此处只是替换配置的占位名。本页中的占位符都由安装 Agent 替换，不能原样粘贴。

## 2. 配置这台电脑的来源和私有数据

先备份仓库的 `config/skill-sources.json`，再将 `examples/skill-sources.codex.json` 的内容作为本机来源配置。它读取本机 `~/.agents/skills`、兼容旧安装的 `~/.codex/skills`、路由器自身和请求指定项目内的 Skill；缺失目录可以保留为未发现。已有其他合法技能来源按本机实际目录补充，不复制作者路径，不无差别扫描整块磁盘。`${HOME}` 等占位符由路由器展开。

在克隆目录的 `.runtime/user-data` 创建 `skills/` 和 `技能注册表/skills.json`；新安装的注册表内容为：

```json
{"schemaVersion":3,"skills":[],"policy":{}}
```

`DATA_ROOT` 是该 `user-data` 目录的绝对路径；`LOG_ROOT` 可设为同一私有目录下的 `logs`。V4 从来源目录实时发现技能，不必先导入旧注册表；V3 接口仍兼容，但空的本机旧注册表没有技能数据。需要 V3 内容时另按本机既有库登记，不导入作者注册表。

该配置用于标准用户目录。自定义 `CODEX_HOME` 时须核实实际 Skill 路径并修改来源；当前核心对插件清单的静态自动发现主要读取 `~/.codex`，并不完整支持任意自定义配置根。不能为此复制密钥、制造假的默认配置或宣称已验证；继续传当前会话真实 `runtimeSkills` / `runtimeTools`，并如实记录静态发现缺口。

## 3. 接入相同的 MCP 服务

先备份有效的 Codex 配置（通常 `~/.codex/config.toml`，自定义 `CODEX_HOME` 时核对实际路径）。只合并下面的服务块，保留其他服务器、模型、审批和账号设置；发现同名服务应先核对是否本项目，避免覆盖无关服务。不要用旧 `src/host-rules-v4.mjs` 安装全部宿主规则：它还可能写其他宿主文件。

```toml
[mcp_servers.dynamic_skill_router]
command = "NODE_PATH"
args = ["ROUTER_ROOT/src/mcp-server.mjs"]
enabled = true
startup_timeout_sec = 30
tool_timeout_sec = 60

[mcp_servers.dynamic_skill_router.env]
SKILL_ROUTER_DATA_ROOT = "DATA_ROOT"
SKILL_ROUTER_LOG_ROOT = "LOG_ROOT"
```

路径建议使用正斜杠；Windows 的 TOML 双引号中反斜杠必须转义。全部值替换为本机绝对路径。保留所有接口，通常无需 `enabled_tools`；如原有白名单/黑名单限制本服务，核对以下 11 项没有被意外过滤。组织策略或宿主权限不能靠改本项目绕过。

支持该命令的 Codex CLI 也可用 `codex mcp add dynamic_skill_router --env SKILL_ROUTER_DATA_ROOT=... --env SKILL_ROUTER_LOG_ROOT=... -- NODE_PATH ROUTER_ROOT/src/mcp-server.mjs`；执行前读本机 `codex mcp add --help`，正确引用含空格路径，执行后读回有效配置。配置存在不代表当前会话已连接。

## 4. 加载 Skill 与工作规则

将 `skill/dynamic-skill-router/` 安装到当前宿主实际支持的用户 Skill 目录。当前官方约定为 `~/.agents/skills/dynamic-skill-router/`；兼容旧环境时以目标 Codex 的真实发现结果为准。已有同名技能先核对并备份，避免重复安装两份。复制 Skill 不会复制路由核心，需保留仓库和依赖。

读取 [全局规则模板](../examples/codex-global-rules.md)，把 `{{ROUTER_ROOT}}`、`{{DATA_ROOT}}`、`{{LOG_ROOT}}` 替换为本机克隆、私有数据、日志目录后，将其中两个完整标记块合并到当前真正生效的全局指令文件。通常为 Codex 用户目录的 `AGENTS.md`；若有非空 `AGENTS.override.md`，应核实其优先级，不仅修改被覆盖的文件。只合并路由器标记块，保留其余规则，写前重新读最新内容，写后读回。模板含与作者一致的通用路由/质量原则和“深入而不是更大”；不搬运其个人资料和既有授权。CLI 后备也要给子进程传相同的私有环境，不能只在 MCP 配置中设置。

详细方法已包含在 `config/task-methods.json`（十二方法与补充机制，共二十张）；按具体缺口选择 0–2 项，不固定套流程。普通任务先传完整用户请求、`host: codex`、`contractVersion: 4`；当前项目传 `projectRoot`，当前可用插件技能传 `runtimeSkills`、真实工具传 `runtimeTools`。宿主可能将名称显示为 `mcp__dynamic_skill_router__route_task`，这是同一个服务接口。

## 5. 完整验收

先运行私有配置下的直接 CLI，给子进程设置与 MCP 相同的 `SKILL_ROUTER_DATA_ROOT`、`SKILL_ROUTER_LOG_ROOT`：

```sh
node src/cli.mjs health --host codex --contract-version 4
node src/cli.mjs coverage --host codex --contract-version 4
```

不要以 `npm run health/list/demo` 验收本机接入：这些命令故意使用隔离示例。可另运行 `npm run test:all` 和 `npm run test:transfer` 检查公开代码；合成测试不证明目标宿主已加载。

使用宿主支持的刷新方式或新会话完成下面检查，记录 `PASS / FAIL / BLOCKED / NOT_TESTED`：

| 检查 | 必需的证据 |
|---|---|
| 版本与完整接口 | 实际调用 MCP `health_check({host:"codex",contractVersion:4})`，版本与所安装 `src/version.mjs` 一致；宿主能发现下列全部 11 项 |
| 本机 Skill | `list_skills` 显示本机路径；选一个确实存在的本机 Skill，以明确名称路由，在适合它的阶段复用 `routeId` 查询，再用 `get_skill` 与 `expectedContentHash` 读完整正文、核对哈希 |
| 本机外部能力 | 传本会话真实工具清单，用 `search_capabilities` 返回相关精确工具名；配置发现与可调用分开记录。不启动所有专用服务；没有工具时如实记缺口 |
| 快速路径 | 新的简单任务例如 `1+1`，核对 `mode: fast`、`scannedSkills:false`、`scannedCapabilities:false` |
| 方法与恢复 | 复杂任务能返回按需方法建议；同一路线 `plan_recovery` 接收真实能力缺口。模拟阻塞只作测试，不说成真实任务失败 |
| 私有反馈 | 先用 CLI `report-outcome --input-json --dry-run` 校验，再记录一项实际观察结果，核对日志只写 `LOG_ROOT`；未验证可写 `unknown`，未知模型不猜 `modelId`，不能用自评证明改善 |
| 全局规则 | 新会话可读到已替换路径的路由与深入优先原则；普通任务无需再点名路由器。若只完成文件配置，标记“等待新会话验收” |

接口清单：`route_task`、`search_skills`、`get_skill`、`resolve_alias`、`list_skills`、`health_check`、`plan_agents`、`report_outcome`、`scan_capabilities`、`search_capabilities`、`plan_recovery`。MCP `report_outcome` 是实际记录入口；`--dry-run` 是 CLI 参数，不是该 MCP 的字段。

最后交付版本/提交、安装路径、实际来源、修改清单、测试证据及缺口。没有 Skill 或外部工具的新机器不会凭空得到业务能力；可以另外按需安装，但不以安装全部工具作为本项目的验收条件。

## 更新和恢复

更新前保存本机来源配置、私有数据和本次修改的差异；只在干净或已妥善处理本地修改的克隆中更新，不用 `git reset --hard` 清掉个人配置。私有目录不要推送到公共仓库。

需要撤销时只撤销本次增加的 MCP 服务、Skill 和全局标记块；核对后来修改后逐项恢复，不用完整旧配置覆盖后来合法设置，不删除用户自己的工具库或反馈。服务配置、当前宿主连接和业务认证分别核实。

官方依据（核对日期 2026-11-02）：[MCP 配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)、[Skill 目录](https://learn.chatgpt.com/docs/build-skills)、[全局指令优先级](https://learn.chatgpt.com/docs/agent-configuration/agents-md)。本页的发现路径和参数同时依据本项目源码；官方宿主行为变化时以目标版本实测为准。
