import { Inject, Injectable } from '@nestjs/common';
import { Knex } from 'knex';
import * as crypto from 'crypto';
import { KNEX } from '../infra/database/database.module';
import { GraphQueryService } from './graph-query.service';
import { EntityExtractService, Entity } from './entity-extract.service';
import { RulesService, Analysis } from './rules.service';
import { ProcAnalysisService } from './proc-analysis.service';
import { RetrievalService, SearchHit } from './retrieval.service';
import { VerifySqlService } from './verify-sql.service';
import { LlmService, LlmAnalysisContext, LlmAnalysisResult } from './llm.service';

export interface ReportSection {
  key: string;
  title: string;
  items?: string[];
  causes?: Array<{ title: string; type: string; score: number; confidence: string; evidence: string[] }>;
  tables?: Array<{ name: string; comment?: string; inKb: boolean; columns: string[][] }>;
  sqls?: Array<{ purpose: string; sql: string }>;
  source?: string | null;
}

export interface Report {
  query_id: string;
  created_at: string;
  input: string;
  entities: Record<string, unknown>;
  route: string;
  date: string | null;
  confidence: string;
  summary: string;
  sections: ReportSection[];
  markdown?: string;
  llmSummary?: string;
  llmError?: string;
  aiAnalysis?: LlmAnalysisResult;
}

function toMarkdown(r: Report): string {
  const routeName: Record<string, string> = { job_failure: '作业失败', data_anomaly: '数据异常', proc_analysis: '存储过程分析' };
  const L = [`## 排查报告（${routeName[r.route] || '通用检索'}）`, '', `**结论（置信度：${r.confidence}）**：${r.summary}`, ''];
  for (const s of r.sections) {
    L.push(`### ${s.title}`);
    if (s.key === 'causes') for (const c of s.causes || []) {
      L.push(`- **[${c.confidence}] ${c.title}**`);
      for (const e of c.evidence) L.push(`  - ${e}`);
    } else if (s.key === 'sql') for (const q of s.sqls || []) { L.push(`-- ${q.purpose}`); L.push('```sql'); L.push(q.sql); L.push('```'); }
    else if (s.key === 'structures') {
      for (const t of s.tables || []) {
        L.push(`- **${t.name}**${t.inKb ? '' : '（知识库外）'}${t.comment ? '：' + t.comment : ''}`);
        for (const c of t.columns) L.push(`  - ${c.join(' ')}`);
      }
    }
    else for (const i of s.items || []) L.push(`- ${i}`);
    L.push('');
  }
  return L.join('\n');
}

/** 智能体编排层：固定工作流（可追溯）。输入理解 → 场景路由 → 规则归因/图谱 → 案例检索 → 验证SQL → 报告 → (LLM增强) → 审计 */
@Injectable()
export class WorkflowService {
  constructor(
    @Inject(KNEX) private readonly db: Knex,
    private readonly graph: GraphQueryService,
    private readonly entityExtract: EntityExtractService,
    private readonly rules: RulesService,
    private readonly procAnalysis: ProcAnalysisService,
    private readonly retrieval: RetrievalService,
    private readonly verifySql: VerifySqlService,
    private readonly llm: LlmService,
  ) {}

