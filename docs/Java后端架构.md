# Java 后端架构

## 结论

控制平面使用 Java 17、Spring Boot 4.1.1、PostgreSQL、Flyway 和 S3/MinIO。采集执行面继续使用
TypeScript Worker，因此 OpenCLI、浏览器自动化和 GEO 不需要重写。

这是模块化单体，不是微服务集合：当前只有一个控制平面，先保证事务边界、部署和排错简单；模块之间
通过服务接口协作，后续达到独立扩缩容需求时再拆出调度、工作流或浏览器服务。

当前迁移边界：任务、调度、Worker、项目/来源、工作流状态机、PostgreSQL 治理、GEO、受控浏览器、
Skill 版本/Trace/人工确认/自评/纠错、企业 OIDC、Dify 安全导入、PAT Bearer 鉴权与 MCP tool call
都已进入 Java 主链路。旧 TypeScript 控制面已从仓库移除。

## 为什么暂不使用 Spring Cloud

Spring Cloud 解决配置中心、服务发现、网关、熔断和分布式消息等微服务问题。当前系统只有一个 Java
控制平面，执行 Worker 通过稳定 HTTP 协议注册和抢单，引入注册中心和 Gateway 不会增加业务能力，
反而会增加进程数、配置、网络故障面和版本兼容成本。

真正出现以下条件时再引入：

- 调度、工作流、身份或浏览器控制需要独立发布和扩缩容；
- 服务间调用超过单进程模块调用，需要统一发现、熔断与追踪；
- 多环境配置已无法由 Secret/环境变量可靠管理；
- 外部 API 数量和流量需要独立网关治理。

届时使用与 Spring Boot 对应的 Spring Cloud Release Train，并优先增加 Gateway、Config 和
Circuit Breaker；不为展示技术栈而引入 Eureka、Nacos、Kafka 或 Redis。

## 核心链路

```text
React/Vite → Spring Security → REST Controller
                              ↓
                    PostgreSQL + Flyway
              任务 / 工作流 / Skill / 租约 / 审计
                              ↓ HTTP
                 TypeScript Worker 资源池
                 OpenCLI / Browser / GEO
                              ↓
                    MinIO / S3 报告制品
```

任务抢占使用 `SELECT ... FOR UPDATE SKIP LOCKED`，完成回报使用 Worker 身份、任务状态和所属节点
做条件更新。GEO 额外使用 30 秒租约、心跳续租和迟到结果隔离。浏览器动作采用 AES-GCM 加密，
报告和 Trace 进入对象存储，元数据与状态进入 PostgreSQL。

## Agent Skill 治理闭环

Skill 使用 `(owner, domain, capability)` 唯一标识，正文保存 `SKILL.md`，结构化字段保存前置条件、步骤、
里程碑、完成条件、伪完成状态、恢复策略、防漂移边界和红线。每次修改生成不可变 `skill_versions` 快照；
运行事件按 sequence 幂等追加，并汇总为 `journey_trace_v1`。

完成结果必须用声明的 terminal conditions 进行落地校验。连续三次非基础设施失败才会生成纠错提案；
网络/CDP 错误不参与 Skill 缺陷判断。纠错由人工提交完整候选 Skill 后发布，可驳回并可回滚到历史快照。
风险策略保持纯函数：读、导航和提取默认放行；写动作含 submit/pay/post/delete 时确认；Skill 红线即使
开启 auto-confirm 也不得绕过。

Agent 节点会创建独立、带租约的 `skill_runs`，Worker 使用受限动作协议驱动 CDP。导航、读取和提取可自动
执行；点击、输入及写动作按风险策略进入 `awaiting_confirmation`，批准只对当次精确动作生效。Worker
离线或租约超时会自动重排，达到最大尝试次数后终止并推进工作流失败状态，避免检查点永久悬挂。

## 可观测性与恢复

每个 HTTP 请求返回 `X-Request-Id` 并写入 MDC；Actuator 暴露健康探针，Prometheus 提供 HTTP 延迟、
任务队列、工作流、Skill 待确认、节点在线和投递结果指标。定时恢复器处理离线节点、过期浏览器会话、
僵尸浏览器动作、过期 Skill 租约和未完成的工作流终结器。业务状态以 PostgreSQL 为事实源，重启不会
依赖进程内存还原运行状态。

## 面试时可以讲的取舍

- 为什么用 JDBC 而非 JPA：抢单和租约依赖行锁、条件更新与批量 upsert，显式 SQL 的并发语义更清楚。
- 为什么用 Flyway：数据库结构由不可变版本迁移治理，启动时可审计，避免运行时偷偷建表。
- 为什么用 PostgreSQL：支持行锁、`SKIP LOCKED`、约束、事务和未来的 JSONB/全文检索扩展。
- 为什么不用 Redis 队列：PostgreSQL 已是事实源，当前吞吐量下数据库队列减少双写一致性问题；达到瓶颈再引入消息队列。
- 为什么先模块化单体：业务边界还在变化，单体事务和调试成本低；保留 API/模块边界后再按负载拆服务。
