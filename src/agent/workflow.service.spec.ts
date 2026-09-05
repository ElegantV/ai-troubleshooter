import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestCtx, destroyCtx, TestCtx } from '../../test/helpers';
import { EntityExtractService } from './entity-extract.service';
import { RulesService } from './rules.service';
import { ProcAnalysisService } from './proc-analysis.service';
import { RetrievalService, Bm25SearchAdapter } from './retrieval.service';
import { VerifySqlService } from './verify-sql.service';
import { LlmService } from './llm.service';
import { WorkflowService } from './workflow.service';

const fakeCfg = {
  get: (key: string) =>
    key === 'app' ? { llm: { enabled: false, baseUrl: '', apiKey: '', model: '' } } : undefined,
} as any;

let ctx: TestCtx;
let workflow: WorkflowService;

beforeAll(async () => {
  ctx = await createTestCtx();
  const entity = new EntityExtractService(ctx.db, ctx.graph);
  const rules = new RulesService(ctx.db, ctx.graph);
  const proc = new ProcAnalysisService(ctx.db, ctx.graph, rules);
  const retrieval = new RetrievalService(ctx.db, new Bm25SearchAdapter());
  const verify = new VerifySqlService(ctx.graph);
  const llm = new LlmService(fakeCfg);
  workflow = new WorkflowService(ctx.db, ctx.graph, entity, rules, proc, retrieval, verify, llm);
});

afterAll(async () => {
  await destroyCtx(ctx);
});

describe('智能体编排：workflow.analyze', () => {
  it('作业失败输入 → 报告 + 审计留痕（归属操作人）', async () => {
    const report = await workflow.analyze('job_dwd_txnl_clean 昨晚失败了，报 ORA-01400', 'tester');
    expect(report.route).toBe('job_failure');
    expect(report.confidence).toMatch(/高|中|低/);
    expect(report.sections.find((s) => s.key === 'causes')?.causes?.length).toBeGreaterThan(0);
    expect(report.sections.find((s) => s.key === 'sql')).toBeTruthy();
    expect(report.markdown).toContain('排查报告');
    const log = await ctx.db('query_log').where({ query_id: report.query_id }).first();
    expect(log).toBeTruthy();
    expect(log.user_name).toBe('tester');
  });

  it('SQL 片段输入 → proc_analysis 路由，输出结构信息', async () => {
    const sql = `INSERT INTO dws_cust_asset_d SELECT a.cust_id, SUM(b.bal)
      FROM ods_acct_bal b LEFT JOIN dim_cust a ON a.cust_id=b.cust_id WHERE b.etl_dt='20260101' GROUP BY a.cust_id;`;
    const report = await workflow.analyze(sql, 'tester');
    expect(report.route).toBe('proc_analysis');
    const causes = report.sections.find((s) => s.key === 'causes')?.causes || [];
    expect(causes.some((c) => c.title.includes('LEFT JOIN'))).toBe(true);
  });

  it('反馈确认 → 自动沉淀案例', async () => {
    const report = await workflow.analyze('ads_cust_asset_rpt 数字偏低', 'tester');
    const fb = await workflow.saveFeedback(
      { query_id: report.query_id, helpful: 'yes', confirmed_cause: '上游维表刷新失败导致关联不上' },
      'tester',
    );
    expect(fb.ok).toBe(true);
    expect(fb.caseId).toBeTruthy();
    const row = await ctx.db('cases').where({ case_id: fb.caseId }).first();
    expect(row.created_by).toBe('tester');
    await ctx.db('cases').where({ case_id: fb.caseId }).del();
  });
});

describe('LLM 综合分析联动（stub LLM）', () => {
  it('LLM 启用时：上下文包被调用，aiAnalysis 挂入报告并落审计', async () => {
    const seen: any[] = [];
    const stubLlm = {
      enabled: true,
      analyzeWithContext: async (ctx: any) => {
        seen.push(ctx);
        return {
          llmSummary: '最可能根因是上游维表未刷新',
          topCause: '上游维表未刷新导致关联不上',
          confidence: '高',
          evidenceRefs: ['命中案例 TKT-2026-0021'],
          verifySql: ['SELECT COUNT(*) FROM dim_cust'],
          steps: ['刷新维表后重跑'],
        };
      },
    };
    const entity = new EntityExtractService(ctx.db, ctx.graph);
    const rules = new RulesService(ctx.db, ctx.graph);
    const proc = new ProcAnalysisService(ctx.db, ctx.graph, rules);
    const retrieval = new RetrievalService(ctx.db, new Bm25SearchAdapter());
    const verify = new VerifySqlService(ctx.graph);
    const wf = new WorkflowService(ctx.db, ctx.graph, entity, rules, proc, retrieval, verify, stubLlm as any);

    const report = await wf.analyze('dws_cust_asset_d 数据量骤降', 'tester');
    expect(report.aiAnalysis).toBeTruthy();
    expect(report.aiAnalysis!.confidence).toBe('高');
    expect(report.aiAnalysis!.steps).toEqual(['刷新维表后重跑']);
    expect(report.llmSummary).toBe('最可能根因是上游维表未刷新');
    // 上下文包包含用户输入与实体
    expect(seen[0].input).toContain('dws_cust_asset_d');
    expect(seen[0].entities).toContain('表:dws_cust_asset_d');
    // 审计落库含 aiAnalysis
    const log = await ctx.db('query_log').where({ query_id: report.query_id }).first();
    expect(JSON.parse(log.report_json).aiAnalysis.topCause).toContain('维表');
  });

  it('LLM 抛错时降级：无 aiAnalysis、记录 llmError、报告仍可用', async () => {
    const stubLlm = {
      enabled: true,
      analyzeWithContext: async () => {
        throw new Error('LLM 超时');
      },
    };
    const entity = new EntityExtractService(ctx.db, ctx.graph);
    const rules = new RulesService(ctx.db, ctx.graph);
    const proc = new ProcAnalysisService(ctx.db, ctx.graph, rules);
    const retrieval = new RetrievalService(ctx.db, new Bm25SearchAdapter());
    const verify = new VerifySqlService(ctx.graph);
    const wf = new WorkflowService(ctx.db, ctx.graph, entity, rules, proc, retrieval, verify, stubLlm as any);

    const report = await wf.analyze('job_dwd_txnl_clean 失败', 'tester');
    expect(report.aiAnalysis).toBeUndefined();
    expect(report.llmError).toContain('LLM 超时');
    expect(report.sections.find((s) => s.key === 'causes')).toBeTruthy();
  });
});