  async analyze(text: string, user: string, systemCode = ''): Promise<Report> {
    const ent = await this.entityExtract.extract(text, systemCode);
    ent.date = ent.date || (await this.entityExtract.latestRunDate());

    let analysis: Analysis;
    if (ent.route === 'job_failure') analysis = await this.rules.analyzeJobFailure(ent);
    else if (ent.route === 'data_anomaly') analysis = await this.rules.analyzeDataAnomaly(ent);
    else if (ent.route === 'proc_analysis') analysis = await this.procAnalysis.analyze(ent.raw || text);
    else analysis = { causes: [], impact: [], focusJobs: ent.jobs, focusTables: ent.tables, note: '未能识别场景，请补充异常表名、作业名或报错信息', prevDate: null };

    const firstCode = ent.errorCode || (/ORA-\d{5}|SKIPPED/.exec(analysis.causes.map((c) => c.title).join(' ')) || [''])[0];
    const caseHits: SearchHit[] = await this.retrieval.search(text, {
      errorCode: firstCode,
      jobs: ent.jobs.length ? ent.jobs : analysis.focusJobs,
      tables: ent.tables.length ? ent.tables : analysis.focusTables,
    }, 3, systemCode);
    for (const c of caseHits) {
      analysis.causes.push({
        type: c.kind === 'ticket' ? '历史工单' : '沉淀案例',
        title: `与历史案例 ${c.id} 高度相似：${c.title}`,
        score: Math.min(c.score, 9.8),
        evidence: [`现象：${c.symptom}`, `根因：${c.root_cause}`, ...c.boostReasons.map((x) => `匹配依据：${x}`)],
        _case: c as unknown as Record<string, unknown>,
      });
    }
    analysis.causes.sort((a, b) => b.score - a.score);

    const verifySql = ent.route === 'proc_analysis'
      ? this.verifySql.build(analysis.verify || {})
      : this.verifySql.build({
          focusTables: ent.tables.length ? ent.tables : analysis.focusTables,
          date: ent.date,
          prevDate: analysis.prevDate,
          columns: ent.columns,
        });

    const bestCase = caseHits[0];
    const solution = bestCase
      ? { source: `${bestCase.kind === 'ticket' ? '工单' : '案例'} ${bestCase.id}`, items: bestCase.solution.split(/[；;]/).filter(Boolean) }
      : {
          source: null,
          items: analysis.direction
            ? [...analysis.direction, '确认方向后，可在"案例库"页签把本次结论沉淀为案例']
            : analysis.causes.length
              ? ['按候选原因逐项执行验证SQL确认根因', '依据对应错误码处置手册操作', '处理完成后按作业链路自上而下逐级重跑下游，并校验各表当日分区行数']
              : ['请补充异常表名、作业名或粘贴报错日志后重试'],
        };

    const top = analysis.causes[0];
    const confidence = top ? (top.score >= 8.5 ? '高' : top.score >= 6.5 ? '中' : '低') : '无法判断';
    const routeName: Record<string, string> = { job_failure: '作业失败排查', data_anomaly: '数据异常排查', proc_analysis: '存储过程分析' };
    const summary = top
      ? `已完成${routeName[ent.route || 'other'] || '通用检索'}（数据日期 ${ent.date}）。最可能原因：${top.title}`
      : analysis.note || `已检索知识库（数据日期 ${ent.date}），未找到强匹配的候选原因，建议补充报错日志细节。`;

    const report: Report = {
      query_id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      input: text,
      entities: ent as unknown as Record<string, unknown>,
      route: ent.route || 'other',
      date: ent.date,
      confidence,
      summary,
      sections: [
        { key: 'impact', title: ent.route === 'proc_analysis' ? '对象识别与血缘链路' : '影响范围', items: analysis.impact.length ? analysis.impact : ['未识别到明确影响范围'] },
        {
          key: 'causes',
          title: ent.route === 'proc_analysis' ? '风险点与问题方向（SQL 静态分析）' : '候选原因（按置信度排序）',
          causes: analysis.causes.slice(0, 5).map((c) => ({
            title: c.title,
            type: c.type,
            score: c.score,
            confidence: c.score >= 8.5 ? '高' : c.score >= 6.5 ? '中' : '低',
            evidence: c.evidence.slice(0, 5),
          })),
        },
        ...(analysis.structures && analysis.structures.length ? [{ key: 'structures', title: '相关表结构（来自知识库元数据）', tables: analysis.structures }] : []),
        { key: 'sql', title: `建议验证 SQL（只读，数据日期 ${ent.date}）`, sqls: verifySql },
        { key: 'solution', title: ent.route === 'proc_analysis' ? '建议排查方向' : '建议处置步骤', source: solution.source, items: solution.items },
        { key: 'refs', title: '参考案例', items: caseHits.map((c) => `${c.id}《${c.title}》 匹配度 ${c.score}${c.boostReasons.length ? '（' + c.boostReasons.join('、') + '）' : ''}`) },
      ],
    };
    report.markdown = toMarkdown(report);

    // LLM 综合分析（规则候选 + 命中案例 + 表结构 + 作业状态一起作为上下文；失败降级为纯规则报告）
    if (this.llm.enabled) {
      try {
        const ai = await this.llm.analyzeWithContext(this.buildLlmContext(text, ent, analysis, caseHits));
        if (ai) {
          report.aiAnalysis = ai;
          report.llmSummary = ai.llmSummary;
        }
      } catch (e) {
        report.llmError = (e as Error).message;
      }
    }

    // 审计留痕（操作归属）
    await this.db('query_log').insert({
      query_id: report.query_id,
      created_at: report.created_at,
      input_text: text,
      entities_json: JSON.stringify(ent),
      report_json: JSON.stringify(report),
      user_name: user || '',
    });

    return report;
  }

