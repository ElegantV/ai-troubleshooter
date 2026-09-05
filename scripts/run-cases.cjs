// 测试案例批量执行：验证场景路由 / 置信度 / AI 分析
const BASE = 'http://localhost:3000/api/v1';

async function login() {
  const r = await fetch(BASE + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  });
  return (await r.json()).data.token;
}

async function troubleshoot(token, text) {
  const r = await fetch(BASE + '/troubleshoot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ text }),
  });
  const body = await r.json();
  if (body.code !== 0) return { httpError: true, code: body.code, error: body.error };
  const d = body.data;
  const ai = d.aiAnalysis || {};
  return {
    route: d.route,
    confidence: d.confidence,
    topCause: (ai.topCause || '').slice(0, 90),
    aiConfidence: ai.confidence || '-',
    causeCount: (d.sections.find((s) => s.key === 'causes')?.causes || []).length,
    hasVerifySql: (d.sections.find((s) => s.key === 'sql')?.sqls || []).length > 0,
    refCases: (d.sections.find((s) => s.key === 'refs')?.items || []).length,
  };
}

(async () => {
  const token = await login();
  const cases = [
    { name: 'C1 作业失败·死锁', text: 'job_dws_asset_agg 晚上失败了，报 ORA-00060 死锁' },
    { name: 'C2 作业失败·字段为空(关联工单)', text: 'job_dwd_txnl_clean 昨晚失败了，报 ORA-01400，下游日报也没生成' },
    { name: 'C3 数据异常·行数骤降(关联工单)', text: 'dws_cust_asset_d 昨天数据量骤降，客户资产汇总缺失' },
    { name: 'C4 存储过程·静态风险', text: "INSERT INTO dwd_txnl_detail_d (txnl_id, cust_id, acct_no, txnl_amt, txnl_dt, data_dt)\nSELECT t.txnl_id, c.cust_id, t.acct_no, t.txnl_amt, t.txnl_dt, '20260903'\nFROM ods_txnl_detail t LEFT JOIN dim_cust c ON t.acct_no = c.acct_no;" },
    { name: 'C5 仅字段·候选表定位', text: 'cust_id 这个字段昨天好多空的' },
    { name: 'C6 文件超时', text: 'job_ods_cust_info_load 昨天文件超时失败' },
    { name: 'C7 边缘·无匹配', text: '我的电脑蓝屏了怎么办' },
    { name: 'C8 边缘·超长输入', text: 'a'.repeat(6000) },
  ];
  for (const c of cases) {
    try {
      const r = await troubleshoot(token, c.text);
      console.log(JSON.stringify({ case: c.name, input: c.text.slice(0, 40), ...r }));
    } catch (e) {
      console.log(JSON.stringify({ case: c.name, error: e.message }));
    }
    await new Promise((res) => setTimeout(res, 2500)); // LLM 调用间隔
  }
})();