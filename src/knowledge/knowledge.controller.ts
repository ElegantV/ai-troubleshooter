import { Inject, Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Knex } from 'knex';
import Redis from 'ioredis';
import { KNEX } from '../infra/database/database.module';
import { REDIS } from '../infra/redis/redis.module';
import { GraphQueryService } from '../agent/graph-query.service';
import { Public } from '../common/decorators/auth.decorators';

/** 知识/能力展示：元数据规模、表单字典、血缘链路图、能力演示 */
@ApiTags('知识库')
@Controller()
export class KnowledgeController {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly graph: GraphQueryService,
  ) {}

  @Get('meta')
  @ApiOperation({ summary: '知识库规模与当日异常作业' })
  async meta() {
    const count = async (t: string) => Number((await this.db(t).count<{ c: string }>('* as c').first())?.c || 0);
    const latest = (await this.db('job_runs').max<{ d: string }>('run_date as d').first())?.d || null;
    const failed = latest
      ? await this.db('job_runs').where({ run_date: latest }).andWhere('final_status', '!=', 'SUCCESS').select('job_name', 'final_status')
      : [];
    return {
      tables: await count('meta_tables'),
      jobs: await count('jobs'),
      lineageEdges: await count('table_lineage'),
      tickets: await count('tickets'),
      cases: await count('cases'),
      latestRunDate: latest,
      abnormalJobs: failed,
    };
  }

  @Get('dict')
  @ApiOperation({ summary: '作业/表/错误码/系统表单字典（自动补全）' })
  async dict() {
    return {
      tables: this.graph.tables.map((t) => ({ name: t.name, comment: t.comment })),
      jobs: this.graph.jobs.map((j) => ({ name: j.job_name, desc: j.job_desc })),
      errorCodes: await this.db('error_codes').select('code', 'meaning').orderBy('code'),
      systems: await this.db('systems').select('code', 'name', 'description').orderBy('code'),
    };
  }

  @Public()
  @Get('systems')
  @ApiOperation({ summary: '系统字典（注册选所属系统）' })
  async systems() {
    return this.db('systems').select('code', 'name', 'description').orderBy('code');
  }

  @Get('graph')
  @ApiOperation({ summary: '血缘×链路关系图数据' })
  async graphData() {
    return {
      jobs: this.graph.jobs.map((j) => ({ name: j.job_name, desc: j.job_desc, layer: j.layer, schedule: j.schedule })),
      tables: this.graph.tables.map((t) => ({ name: t.name, layer: t.name.split('_')[0].toUpperCase(), comment: t.comment })),
      jobDeps: this.graph.deps,
      tlineage: this.graph.lineage.map((e) => ({ src: e.src_table, tgt: e.tgt_table, proc: e.proc_name, job: e.via_job })),
    };
  }

  @Get('demos')
  @ApiOperation({ summary: '三大能力真实关联演示' })
  async demos() {
    const latest = (await this.db('job_runs').max<{ d: string }>('run_date as d').first())?.d || '';
    const rows = await this.db('job_runs').where({ run_date: latest }).select('job_name', 'final_status');
    const st: Record<string, string> = {};
    for (const r of rows) st[r.job_name] = r.final_status;
    const chainSteps = ['job_ods_cust_info_load', 'job_dim_cust_sync', 'job_dwd_txnl_clean', 'job_dws_asset_agg', 'job_ads_rpt_gen']
      .map((j, i) => `${i === 0 ? j : '→ ' + j}：${st[j] || '无记录'}${i === 0 ? '（FTP-TIMEOUT 客户信息文件等待超时）' : i === 4 ? '（日报未产出）' : '（上游失败被调度跳过）'}`);
    return {
      latestRunDate: latest,
      lineageDemo: {
        title: '血缘关联 · 数据异常沿血缘溯源',
        scenario: 'ADS 客户资产日报（ads_cust_asset_rpt）数字偏低，业务投诉，需要定位是哪一层算错',
        steps: [
          'ads_cust_asset_rpt ← proc_ads_rpt_gen ← dws_cust_asset_d',
          'dws_cust_asset_d ← proc_dws_asset_agg ← dwd_txnl_detail_d ⊕ ods_acct_bal ⊕ dim_cust',
          'dwd_txnl_detail_d ← proc_dwd_txnl_clean ← ods_txnl_detail ⊕ dim_cust',
          '排查动作：对每层表执行"当日 vs 前日"分区行数对比，行数在哪一层骤减，问题就在该层加工作业或其上游',
        ],
        usage: '血缘回答"数据从哪来、被谁用"，把单表异常放大为整条数据链的核查路径',
        try: 'ads_cust_asset_rpt 没有最新数据，业务取数报错',
      },
      chainDemo: {
        title: '作业链路 · 失败根因与级联影响',
        scenario: `${latest} 跑批：客户信息源文件延迟，一条链路 5 个作业级联异常`,
        steps: chainSteps,
        usage: '链路回答"作业之间谁依赖谁"：根因必在链路最上游；修复后须按 DAG 自上而下逐级重跑，否则下游基于旧数据（历史案例 TKT-2025-0412）',
        try: 'job_ods_cust_info_load 昨天文件超时失败',
      },
      caseDemo: {
        title: '案例关联 · 历史经验复用',
        scenario: '作业报 ORA-01400，输入包含错误码 + 作业名 + 表名',
        steps: [
          '实体识别：错误码 ORA-01400、作业 job_dwd_txnl_clean、表 dwd_txnl_detail_d',
          '检索加权命中历史工单 TKT-2026-0158：错误码匹配 +3、关联作业 +2.5、关联表 +2 → 综合置信度"高"',
          '直接复用工单结论：根因（源文件格式变更致 CUST_ID 为空）+ 4 步处置流程',
          '用户反馈确认后自动沉淀为新案例，案例库越用越准（数据飞轮）',
        ],
        usage: '案例关联回答"以前谁遇到过、怎么解决的"，把个人经验变成团队资产',
        try: 'job_dwd_txnl_clean 昨晚失败了，报 ORA-01400',
      },
    };
  }
}

