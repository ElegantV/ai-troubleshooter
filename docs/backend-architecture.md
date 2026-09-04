# 后端技术架构分析与企业级演进路线

> 对应版本：v0.3（Vue3 前端 + Express + SQLite）。本文分两部分：现状架构分析、企业级技术栈调整路线。

## 一、现状架构分析

### 1.1 分层与数据流

```
Vue3 SPA (frontend/, 构建产物 public/)
   │  REST (JSON, Bearer Token)
Express 应用服务层 (src/server/app.js)
   ├─ 开放接口：/api/register /api/login /api/logout /api/me /api/health
   ├─ 鉴权中间件 requireAuth（src/auth.js，Bearer → sessions 表）
   └─ 业务接口：troubleshoot / feedback / cases / queries / meta / dict / graph / demos
智能体编排层 (src/agent/workflow.js)：固定工作流
   输入理解(entityExtract) → 场景路由 → 规则归因(rules) / 存储过程静态分析(procAnalysis)
   → 案例检索(retrieval, BM25+实体加权) → 验证SQL(verifySql) → 报告组装 → (LLM增强, 默认关闭) → 审计落库
知识/存储层 (src/agent/graphQuery.js)：SQLite 单库
   元数据/血缘/作业DAG/日志/工单/案例/审计/用户 会话 共 12 张表；图数据加载进内存做 BFS
离线加工层 (src/pipeline/build.js)：采集(collectors) → DDL/DAG/日志/工单入库 → 存储过程血缘解析
```

### 1.2 关键设计点（值得保留的资产）

| 设计 | 位置 | 价值 |
|---|---|---|
| 可解释归因：每条候选原因带 0-10 分 + 证据引用 | rules.js | 银行场景的核心要求，LLM 方案短期给不出这种可审计性 |
| 图遍历与归因解耦 | graphQuery.js | BFS 多跳上下游/生产消费查询是纯函数，迁移图数据库时只需换实现 |
| 案例检索 = BM25 + 实体加权（错误码+3/作业+2.5/表+2） | retrieval.js | 打分公式显式可调；向量检索上线后可作为混合检索的加权层 |
| 数据飞轮：反馈确认 → 自动沉淀案例 | workflow.js saveFeedback | 知识资产随使用增长；B1 修复后重建不丢 |
| 全程审计 + 操作归属 | query_log.user_name / cases.created_by | 合规刚需；/api/queries 已将其可视化 |
| LLM 适配层默认关闭、规则引擎为骨架 | llm.js / workflow.js | 接入 LLM 是"增强"而非"依赖"，故障可降级 |

### 1.3 现状局限（企业级视角的差距）

1. **node:sqlite 是实验性 API**（Node 22+ 标注 experimental），生产不可接受——这是最硬的技术门槛
2. **单进程单连接**：图数据常驻内存，无法水平扩展；写入靠 WAL+busy_timeout 缓解，但本质仍是单机
3. **无版本化 API 契约**：响应形状散落在各 handler，前后端靠口头约定
4. **配置硬编码**：config.js 对象字面量，无环境覆盖、无密钥管理
5. **测试仅有冒烟脚本**：规则引擎/检索打分无单测保护，改公式靠人肉回归
6. **采集是手动触发**：知识库新鲜度依赖人工 build，与"跑批当日出问题当日查"的诉求冲突

## 二、企业级技术栈调整路线

### 2.1 总体判断

**原型的价值在领域逻辑（归因规则/图遍历/检索打分/飞轮闭环），不在框架。企业化 ≠ 重写，而是"保逻辑、换地基"，分三阶段走。** 若行内规范强制 Java 技术栈，见 2.4 分支方案。

### 2.2 分层选型建议

