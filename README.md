# AI 问题排查助手（v0.4 企业级重构）

面向数据异常与批量作业失败场景的智能排查工具，对应"AI靶场"实训需求表——资源交付中心《AI问题排查助手》场景。

## 技术栈（企业级）

| 层 | 选型 |
|---|---|
| 语言/框架 | **TypeScript + NestJS**（模块化：agent / knowledge / case / auth / audit / collector） |
| 数据库 | **PostgreSQL 17** + knex 版本化迁移（多跳血缘/链路遍历用递归 CTE） |
| 队列/调度 | **Redis + BullMQ** 定时采集（默认 10 分钟增量刷新知识库） |
| 认证 | **JWT + RBAC**（roles：user/admin），SSO 适配器预留（`src/auth/auth.provider.ts`） |
| API 治理 | `/api/v1` + 统一包络 `{code,data,error}` + **OpenAPI/Swagger**（`/api/docs`） |
| 检索 | BM25 + 实体加权（`SearchService` 接口，生产可换 pgvector 混合检索） |
| 测试 | vitest 单测（核心归因/检索/血缘解析覆盖率 >80%） |
| 交付 | Docker 多阶段构建 + docker-compose（postgres + redis + backend） |

前端：**Vue 3 + Element Plus**（`frontend/`，Vite 构建产物到 `public/` 由后端静态托管）。

## 运行

```bash
# 前置：本机 PostgreSQL(127.0.0.1:5432) + Redis(127.0.0.1:6379)
npm install
npm run migrate     # 建表（版本化迁移，幂等）
npm run seed        # 从 data/raw 刷新知识库（保留案例/审计/用户）
npm run build       # 编译后端 TS 到 dist/
npm start           # 启动 http://localhost:3000（Swagger: /api/docs）
npm run build:ui    # 前端构建（可选，静态资源已随仓库提供）
npm test            # 单元测试（vitest）
npm run test:cov    # 覆盖率报告
npm run dev         # 开发热重载（tsx watch）
npm run dev:ui      # 前端开发模式（5173，/api 代理到 3000）
```

首次从旧版 SQLite 迁移存量数据（案例/审计/用户）：

```bash
npm run migrate:sqlite
```

Docker 一键运行：

```bash
docker compose up --build   # postgres + redis + backend 全部就绪
```

配置全部走环境变量（`DB_*` / `REDIS_*` / `JWT_SECRET` / `LLM_*`），生产经配置中心 + KMS 注入，代码内无明文密钥。

## 已实现能力

- 作业失败排查：上游链路状态回溯、错误码归因、上游告警线索、历史案例匹配
- 数据异常排查：作业状态核查、行数骤降检测、下游影响传导分析；仅输入字段自动定位候选表
- 存储过程分析（不限输入）：源/目标表与 JOIN 解析、行内作业关联、上下游血缘展开、表结构展示 + 静态风险（LEFT JOIN 空值 / 分区过滤缺失 / 重跑幂等性 / 血缘覆盖缺口）
- 输入自动路由：SQL 片段 / 表名 / 字段 / 作业名 / 报错日志混输均可
- 能力图示页：血缘×链路关系图（真实知识库数据）+ 三大能力演示
- 候选原因按置信度排序，每条附证据引用（日志/工单/血缘边），可解释可审计
- 验证 SQL 模板生成（只读：分区行数对比 / 新鲜度 / 空值检查）
- 案例录入（查重防重复、自动识别关联实体）、反馈确认自动沉淀（数据飞轮）
- 全程审计留痕（query_log，含操作归属）+ 排查历史可视化复看
- RBAC 管理面：案例删除、手动刷新知识库需 admin 角色
- 知识库规模：18 个错误码 + 21 条历史工单 + 3 个跑批日故障剧本

## 认证与操作归属

注册/登录（用户名密码 + JWT 7 天有效，scrypt 加盐哈希）。所有 API 需登录；案例与审计记录归属到操作人（`cases.created_by` / `query_log.user_name`）。生产替换点：`AUTH_PROVIDER=sso` 接入行内 LDAP/SSO，归属落库逻辑不变。

## 接入 LLM（可选）

环境变量 `LLM_ENABLED=true` + `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`（OpenAI 兼容格式）。接入后用于：报告结论归纳、动态 SQL 血缘解析兜底、输入实体识别增强；关闭时纯规则降级。

## 真实环境替换点

| 原型 | 生产替换 |
|---|---|
| data/raw 模拟文件 | 元数据平台 / 调度系统 API / 日志平台 / 工单系统 API / Git 版本库 |
| BM25 关键词检索 | 知识库平台向量检索（pgvector / ES，`SEARCH_ADAPTER` 接口已预留） |
| 规则归因引擎 | 规则生成候选 + LLM 归因复核（workflow 已预留调用点） |
| 本地用户名密码 | 行内 SSO（OIDC/CAS/LDAP，`AuthProvider` 接口已预留） |

## 目录结构

```
src/
  main.ts / app.module.ts        入口 + 全局前缀(api/v1)、Swagger、统一包络/异常
  config/                        环境变量配置（无明文密钥）
  infra/                         database(knex+迁移) / redis
  auth/                          JWT + RBAC + AuthProvider(SSO 适配器)
  agent/                         智能体编排：workflow/rules/retrieval/graph(递归CTE)/
                                  entityExtract/procAnalysis/verifySql/llm
  knowledge/                     元数据/字典/血缘图/演示/健康探活
  case/ / audit/                 案例库 / 排查历史审计
  collector/                     数据采集 + BullMQ 定时调度
  scripts/                       SQLite→PG 一次性迁移
frontend/                        Vue3 + Element Plus 前端
public/                          前端构建产物（后端静态托管）
data/raw/                        模拟数据源（生产替换为各平台 API）
docs/                            架构与测试文档
```