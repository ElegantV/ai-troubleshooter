# 后端技术架构（v0.4 企业级重构落地）

> 对应版本：v0.4（NestJS + TypeScript + PostgreSQL + Redis/BullMQ + JWT/RBAC）。本文为当前架构现状 + 剩余演进路线。

## 〇、技术栈总览（现状）

| 层 | 选型 | 落地位置 |
|---|---|---|
| 语言/运行时 | **TypeScript + Node.js 22+ (LTS)** | `src/` 全 TS |
| Web 框架 | **NestJS**（按域模块化） | `src/app.module.ts` + agent/knowledge/case/auth/audit/collector |
| 数据库 | **PostgreSQL 17** + knex 版本化迁移 | `src/infra/database/migrations/` |
| 图查询 | **PG 递归 CTE**（多跳血缘/链路遍历） | `src/agent/graph-query.service.ts` |
| 队列/调度 | **Redis + BullMQ** 定时采集（10 分钟） | `src/collector/scheduler.service.ts` |
| 认证 | **JWT + RBAC**（user/admin），SSO 适配器预留 | `src/auth/`（`AuthProvider` 接口：OIDC/LDAP） |
| 检索 | BM25 + 实体加权（`SEARCH_ADAPTER` 接口，可换 pgvector/ES） | `src/agent/retrieval.service.ts` |
| API 治理 | `/api/v1` + 统一包络 `{code,data,error}` + OpenAPI/Swagger | `main.ts` + `src/common/` |
| 配置 | 环境变量化，生产接 Nacos/Apollo + KMS | `src/config/configuration.ts` |
| 测试 | vitest 单测（核心 >80% 行覆盖）+ 无头 e2e 冒烟 | `src/**/*.spec.ts`、`scripts/debug-page.cjs` |
| 交付 | Docker 多阶段 + docker-compose（pg+redis+backend） | `Dockerfile`、`docker-compose.yml` |

前端：Vue 3 + Element Plus（`frontend/`，Vite 构建产物 `public/` 由后端静态托管）。

## 一、当前架构（分层与数据流）

```
Vue3 SPA (frontend/, 构建产物 public/，经 store.js 统一解包 {code,data,error})
   │  REST (JSON, JWT Bearer)  /api/v1/*
NestJS 应用层 (src/main.ts + app.module.ts)
   ├─ 全局：ValidationPipe / JWT+RBAC Guard / 统一包络拦截器 / 全局异常过滤器 / Swagger
   ├─ auth/       注册·登录·JWT签发校验·操作归属（AuthProvider 可切 SSO）
   ├─ agent/      智能体编排：workflow 固定工作流
   │   输入理解(entityExtract) → 场景路由 → 规则归因(rules) / 存储过程静态分析(procAnalysis)
   │   → 案例检索(retrieval, BM25+实体加权) → 验证SQL(verifySql) → 报告组装 → (LLM增强,默认关闭) → 审计落库
   │   图查询 graph-query.service（PG 递归 CTE）
   ├─ knowledge/  /meta /dict /graph /demos + /api/health 探活
   ├─ case/       案例录入·列表·删除(admin)
   ├─ audit/      /queries 排查历史（审计留痕可视化）
   └─ collector/  采集服务（data/raw 模拟源）+ BullMQ 定时调度 + POST /admin/collect(admin)
知识/存储层 PostgreSQL：meta_tables/columns、jobs、job_deps、proc_lineage、table_lineage、
   batch_logs、job_runs、error_codes、tickets、cases、query_log、users（含 role）
离线加工层 src/collector/：collect.ts（采集）→ parse-ddl.ts / parse-lineage.ts（血缘解析+图融合）
```

## 二、关键设计资产（重构后保留的核心）

