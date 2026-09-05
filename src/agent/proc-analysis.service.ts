import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import { KNEX } from '../infra/database/database.module';
import { GraphQueryService } from './graph-query.service';
import { RulesService } from './rules.service';
import { parseProcedure } from '../collector/parse-lineage';
import { Analysis } from './rules.service';

const PART_RE = /^(etl_dt|data_dt|updt_dt)$/;

export function isProcText(t: string): boolean {
  return /insert\s+into[\s\S]{0,400}?select[\s\S]{0,2000}?\bfrom\b|create\s+procedure/i.test(t);
}

/**
 * 存储过程/SQL 自由文本静态分析：
 * 解析源/目标表 → 关联知识库血缘与上下游表结构 → 静态风险规则 → 排查方向
 * 真实环境叠加 LLM 解析动态 SQL、变量追忆、跨过程调用链。
 */
@Injectable()
export class ProcAnalysisService {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly graph: GraphQueryService,
    private readonly rules: RulesService,
  ) {}

  async analyze(text: string): Promise<Analysis> {
    const causes: Analysis['causes'] = [];
    const impact: string[] = [];
    const structures: Analysis['structures'] = [];

    const edges = parseProcedure(text, '输入的SQL片段');
    const inserts: Array<{ tgt: string; cols: string[] }> = [];
    let m: RegExpExecArray | null;
    const insRe = /insert\s+into\s+([a-zA-Z_][\w]*)\s*(\([^)]*\))?[\s\S]*?\bselect\b/gi;
    while ((m = insRe.exec(text))) {
      inserts.push({ tgt: m[1].toLowerCase(), cols: (m[2] || '').replace(/[()]/g, '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) });
    }
    const joins: Array<{ type: string; table: string }> = [];
    const joinRe = /\b(left\s+|right\s+|inner\s+)?join\s+([a-zA-Z_][\w]*)/gi;
    while ((m = joinRe.exec(text))) joins.push({ type: (m[1] || 'inner ').trim().toLowerCase().split(/\s+/)[0], table: m[2].toLowerCase() });
    const lower = text.toLowerCase();
    const whereIdx = lower.lastIndexOf('where');
    const wherePart = whereIdx >= 0 ? lower.slice(whereIdx) : '';

    const tgtTables = [...new Set(inserts.map((i) => i.tgt).concat(edges.map((e) => e.tgt_table)))];
    const srcTables = [...new Set(edges.map((e) => e.src_table))];
    const allTables = [...new Set([...srcTables, ...tgtTables])];
    const known = (t: string) => this.graph.tables.some((x) => x.name === t);
    const partColOf = (t: string) => (this.graph.columns.find((c) => c.table_name === t && PART_RE.test(c.column_name)) || {}).column_name || null;
    const notNullCols = (t: string) => this.graph.columns.filter((c) => c.table_name === t && c.nullable === 'N').map((c) => c.column_name);

    // ---- 2. 对象识别与血缘 ----
    impact.push(`目标表（写入）：${tgtTables.map((t) => (known(t) ? `${t}【在库】` : `${t}【知识库外】`)).join('、') || '未识别'}`);
    impact.push(`来源表（读取）：${srcTables.map((t) => (known(t) ? `${t}【在库】` : `${t}【知识库外】`)).join('、') || '未识别'}`);
    const joinsDesc = joins.length ? joins.map((j) => `${j.type.toUpperCase()} JOIN ${j.table}${known(j.table) ? '' : '【在库外】'}`).join('，') : '无 JOIN';
    impact.push(`关联方式：${joinsDesc}`);

    const matchedJobs = this.graph.jobs.filter((j) => tgtTables.some((t) => this.graph.lineage.some((e) => e.tgt_table === t && e.via_job === j.job_name)));
    if (matchedJobs.length) impact.push(`疑似对应行内作业：${matchedJobs.map((j) => `${j.job_name}（${j.job_desc}，${j.schedule}）`).join('、')}`);

    for (const t of tgtTables.filter(known).slice(0, 2)) {
      const ups = (await this.graph.tableUpstream(t, 3)).filter((x) => x.node !== t);
      const downs = await this.graph.tableDownstream(t, 3);
      if (ups.length) impact.push(`表 ${t} 的上游来源（${ups.length} 张）：${ups.map((u) => `${u.node}(${u.depth}级)`).join('、')}`);
      if (downs.length) impact.push(`表 ${t} 的下游消费：${downs.map((d) => d.node).join('、')}（异常将向下游传导）`);
      for (const j of this.graph.producersOf(t)) impact.push(`表 ${t} 当前由 ${j} 加工`);
    }

    // 表结构（限4张×16列）
    for (const t of allTables.filter(known).slice(0, 4)) {
      const info = this.graph.tables.find((x) => x.name === t);
      const cols = this.graph.columns.filter((c) => c.table_name === t).slice(0, 16).map((c) => [c.column_name, c.data_type || '', c.nullable === 'N' ? '非空' : '可空', c.comment || '']);
      structures.push({ name: t, comment: info?.comment || '', inKb: true, columns: cols });
    }
    for (const t of allTables.filter((t) => !known(t)).slice(0, 3)) {
      structures.push({ name: t, comment: '知识库外对象：无表结构信息，建议纳入元数据采集', inKb: false, columns: [] });
    }

    // ---- 3. 静态风险规则 ----
    const leftJoins = joins.filter((j) => j.type === 'left');
    if (leftJoins.length) {
      const riskCols = tgtTables.filter(known).flatMap((t) => notNullCols(t));
      causes.push({
        type: '静态分析·空值风险',
        score: 8.2,
        title: `存在 ${leftJoins.length} 处 LEFT JOIN（${leftJoins.map((j) => j.table).join('、')}）：关联不上时右侧列取 NULL，若写入非空列将报 ORA-01400${riskCols.length ? '，涉及非空列 ' + riskCols.join('、') : ''}`,
        evidence: [
          ...leftJoins.map((j) => `LEFT JOIN ${j.table} —— 需确认关联键在右表的覆盖率（历史案例 TKT-2026-0021 维表关联不上、TKT-2026-0158 ORA-01400）`),
          ...(riskCols.length ? [`目标非空列清单：${riskCols.join('、')}`] : []),
        ],
      });
    }
    const unfiltered = srcTables.filter(known).filter((t) => {
      const pc = partColOf(t);
      return pc && !new RegExp(pc).test(wherePart);
    });
    if (unfiltered.length) {
      causes.push({
        type: '静态分析·分区过滤',
        score: 7.5,
        title: `来源表 ${unfiltered.join('、')} 的 WHERE 中未见数据日期过滤（${unfiltered.map(partColOf).filter(Boolean).join('/')}），可能全量扫描历史数据，导致行数翻倍或跨日重复`,
        evidence: ['历史案例：TKT-2025-0210 重复发送主键冲突、TKT-2025-1622 统计信息过期全表扫描超时', '建议核对增量/全量语义与分区裁剪条件'],
      });
    }
    const noClean = tgtTables.filter((t) => !new RegExp(`(delete\\s+from\\s+${t}|truncate\\s+(table\\s+)?${t})`).test(lower));
    if (noClean.length && known(noClean[0])) {
      causes.push({
        type: '静态分析·幂等性',
        score: 7,
        title: `未见对目标表 ${noClean.join('、')} 的先清理逻辑（DELETE/TRUNCATE 当日分区），失败重跑可能触发 ORA-00001 唯一约束冲突或数据翻倍`,
        evidence: ['历史案例：TKT-2026-0056 重跑参数错误主键冲突', '建议采用"先删后插"或分区替换（EXCHANGE）模式保证重跑幂等'],
      });
    }
    const unknown = allTables.filter((t) => !known(t));
    if (unknown.length) {
      causes.push({
        type: '血缘覆盖',
        score: 5.5,
        title: `以下对象不在知识库中，血缘与上下游分析暂缺：${unknown.join('、')}`,
        evidence: ['若为源系统表，建议补充元数据采集；若为临时表/中间表，建议登记到数据资产目录'],
      });
    }

    // ---- 4. 排查方向建议 ----
    const direction = [
      '若结果行数不符：先用下方验证 SQL 对比目标表与来源表当日行数，定位差异发生在过滤/JOIN/聚合哪一段',
      '若关键字段为空：核对 LEFT JOIN 关联键两侧行数与空值分布（来源表关联键为空率）',
      '若数据重复：核对来源表数据日期过滤与业务主键去重逻辑',
      ...(unknown.length ? ['对知识库外对象：人工确认其来源系统与加工职责，补齐血缘'] : []),
    ];

    // ---- 5. 验证 SQL ----
    const latest = (await this.db('job_runs').max<{ d: string }>('run_date as d').first())?.d || '';
    const prevDate = await this.rules.prevRunDate(latest);
    const focusNotNull = tgtTables.filter(known).flatMap((t) => notNullCols(t));
    const verify = { focusTables: tgtTables.filter(known).slice(0, 2), date: latest, prevDate, columns: [...new Set(focusNotNull)].slice(0, 3) };

    return {
      causes,
      impact,
      structures,
      direction,
      verify,
      focusJobs: matchedJobs.map((j) => j.job_name),
      focusTables: tgtTables,
      prevDate,
      target: tgtTables[0] || null,
    };
  }
}