import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../infra/database/database.module';
import { GraphQueryService } from './graph-query.service';
import { Entity } from './entity-extract.service';

export interface Cause {
  type: string;
  title: string;
  score: number;
  evidence: string[];
  _case?: Record<string, unknown>;
}

export interface Analysis {
  causes: Cause[];
  impact: string[];
  focusJobs: string[];
  focusTables: string[];
  prevDate: string | null;
  note?: string;
  target?: string | null;
  structures?: Array<{ name: string; comment?: string; inKb: boolean; columns: string[][] }>;
  direction?: string[];
  verify?: Record<string, unknown>;
}

interface JobRunRow {
  job_name: string;
  final_status: string;
  rows_loaded: number | null;
}
interface LogRow {
  run_date: string;
  ts: string;
  job_name: string;
  level: string;
  message: string;
  error_code: string;
}

/**
 * 规则归因引擎（原型核心资产：可解释的确定性规则；接入 LLM 后作为候选生成器）。
 * 数据库访问全部走 PostgreSQL；多跳遍历走递归 CTE（GraphQueryService）。
 */
@Injectable()
export class RulesService {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly graph: GraphQueryService,
  ) {}

private async jobStatusMap(date: string): Promise<Map<string, JobRunRow>> {
    const rows = await this.db<JobRunRow>('job_runs').where('run_date', date);
    return new Map(rows.map((r) => [r.job_name, r]));
  }

  async prevRunDate(date: string): Promise<string | null> {
    const r = await this.db('job_runs').where('run_date', '<', date).max<{ d: string | null }>('run_date as d').first();
    return r?.d ?? null;
  }

  private async jobErrorLogs(date: string, job: string): Promise<LogRow[]> {
    return this.db<LogRow>('batch_logs')
      .where({ run_date: date, job_name: job })
      .andWhere((q) => q.where('level', 'ERROR').orWhere('message', 'LIKE', '%SKIPPED%'))
      .orderBy('line_no');
  }

  private async jobWarnLogs(date: string, job: string): Promise<LogRow[]> {
    return this.db<LogRow>('batch_logs').where({ run_date: date, job_name: job, level: 'WARN' }).orderBy('line_no');
  }

  private async errorCodeInfo(code: string) {
    return this.db('error_codes').where({ code }).first();
  }

  /** 场景A：批量作业失败排查 */
  async analyzeJobFailure(ent: Entity): Promise<Analysis> {
    const date = ent.date || (await this.db('job_runs').max<{ d: string }>('run_date as d').first())?.d || '';
    const statusMap = await this.jobStatusMap(date);
    const prevDate = await this.prevRunDate(date);
    const causes: Cause[] = [];
    const impact: string[] = [];

    let target = ent.jobs[0];
    if (!target) {
      const failed = await this.db('job_runs').where({ run_date: date, final_status: 'FAILED' }).first();
      const skipped = await this.db('job_runs').where({ run_date: date, final_status: 'SKIPPED' }).first();
      target = failed?.job_name || skipped?.job_name;
    }
    if (!target) {
      return { causes, impact, focusJobs: [], focusTables: [], prevDate, note: '未识别到目标作业，当日也无失败/跳过作业记录' };
    }

    const run = statusMap.get(target);
    const upstream = await this.graph.jobUpstream(target, 3);
    const badUpstream = upstream.filter((u) => ['FAILED', 'SKIPPED'].includes(statusMap.get(u.node)?.final_status || ''));

    // C1 上游依赖未就绪
    if (run?.final_status === 'SKIPPED' || badUpstream.length) {
      const ev: string[] = [];
      for (const u of badUpstream) {
        const s = statusMap.get(u.node);
        const errs = (await this.jobErrorLogs(date, u.node)).slice(0, 2).map((e) => e.message);
        ev.push(`${u.node}（${u.depth}级上游）当日状态: ${s?.final_status || '无记录'}${errs.length ? '，日志: ' + errs.join(' | ') : ''}`);
      }
      if (run?.final_status === 'SKIPPED') ev.unshift(`作业 ${target} 当日被调度跳过（SKIPPED）`);
      causes.push({
        type: '上游依赖',
        title: `上游依赖未就绪：${badUpstream.map((u) => u.node).join('、') || '（上游链路中存在失败作业）'}，导致本作业失败或被跳过`,
        score: 9,
        evidence: ev,
      });
    }

    // C2 错误码归因（本作业及其上游的 ERROR/WARN 线索）
    const focusLogs = [
      ...(await this.jobErrorLogs(date, target)),
      ...(await Promise.all(badUpstream.map((u) => this.jobErrorLogs(date, u.node)))).flat(),
    ];
    const codes = [...new Set(focusLogs.map((l) => l.error_code).filter(Boolean))];
    for (const code of codes) {
      const info = await this.errorCodeInfo(code);
      if (!info) continue;
      const ev = [
        `错误码 ${code}：${info.meaning}`,
        `典型成因：${info.typical_cause}`,
        ...focusLogs.filter((l) => l.error_code === code).slice(0, 2).map((l) => `日志佐证 [${l.ts}] ${l.job_name}: ${l.message}`),
      ];
      for (const u of upstream) {
        for (const w of await this.jobWarnLogs(date, u.node)) {
          if (/缺失|变更|异常|重发/.test(w.message)) ev.push(`上游告警 [${w.ts}] ${u.node}: ${w.message}`);
        }
      }
      causes.push({ type: '错误码归因', title: `按错误码 ${code} 判断：${info.typical_cause}`, score: 8, evidence: ev });
    }

    // C2b 输入中明确给出错误码但当日日志未见时，回溯近期该作业的错误记录
    if (ent.errorCode && !codes.includes(ent.errorCode)) {
      const info = await this.errorCodeInfo(ent.errorCode);
      const hist = await this.db<LogRow>('batch_logs')
        .where({ job_name: target, level: 'ERROR' })
        .andWhere((q) => q.where('error_code', ent.errorCode).orWhere('message', 'LIKE', `%${ent.errorCode}%`))
        .orderBy('run_date', 'desc')
        .limit(2);
      if (hist.length) {
        causes.push({
          type: '错误码归因(历史)',
          score: 7.2,
          title: `错误码 ${ent.errorCode}${info ? '：' + info.typical_cause : ''}（当日日志未见该错误，最近出现于 ${hist[0].run_date}，可参考当日处置）`,
          evidence: hist.map((h) => `[${h.run_date} ${h.ts}] ${h.message}`),
        });
      }
    }

    // C3 维表未刷新
    const staleDim = badUpstream.filter((u) => this.graph.jobs.find((j) => j.job_name === u.node)?.layer === 'DIM');
    if (staleDim.length) {
      causes.push({
        type: '维表过期',
        title: `维表刷新作业异常：${staleDim.map((u) => u.node).join('、')}，新数据将关联不上维表`,
        score: 7,
        evidence: staleDim.map((u) => `${u.node} 当日状态 ${statusMap.get(u.node)?.final_status}`),
      });
    }

    // 影响范围：下游作业状态 + 未产出表
    const downstream = await this.graph.jobDownstream(target, 3);
    for (const d of downstream) {
      impact.push(`作业 ${d.node}（${d.depth}级下游）当日状态: ${statusMap.get(d.node)?.final_status || '无记录'}`);
    }
    const affectedTables = this.graph.tablesOfJobs([target, ...downstream.map((d) => d.node)]);
    for (const t of affectedTables) {
      const producedByFailed = this.graph.lineage.some(
        (e) => e.tgt_table === t && e.via_job && [target, ...downstream.map((d) => d.node)].includes(e.via_job),
      );
      if (producedByFailed) impact.push(`表 ${t} 当日分区（${date}）预计未产出，依赖该表的下游取数将失败或数据缺失`);
    }

    return {
      causes,
      impact,
      focusJobs: [target, ...badUpstream.map((u) => u.node)],
      focusTables: this.graph.tablesOfJobs([target]),
      prevDate,
      target,
    };
  }

  /** 场景B：数据异常排查 */
  async analyzeDataAnomaly(ent: Entity): Promise<Analysis> {
    const date = ent.date || (await this.db('job_runs').max<{ d: string }>('run_date as d').first())?.d || '';
    const statusMap = await this.jobStatusMap(date);
    const prevDate = await this.prevRunDate(date);
    const causes: Cause[] = [];
    const impact: string[] = [];
    const table = ent.tables[0];
    if (!table) {
      if (ent.columns.length) {
        const rows = await this.db('meta_columns')
          .distinct('table_name')
          .whereIn('column_name', ent.columns);
        const cands = rows.map((r) => r.table_name as string);
        causes.push({
          type: '字段定位',
          score: 6.5,
          title: `未指定异常表；字段 ${ent.columns.join('、')} 出现在 ${cands.length} 张表中，建议按数据链路顺序逐表核查：${cands.join('、')}`,
          evidence: cands.slice(0, 4).map((t) => {
            const prod = this.graph.producersOf(t);
            const s = prod.map((j) => statusMap.get(j)?.final_status || '无记录').join('/');
            return `表 ${t}（加工作业: ${prod.join(',') || '未知'}，当日状态: ${s || '-'}）`;
          }),
        });
        return { causes, impact: ['补充表名可获得更精确的血缘影响分析与验证 SQL'], focusJobs: [], focusTables: cands.slice(0, 2), prevDate, target: null };
      }
      return { causes, impact, focusJobs: [], focusTables: [], prevDate, note: '未识别到异常表，请输入表名、字段名或粘贴报错日志' };
    }

    const producers = this.graph.producersOf(table);
    const consumers = this.graph.consumersOf(table);

    // C1 产出作业当日未正常产出
    for (const job of producers) {
      const s = statusMap.get(job);
      if (!s || s.final_status !== 'SUCCESS') {
        const errs = (await this.jobErrorLogs(date, job)).slice(0, 2).map((e) => `[${e.ts}] ${e.message}`);
        causes.push({
          type: '产出缺失',
          score: 9.5,
          title: `产出作业 ${job} 当日状态为 ${s?.final_status || '无运行记录'}，表 ${table} 的 ${date} 分区未正常生成`,
          evidence: [
            `job_runs: ${job} @ ${date} → ${s?.final_status || '无记录'}`,
            ...errs,
            ...(s && s.final_status === 'SKIPPED' ? ['被跳过通常因上游依赖失败，需沿作业链路向上追查根因'] : []),
          ],
        });
      } else {
        // C2 产出正常但上游数据量骤降
        if (prevDate && s.rows_loaded) {
          const prev = await this.db<JobRunRow>('job_runs').where('run_date', prevDate).andWhere('job_name', job).first();
          if (prev?.rows_loaded && Math.abs(s.rows_loaded - prev.rows_loaded) / prev.rows_loaded > 0.3) {
            const pct = ((s.rows_loaded - prev.rows_loaded) / prev.rows_loaded * 100).toFixed(1);
            causes.push({
              type: '数据量骤降',
              score: 8.5,
              title: `产出作业 ${job} 当日加载行数较前日变化 ${pct}%（${prev.rows_loaded} → ${s.rows_loaded}），上游输入可能不完整`,
              evidence: [`job_runs 行数对比: ${prevDate}=${prev.rows_loaded}，${date}=${s.rows_loaded}`],
            });
          }
        }
        // C3 上游作业失败未逐级重跑
        const ups = await this.graph.jobUpstream(job, 3);
        const badUps = ups.filter((u) => ['FAILED', 'SKIPPED'].includes(statusMap.get(u.node)?.final_status || ''));
        if (badUps.length) {
          causes.push({
            type: '上游失败',
            score: 7.5,
            title: `上游作业存在失败/跳过未恢复：${badUps.map((u) => u.node).join('、')}，本作业虽成功但基于缺失/旧数据计算`,
            evidence: badUps.map((u) => `${u.node}（${u.depth}级上游）当日状态: ${statusMap.get(u.node)?.final_status}`),
          });
        }
      }
    }
    if (!producers.length) {
      causes.push({
        type: '血缘缺失',
        score: 6,
        title: `未找到表 ${table} 的加工作业（无产出血缘），可能为源系统直接提供或血缘未覆盖`,
        evidence: ['表级血缘视图中无该表的产出作业'],
      });
    }

    // 字段级线索
    if (ent.columns.length) {
      causes.push({
        type: '字段级',
        score: 5,
        title: `疑似与字段 ${ent.columns.join('、')} 相关：上游文件格式变更或维表关联不上常导致单字段异常`,
        evidence: ['参考历史案例：客户号关联不上维表（TKT-2026-0021）'],
      });
    }

    // 影响范围
    const downTables = await this.graph.tableDownstream(table, 3);
    for (const d of downTables) {
      impact.push(`表 ${d.node}（${d.depth}级下游）依赖本表数据，异常将传导`);
      for (const j of this.graph.producersOf(d.node)) {
        impact.push(`作业 ${j}（加工 ${d.node}）当日状态: ${statusMap.get(j)?.final_status || '无记录'}`);
      }
    }
    if (!downTables.length && consumers.length) impact.push(`消费方作业: ${consumers.join('、')}`);

    return {
      causes,
      impact,
      focusJobs: producers,
      focusTables: [table, ...downTables.map((d) => d.node)],
      prevDate,
      target: table,
    };
  }
}