| 设计 | 位置 | 价值 |
|---|---|---|
| 可解释归因：候选原因带 0-10 分 + 证据引用 | `rules.service.ts` | 银行场景核心要求，LLM 方案短期给不出这种可审计性 |
| 图遍历与归因解耦，多跳走 PG 递归 CTE | `graph-query.service.ts` | 替换内存 BFS 后查询即生产能力；换图库只需改一处 |
| 案例检索 = BM25 + 实体加权（错误码+3/作业+2.5/表+2） | `retrieval.service.ts` | 打分公式显式可调；`SEARCH_ADAPTER` 接口可切 pgvector/ES 混合检索 |
| 数据飞轮：反馈确认 → 自动沉淀案例 | `workflow.service.ts saveFeedback` | 知识资产随使用增长，重建不丢 |
| 全程审计 + 操作归属 | `query_log.user_name` / `cases.created_by` | 合规刚需；/queries 已可视化 |
| LLM 适配层默认关闭、规则引擎为骨架 | `llm.service.ts` / `workflow.service.ts` | 接入 LLM 是"增强"而非"依赖"，故障可降级 |

## 三、已落地治理项

### v0.3 基础治理（B1-B6）
| 项 | 说明 |
|---|---|
| B1 重建保留飞轮数据 | 采集只刷新知识表，cases/query_log/users 保留 |
| B2 SQLite WAL（v0.4 已被 PostgreSQL 取代） | 历史项 |
| B3 排查历史 API | /queries 分页 + 报告复看 |
| B4 请求/错误规范 | 统一 JSON 404 / 500 |
| B5 反馈参数校验 | query_id UUID + helpful 枚举 |
| B6 探活 | /api/health |

### v0.4 阶段一 + 阶段二落地
| 项 | 说明 |
|---|---|
| SQLite → PostgreSQL + 版本化迁移 | knex migrations；`node:sqlite` 仅存在于一次性迁移脚本 |
| 服务壳 TS 化 + NestJS 模块化 | 按 agent/knowledge/case/auth/audit/collector 分域 |
| 图查询迁 PG 递归 CTE | jobUpstream/Downstream、tableUpstream/Downstream |
| API v1 + 统一包络 + OpenAPI | `/api/v1` + `{code,data,error}` + Swagger `/api/docs` |
| JWT + RBAC + SSO 适配器 | roles: user/admin；AuthProvider 预留 OIDC/LDAP |
| BullMQ 定时采集 | 默认 10 分钟刷新知识库 |
| 检索 BM25 保留为 SearchService 接口 | SEARCH_ADAPTER 可换 pgvector/ES |
| 配置环境变量化 | 无明文密钥；生产接 Nacos/Apollo + KMS |
| vitest 单测 | 整体行覆盖 80.4%（rules 89.9% / retrieval 97.4% / entityExtract 100%） |
| Docker 多阶段 + compose | postgres + redis + backend 一键起 |

## 四、剩余演进路线（阶段三 + 建议）

- **阶段三（平台化，后续增量）**：
  - LLM 网关接入（归因复核、动态 SQL 血缘解析兜底——`workflow.service.ts` 已预留调用点）
  - 归因质量评测集（固定 50 个历史故障输入，归因命中率作回归指标）
  - 多团队知识库隔离；审计对接行内合规平台
- **持续完善建议**：
  - 可观测：pino 结构化日志 + OpenTelemetry（或行内 SkyWalking）+ Prometheus 指标，补 requestId 贯穿前后端
  - 检索上线 pgvector：向量召回 + 现有实体加权重排（混合检索）
  - CI/CD：接入行内流水线（vitest + Docker 构建 + 契约测试）
  - 限流/熔断、sessions 服务端续期等运营能力

## 五、若行内强制 Java 技术栈

服务壳用 Spring Boot 3 重写（Controller/Service/Mapper + MyBatis-Plus），**领域逻辑按模块平移**：`rules.service.ts` 的归因规则改策略模式 + 规则表驱动、递归 CTE 直接沿用 PG、`retrieval.service.ts` 的 BM25 被 ES 替代（反而省事）。前端 Vue3 产物不受影响。重写成本主要在规则引擎回归验证——再次说明阶段三的"评测集"应尽早建。

## 六、明确不建议做的

- **一上来微服务 + K8s 全家桶**：单模块应用，单体 + Docker 足够支撑到几十个团队使用
- **现在引入 Neo4j / Kafka**：数据规模和吞吐都差数量级，运维成本先于收益
- **用 LLM 替换规则引擎**：正确姿势是"规则生成候选 + LLM 复核排序"，可解释性不能丢
- **在 API 未冻结前生成前端客户端代码**：先联调稳定，再定 /api/v1