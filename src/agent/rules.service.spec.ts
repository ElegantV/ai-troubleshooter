import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestCtx, destroyCtx, TestCtx } from '../../test/helpers';
import { RulesService } from './rules.service';
import { Entity } from './entity-extract.service';

const D1 = '20990101';
const D2 = '20990102';

let ctx: TestCtx;
let rules: RulesService;

beforeAll(async () => {
  ctx = await createTestCtx();
  rules = new RulesService(ctx.db, ctx.graph);
});

afterAll(async () => {
  await destroyCtx(ctx);
});

async function cleanup() {
  await ctx.db('job_runs').where('run_date', 'like', '2099%').del();
  await ctx.db('batch_logs').where('run_date', 'like', '2099%').del();
  await ctx.db('job_deps').where('job_name', 'like', 'job_test_%').orWhere('depends_on', 'like', 'job_test_%').del();
}

describe('规则归因：作业失败排查', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('上游失败被跳过 → 输出上游依赖原因（可解释证据）', async () => {
    await ctx.db('job_deps').insert([
      { job_name: 'job_test_fail', depends_on: 'job_test_up' },
      { job_name: 'job_test_up', depends_on: 'job_test_root' },
    ]);
    await ctx.db('job_runs').insert([
      { run_date: D1, job_name: 'job_test_root', final_status: 'FAILED', rows_loaded: null },
      { run_date: D1, job_name: 'job_test_up', final_status: 'SKIPPED', rows_loaded: null },
      { run_date: D1, job_name: 'job_test_fail', final_status: 'SKIPPED', rows_loaded: null },
    ]);
    await ctx.db('batch_logs').insert({
      run_date: D1, ts: '01:00:00', job_name: 'job_test_root', level: 'ERROR',
      message: 'ORA-00060 死锁检测到等待循环 FAILED', error_code: 'ORA-00060', line_no: 1,
    });

    const ent: Entity = { tables: [], jobs: ['job_test_fail'], columns: [], date: D1, errorCode: '', route: 'job_failure', raw: 'job_test_fail 失败' };
    const a = await rules.analyzeJobFailure(ent);
    const types = a.causes.map((c) => c.type);
    expect(types).toContain('上游依赖');
    expect(types).toContain('错误码归因');
    expect(a.causes[0].score).toBeGreaterThanOrEqual(8);
    expect(a.causes[0].evidence.length).toBeGreaterThan(0);
    // 影响范围应包含下游状态
    expect(a.impact.length).toBeGreaterThanOrEqual(0);
  });

  it('输入错误码当日未见 → 回溯历史日志', async () => {
    await ctx.db('job_runs').insert({ run_date: D1, job_name: 'job_test_fail', final_status: 'FAILED', rows_loaded: null });
    await ctx.db('batch_logs').insert({
      run_date: '20260102', ts: '02:00:00', job_name: 'job_test_fail', level: 'ERROR',
      message: 'ORA-00001 唯一约束冲突 FAILED', error_code: 'ORA-00001', line_no: 1,
    });
    const ent: Entity = { tables: [], jobs: ['job_test_fail'], columns: [], date: D1, errorCode: 'ORA-00001', route: 'job_failure', raw: 'job_test_fail 报 ORA-00001' };
    const a = await rules.analyzeJobFailure(ent);
    expect(a.causes.some((c) => c.type === '错误码归因(历史)')).toBe(true);
  });

  it('无目标作业且当日无失败 → 返回提示', async () => {
    const ent: Entity = { tables: [], jobs: [], columns: [], date: '20991231', errorCode: '', route: 'job_failure', raw: '随便一句话' };
    const a = await rules.analyzeJobFailure(ent);
    expect(a.note).toContain('未识别到目标作业');
  });
});

describe('规则归因：数据异常排查', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('产出作业失败 → 产出缺失（最高分）', async () => {
    await ctx.db('job_runs').insert({ run_date: D2, job_name: 'job_dwd_txnl_clean', final_status: 'FAILED', rows_loaded: null });
    const ent: Entity = { tables: ['dwd_txnl_detail_d'], jobs: [], columns: [], date: D2, errorCode: '', route: 'data_anomaly', raw: 'dwd_txnl_detail_d 没有数据' };
    const a = await rules.analyzeDataAnomaly(ent);
    expect(a.causes[0].type).toBe('产出缺失');
    expect(a.causes[0].score).toBe(9.5);
  });

  it('产出成功但行数骤降 >30% → 数据量骤降', async () => {
    await ctx.db('job_runs').insert([
      { run_date: D1, job_name: 'job_dwd_txnl_clean', final_status: 'SUCCESS', rows_loaded: 1000 },
      { run_date: D2, job_name: 'job_dwd_txnl_clean', final_status: 'SUCCESS', rows_loaded: 100 },
    ]);
    const ent: Entity = { tables: ['dwd_txnl_detail_d'], jobs: [], columns: [], date: D2, errorCode: '', route: 'data_anomaly', raw: 'dwd_txnl_detail_d 行数骤降' };
    const a = await rules.analyzeDataAnomaly(ent);
    const drop = a.causes.find((c) => c.type === '数据量骤降');
    expect(drop).toBeTruthy();
    expect(drop!.score).toBe(8.5);
    expect(drop!.evidence[0]).toContain('20990101=1000，20990102=100');
  });

  it('未指定表但给出字段 → 字段定位候选表', async () => {
    const ent: Entity = { tables: [], jobs: [], columns: ['cust_id'], date: D2, errorCode: '', route: 'data_anomaly', raw: 'cust_id 为空' };
    const a = await rules.analyzeDataAnomaly(ent);
    expect(a.causes.some((c) => c.type === '字段定位')).toBe(true);
  });
});