| 层 | 现状 | 企业级目标 | 理由 |
|---|---|---|---|
| 语言/运行时 | Node.js 25 + JavaScript | **保留 Node，全面 TypeScript** | 2000 行领域逻辑可平移；类型系统是团队协作与重构的底线。node:sqlite 移除后 Node 版本可锁定 LTS |
| Web 框架 | Express 5 | **NestJS**（或轻量选 Fastify + 手工分层） | DI 容器、Guard（鉴权）、Interceptor（审计/耗时）、OpenAPI 装饰器开箱即用；Express 中间件风格在 30+ 接口后失控。当前 route 动态挂载已是向集中注册的过渡 |
| 数据库 | SQLite（实验性） | **PostgreSQL 14+**（或行内 MySQL/OceanBase/TDSQL）+ 版本化迁移工具 | 生产硬门槛。血缘/作业DAG 用**递归 CTE** 承载，数千表×万级边的规模完全够用，免运维图库 |
| 图查询 | 内存邻接表 BFS | 先迁 PG 递归 CTE；表 >1万 或跳数需求 >4 再评估 Neo4j | 避免为选型引入图库——当前 8 表 7 作业的规模差两个数量级 |
| 检索 | 自实现 BM25（内存） | **PG 全文检索（zhparser）起步 → ES/OpenSearch + pgvector（RAG）** | README 既定路线。pgvector 让关键词+向量在同一库，混合检索（向量召回 + 现有实体加权重排）是 LLM 检索的最优解 |
| 任务调度 | 手动 npm run build | **BullMQ**（Node 栈）/ xxl-job（Java 栈）定时采集 | 日志/作业状态每 10 分钟增量刷新 `job_runs`/`batch_logs`；"当日问题当日查"靠这个保证 |
| 认证 | 自研用户名密码 + SQLite session | **行内 SSO（OIDC/CAS/LDAP）+ JWT + RBAC 角色表** | src/auth.js 已预留替换点：register/login 换 SSO 回调，requireAuth 校验 JWT，新增 role 字段控制案例删除/工单管理等管理面 |
| 配置/密钥 | config.js 字面量 | 环境变量 + **Nacos/Apollo 配置中心**，密钥入 KMS | LLM apiKey、数据库连接绝不入库入仓 |
| 可观测 | console.error | **pino 结构化日志 + OpenTelemetry（或行内 SkyWalking）**，保留 /api/health，暴露 Prometheus 指标 | query_log 审计已就位，补 requestId 贯穿前后端日志 |
| API 治理 | 无版本、形状松散 | **/api/v1 前缀 + 统一包络 {code,data,error} + OpenAPI 文档 + 分页/限流规范** | 等本次 Vue 前端联调稳定后冻结 v1，配合 openapi-typescript 生成前端类型 |
| 测试/交付 | test_api.js 冒烟 | **vitest 单测**（规则归因、检索打分必保）+ supertest 契约测试 + **Docker 多阶段构建** + CI/CD | 归因公式是核心资产，改一个系数必须有测试报警 |

### 2.3 三阶段演进路径

- **阶段一（1-2 周，消除硬门槛）**：SQLite → PostgreSQL（knex 或 Prisma 做迁移管理）；移除 node:sqlite；服务壳 TS 化；现有 B1-B6 类治理项补完；Docker 化（前端构建产物 + 后端单镜像）
- **阶段二（1-2 月，结构化升级）**：NestJS 按域重排模块（agent / knowledge / case / auth / audit 各自成 module）；SSO + RBAC；API v1 冻结 + OpenAPI；BullMQ 定时采集真实调度系统/日志平台；检索迁 PG FTS → pgvector；单测覆盖率 >70%（核心是 rules.js 与 retrieval.js）
- **阶段三（平台化）**：LLM 网关接入（归因复核、动态 SQL 血缘解析兜底——workflow.js 已预留调用点）；归因质量评测集（固定 50 个历史故障输入，归因命中率作为回归指标）；多团队知识库隔离；审计对接行内合规平台

### 2.4 若行内强制 Java 技术栈

服务壳用 Spring Boot 3 重写（Controller/Service/Mapper + MyBatis-Plus），**领域逻辑按模块平移**：rules.js 的归因规则改为策略模式 + 规则表驱动、graphQuery.js 的 BFS 改 Neo4j 或 PG 递归 CTE、retrieval.js 的 BM25 直接被 ES 替代（反而省事）。前端 Vue3 产物不受影响。重写成本主要在规则引擎回归验证——这也再次说明阶段三的"评测集"应该尽早建。

### 2.5 明确不建议做的

- **一上来微服务 + K8s 全家桶**：单模块应用，单体 + Docker 足够支撑到几十个团队使用
- **现在引入 Neo4j / Kafka**：数据规模和吞吐都差数量级，运维成本先于收益
- **用 LLM 替换规则引擎**：正确姿势是"规则生成候选 + LLM 复核排序"，可解释性不能丢
- **在 API 未冻结前生成前端客户端代码**：先联调稳定，再定 /api/v1

## 三、本次（v0.3）已落地的治理项

| 项 | 说明 |
|---|---|
| B1 重建保留飞轮数据 | build.js 不再删除 DB 文件，只刷新知识表（cases/query_log/users 保留） |
| B2 SQLite WAL | 读写并行 + busy_timeout=5000，团队并发录入不阻塞查询 |
| B3 排查历史 API | GET /api/queries（分页）+ /api/queries/:id（报告复看），前端"排查历史"页签 |
| B4 请求/错误规范 | json limit 256kb；未知 /api 返回 JSON 404；全局错误中间件统一 500 格式 |
| B5 反馈参数校验 | query_id UUID 格式校验 + helpful 枚举校验 |
| B6 探活 | 开放 GET /api/health 返回服务版本与知识库规模 |
