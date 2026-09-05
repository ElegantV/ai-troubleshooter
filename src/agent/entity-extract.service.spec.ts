import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestCtx, destroyCtx, TestCtx } from '../../test/helpers';
import { EntityExtractService } from './entity-extract.service';

let ctx: TestCtx;
let svc: EntityExtractService;

beforeAll(async () => {
  ctx = await createTestCtx();
  svc = new EntityExtractService(ctx.db, ctx.graph);
});

afterAll(async () => {
  await destroyCtx(ctx);
});

describe('实体识别与场景路由', () => {
  it('作业失败：识别作业名，昨天 → 最新数据日期', async () => {
    const ent = await svc.extract('job_ods_cust_info_load 昨天文件超时失败');
    expect(ent.route).toBe('job_failure');
    expect(ent.jobs).toContain('job_ods_cust_info_load');
    expect(ent.date).toBeTruthy();
  });

  it('数据异常：识别表名', async () => {
    const ent = await svc.extract('ads_cust_asset_rpt 没有最新数据，业务取数报错');
    expect(ent.route).toBe('data_anomaly');
    expect(ent.tables).toContain('ads_cust_asset_rpt');
  });

  it('存储过程分析：SQL 片段自动路由', async () => {
    const ent = await svc.extract('INSERT INTO dws_cust_asset_d SELECT * FROM ods_acct_bal WHERE etl_dt=...');
    expect(ent.route).toBe('proc_analysis');
  });

  it('错误码识别 ORA-xxxxx', async () => {
    const ent = await svc.extract('作业报 ORA-01400，请排查');
    expect(ent.errorCode).toBe('ORA-01400');
  });

  it('显式日期解析', async () => {
    const ent = await svc.extract('20260201 跑批失败');
    expect(ent.date).toBe('20260201');
  });

  it('按所属系统收敛候选：master 用户命中主数据作业，core 用户不命中', async () => {
    const text = 'job_ods_cust_info_load 昨天文件超时失败';
    const byMaster = await svc.extract(text, 'master');
    expect(byMaster.jobs).toContain('job_ods_cust_info_load');
    expect(byMaster.route).toBe('job_failure');
    const byCore = await svc.extract(text, 'core');
    expect(byCore.jobs).not.toContain('job_ods_cust_info_load');
  });

  it('未指定系统（公共）用户：全部实体可见', async () => {
    const byPublic = await svc.extract('job_dwd_txnl_clean 失败', '');
    expect(byPublic.jobs).toContain('job_dwd_txnl_clean');
    const byCore = await svc.extract('job_dwd_txnl_clean 失败', 'core');
    expect(byCore.jobs).toContain('job_dwd_txnl_clean'); // 属于 core 系统
  });
});