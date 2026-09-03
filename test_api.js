/** 端到端测试脚本: node test_api.js */
const BASE = 'http://localhost:3000';
const USER = { username: 'tester_' + Date.now(), password: 'test123456', display_name: '端到端测试员' };
let TOKEN = '';
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN });
async function post(path, body, withAuth = true) {
  const r = await fetch(BASE + path, { method: 'POST', headers: withAuth ? authHeaders() : { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function get(path) { return fetch(BASE + path, { headers: { Authorization: 'Bearer ' + TOKEN } }).then(r => r.json()); }

async function main() {
  // 认证：未登录应被拒；注册+登录后正常访问
  const denied = await post('/api/troubleshoot', { text: 'job_dwd_txnl_clean 失败' }, false);
  console.log('=== 未登录访问被拒 ===', JSON.stringify(denied));
  const reg = await post('/api/register', USER, false);
  console.log('=== 注册 ===', reg.ok ? `成功，token 已获取（用户 ${reg.user.username}/${reg.user.display_name}）` : JSON.stringify(reg));
  if (reg.token) TOKEN = reg.token; else {
    const lg = await post('/api/login', USER, false);
    console.log('=== 登录 ===', JSON.stringify(lg).slice(0, 80));
    TOKEN = lg.token;
  }
  const me = await get('/api/me');
  console.log('=== 当前用户 ===', JSON.stringify(me));

  const meta = await get('/api/meta');
  console.log('=== 知识库规模 ===');
  console.log(`工单 ${meta.tickets} 条 | 案例 ${meta.cases} 条 | 血缘边 ${meta.lineageEdges} 条 | 最新跑批日 ${meta.latestRunDate}`);

  // 场景1：作业失败（ORA-01400）
  const s1 = await post('/api/troubleshoot', { text: 'job_dwd_txnl_clean 昨晚失败了，报 ORA-01400，下游日报也没生成' });
  console.log('\n=== 场景1 作业失败(ORA-01400) ===');
  console.log('置信度:', s1.confidence, '|', s1.summary?.slice(0, 80));

  // 场景2：数据异常
  const s2 = await post('/api/troubleshoot', { text: 'dws_cust_asset_d 昨天数据量骤降，客户资产汇总缺失' });
  console.log('\n=== 场景2 数据异常(骤降) ===');
  console.log('置信度:', s2.confidence, '|', s2.summary?.slice(0, 80));

  // 场景3：死锁（真实银行场景新增）
  const s3 = await post('/api/troubleshoot', { text: 'job_dws_asset_agg 晚上失败了，报 ORA-00060 死锁' });
  console.log('\n=== 场景3 死锁(ORA-00060) ===');
  console.log('置信度:', s3.confidence, '|', s3.summary?.slice(0, 80));
  s3.sections[1].causes.slice(0, 2).forEach(c => console.log('  [' + c.confidence + ']', c.title));

  // 场景4：文件超时级联（真实银行场景新增）
  const s4 = await post('/api/troubleshoot', { text: 'job_ods_cust_info_load 昨天文件超时失败' });
  console.log('\n=== 场景4 文件超时(FTP-TIMEOUT) ===');
  console.log('置信度:', s4.confidence, '|', s4.summary?.slice(0, 80));

  // 场景5：码值缺失数据异常（真实银行场景新增）
  const s5 = await post('/api/troubleshoot', { text: 'dwd_txnl_detail_d 昨天数据量骤降四分之一，交易类型可能有问题' });
  console.log('\n=== 场景5 码值缺失(CODE-MISSING) ===');
  console.log('置信度:', s5.confidence, '|', s5.summary?.slice(0, 80));

  // 案例录入：手动录入一个知识库中不存在的新场景
  const cs = await post('/api/cases', {
    title: 'job_dwd_txnl_clean 跑批超时被调度杀掉',
    symptom: 'job_dwd_txnl_clean 昨天运行 2 小时被调度平台超时强杀，无数据库报错，dwd_txnl_detail_d 分区未生成',
    root_cause: 'ods_txnl_detail 当日分区未建索引且统计信息过期，清洗作业全表扫描耗时劣化',
    solution: '1. 收集 ods_txnl_detail 统计信息；2. 重跑作业；3. 批量窗口前自动收集统计信息',
  });
  console.log('\n=== 案例录入 ===', JSON.stringify(cs));

  // 录入后应能被排查检索命中
  const s6 = await post('/api/troubleshoot', { text: 'job_dwd_txnl_clean 昨天跑了很久被超时杀掉了' });
  console.log('\n=== 录入后再排查（应命中新案例） ===');
  console.log('置信度:', s6.confidence, '|', s6.summary?.slice(0, 80));
  const refs = s6.sections.find(s => s.key === 'refs').items;
  refs.forEach(i => console.log('  •', i.slice(0, 90)));

  // 重复录入应被拦截
  const dup = await post('/api/cases', { title: '重复', symptom: 'job_dwd_txnl_clean 昨天运行 2 小时被调度平台超时强杀，无数据库报错，dwd_txnl_detail_d 分区未生成', root_cause: 'x', solution: 'y' });
  console.log('\n=== 重复录入拦截 ===', JSON.stringify(dup));

  // 必填校验
  const bad = await post('/api/cases', { title: 'x', symptom: 'y' });
  console.log('=== 必填校验 ===', JSON.stringify(bad));

  const cases = await get('/api/cases');
  console.log('\n案例库:', cases.map(c => c.case_id + '(' + c.source + (c.created_by ? ' by ' + c.created_by : '') + ')').join(', '));
}
main().catch(e => { console.error(e); process.exit(1); });