/** 探活（开放，供运维/脚本不登录检查服务与知识库状态） */
@ApiTags('运维')
@Public()
@Controller('api/health')
export class HealthController {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** liveness：进程存活即 200（K8s livenessProbe / Docker HEALTHCHECK 用） */
  @Get('live')
  @ApiOperation({ summary: '存活探针（进程活着即 OK）' })
  live() {
    return { ok: true, uptime: Math.round(process.uptime()) };
  }

  /** readiness：依赖就绪才 200，否则 503（K8s readinessProbe / 网关摘流量用） */
  @Get('ready')
  @ApiOperation({ summary: '就绪探针（DB + Redis 探测，失败返回 503）' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
    try {
      await this.db.raw('SELECT 1');
      checks.push({ name: 'postgres', ok: true });
    } catch (e) {
      checks.push({ name: 'postgres', ok: false, detail: (e as Error).message });
    }
    try {
      // 连接未就绪时主动拉起（重连策略已在 Redis 连接层配置）
      if (this.redis.status !== 'ready') await this.redis.connect();
      const pong = await this.redis.ping();
      checks.push({ name: 'redis', ok: pong === 'PONG' });
    } catch (e) {
      checks.push({ name: 'redis', ok: false, detail: (e as Error).message });
    }
    const ok = checks.every((c) => c.ok);
    if (!ok) res.status(503);
    return { status: ok ? 200 : 503, ok, checks };
  }

  @Get()
  @ApiOperation({ summary: '服务与知识库探活' })
  async health() {
    const count = async (t: string) => Number((await this.db(t).count<{ c: string }>('* as c').first())?.c || 0);
    return {
      ok: true,
      version: '0.4.0',
      stack: 'NestJS+TS+PostgreSQL+Redis',
      kb: { tables: await count('meta_tables'), jobs: await count('jobs'), tickets: await count('tickets'), cases: await count('cases') },
    };
  }
}