  /** 组装 LLM 上下文包：用户问题 + 规则候选 + 命中案例原文 + 表结构 + 作业状态（全部来自知识库） */
  private buildLlmContext(text: string, ent: Entity, analysis: Analysis, caseHits: SearchHit[]): LlmAnalysisContext {
    return {
      input: text.slice(0, 800),
      date: ent.date,
      route: ent.route || 'other',
      entities: `表:${ent.tables.join('、') || '-'} 作业:${ent.jobs.join('、') || '-'} 字段:${ent.columns.join('、') || '-'} 错误码:${ent.errorCode || '-'}`,
      ruleCandidates: analysis.causes.slice(0, 8).map((c) => ({
        title: c.title,
        score: c.score,
        confidence: c.score >= 8.5 ? '高' : c.score >= 6.5 ? '中' : '低',
        evidence: c.evidence.slice(0, 4),
      })),
      cases: caseHits.slice(0, 3).map((c) => ({
        id: c.id,
        kind: c.kind,
        symptom: String(c.symptom || '').slice(0, 300),
        rootCause: String(c.root_cause || '').slice(0, 300),
        solution: String(c.solution || '').slice(0, 300),
      })),
      structures: (analysis.structures || []).slice(0, 4).map((s) => ({
        name: s.name,
        comment: s.comment || '',
        columns: s.columns.slice(0, 10).map((col) => col.join(' ')),
      })),
      jobStatus: analysis.impact.slice(0, 8),
    };
  }

  /** 反馈沉淀闭环：确认有效的排查结论自动写入案例库（归属到操作人 + 所属系统） */
  async saveFeedback(
    { query_id, helpful, confirmed_cause, note }: { query_id: string; helpful: string; confirmed_cause?: string; note?: string },
    user: string,
    systemCode = '',
  ): Promise<{ ok: boolean; caseId?: string; message: string }> {
    const row = await this.db('query_log').where({ query_id }).first();
    if (!row) return { ok: false, message: '查询记录不存在' };
    await this.db('query_log')
      .where({ query_id })
      .update({ helpful, confirmed_cause: confirmed_cause || '', feedback_at: new Date().toISOString() });

    if (helpful === 'yes' && confirmed_cause) {
      const ent = JSON.parse(row.entities_json);
      const report = JSON.parse(row.report_json);
      const caseId = 'CASE-' + Date.now();
      const solution = note || report.sections.find((s: any) => s.key === 'solution')?.items?.join('；') || '';
      await this.db('cases').insert({
        case_id: caseId,
        symptom: row.input_text,
        root_cause: confirmed_cause,
        solution,
        related_jobs: JSON.stringify(ent.jobs || []),
        related_tables: JSON.stringify(ent.tables || []),
        error_code: ent.errorCode || '',
        source: '用户反馈沉淀',
        created_at: new Date().toISOString(),
        created_by: user || row.user_name || '',
        system_code: systemCode || '',
      });
      return { ok: true, caseId, message: `反馈已记录，并已沉淀为案例 ${caseId}，后续排查将自动关联` };
    }
    return { ok: true, message: '反馈已记录' };
  }
}