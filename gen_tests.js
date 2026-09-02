/** 生成正式测试用例文档: node gen_tests.js → docs/测试用例-AI问题排查助手.xlsx */
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

// ============ 用例数据 ============
const S1 = 'job_dwd_txnl_clean 昨晚失败了，报 ORA-01400，下游日报也没生成';
const S2 = 'dws_cust_asset_d 昨天数据量骤降，客户资产汇总缺失';
const S3 = "INSERT INTO dwd_txnl_detail_d (txnl_id, cust_id, acct_no, txnl_type, txnl_amt, txnl_dt, data_dt)\nSELECT t.txnl_id, c.cust_id, t.acct_no, t.txnl_type, t.txnl_amt, t.txnl_dt, '20260903'\nFROM ods_txnl_detail t\nLEFT JOIN dim_cust c ON t.acct_no = c.acct_no;";
const S4 = 'cust_id 这个字段昨天好多空的';
const S5 = 'job_dws_asset_agg 晚上失败了，报 ORA-00060 死锁';
const S6 = 'job_ods_cust_info_load 昨天文件超时失败';
const S7 = 'dwd_txnl_detail_d 昨天数据量骤降四分之一，交易类型可能有问题';
const CE_INPUT = {
  title: 'job_dwd_txnl_clean 跑批超时被调度杀掉',
  symptom: 'job_dwd_txnl_clean 昨天运行 2 小时被调度平台超时强杀，无数据库报错，dwd_txnl_detail_d 分区未生成',
  root: 'ods_txnl_detail 当日分区未建索引且统计信息过期，清洗作业全表扫描耗时劣化',
  solution: '1. 收集 ods_txnl_detail 统计信息；2. 重跑作业；3. 批量窗口前自动收集统计信息',
};

const CASES = [
  // —— 模块A 输入路由 ——
  { id: 'TC-RT-001', mod: '输入路由', title: '作业失败描述自动路由到作业失败排查', pri: '高',
    pre: '服务已启动（npm start），知识库已完成 npm run build 初始化',
    steps: '1. 打开 http://localhost:3000\n2. 在"智能排查"输入框粘贴测试数据\n3. 点击【开始分析】',
    data: S1,
    expect: '1. 报告标题为"作业失败排查"\n2. 结论区置信度为"高"\n3. 候选原因第1条命中历史工单 TKT-2026-0158（ORA-01400 CUST_ID 为空）' },
  { id: 'TC-RT-002', mod: '输入路由', title: '表名+异常描述自动路由到数据异常排查', pri: '高',
    pre: '同 TC-RT-001',
    steps: '1. 清空输入框\n2. 粘贴测试数据\n3. 点击【开始分析】',
    data: S2,
    expect: '1. 报告标题为"数据异常排查"\n2. 候选原因命中 TKT-2025-0930（数据量骤降）\n3. 影响范围包含下游表 ads_cust_asset_rpt' },
  { id: 'TC-RT-003', mod: '输入路由', title: '存储过程 SQL 自动路由到存储过程分析', pri: '高',
    pre: '同 TC-RT-001',
    steps: '1. 清空输入框\n2. 粘贴测试数据（多行 SQL）\n3. 点击【开始分析】',
    data: S3,
    expect: '1. 报告标题为"存储过程分析"\n2. 报告依次包含：对象识别与血缘链路、风险点与问题方向、相关表结构、建议验证 SQL' },
  { id: 'TC-RT-004', mod: '输入路由', title: '仅输入字段名时的候选表定位', pri: '中',
    pre: '同 TC-RT-001',
    steps: '1. 清空输入框\n2. 输入测试数据\n3. 点击【开始分析】',
    data: S4,
    expect: '1. 路由为数据异常排查\n2. 候选原因包含"字段定位"，列出 4 张含 cust_id 的候选表（ods_cust_info、dim_cust、dwd_txnl_detail_d、dws_cust_asset_d）\n3. 每张候选表附加工作业与当日状态' },

  // —— 模块B 作业失败排查 ——
  { id: 'TC-JF-001', mod: '作业失败排查', title: '死锁场景命中正确工单', pri: '高',
    pre: '知识库含 20260902 死锁日志与 TKT-2026-0071 工单',
    steps: '1. 粘贴测试数据\n2. 点击【开始分析】\n3. 检查候选原因与处置步骤',
    data: S5,
    expect: '1. 候选原因第1条命中 TKT-2026-0071（ORA-00060 死锁）\n2. 处置步骤含"错峰调度/统一表更新顺序"相关内容且分步编号\n3. 依据来源显示"工单 TKT-2026-0071"' },
  { id: 'TC-JF-002', mod: '作业失败排查', title: '文件超时场景命中 FTP-TIMEOUT 工单', pri: '高',
    pre: '知识库含 20260903 文件超时日志与 TKT-2025-1733 工单',
    steps: '1. 粘贴测试数据\n2. 点击【开始分析】',
    data: S6,
    expect: '候选原因命中 TKT-2025-1733（节假日批量文件集中延迟），处置步骤含"重试策略/节假日日历"相关内容' },
  { id: 'TC-JF-003', mod: '作业失败排查', title: '影响范围完整性（下游作业+未产出表）', pri: '中',
    pre: '同 TC-RT-001',
    steps: '1. 使用 TC-RT-001 的测试数据执行排查\n2. 检查"影响范围"清单',
    data: S1,
    expect: '影响范围包含：2 个下游作业（job_dws_asset_agg、job_ads_rpt_gen，状态 SKIPPED）与 3 张当日未产出表（dwd_txnl_detail_d、dws_cust_asset_d、ads_cust_asset_rpt）' },
  { id: 'TC-JF-004', mod: '作业失败排查', title: '验证 SQL 只读性校验', pri: '中',
    pre: '已生成任一排查报告',
    steps: '1. 展开报告"建议验证 SQL"区域\n2. 逐条检查 SQL 语句类型',
    data: '—（复用任一排查报告）',
    expect: '所有验证 SQL 均为 SELECT 语句，不含 INSERT/UPDATE/DELETE/DROP/TRUNCATE 等写操作关键字' },

  // —— 模块C 数据异常排查 ——
  { id: 'TC-DA-001', mod: '数据异常排查', title: '数据骤降场景定位与下游传导', pri: '高',
    pre: '知识库含 20260901 及以后的跑批日志',
    steps: '1. 粘贴测试数据\n2. 点击【开始分析】',
    data: S2,
    expect: '1. 产出作业 job_dws_asset_agg 当日状态被正确展示（SKIPPED）\n2. 影响范围显示异常向 ads_cust_asset_rpt 传导' },
  { id: 'TC-DA-002', mod: '数据异常排查', title: '码值缺失场景生成验证 SQL', pri: '中',
    pre: '同 TC-RT-001',
    steps: '1. 粘贴测试数据\n2. 点击【开始分析】\n3. 检查"建议验证 SQL"',
    data: S7,
    expect: '包含"dwd_txnl_detail_d 当日与前日分区行数对比"SQL，且日期参数为实际数据日期（20260903/20260902）' },

  // —— 模块D 存储过程分析 ——
  { id: 'TC-PA-001', mod: '存储过程分析', title: '静态风险规则完整触发', pri: '高',
    pre: '同 TC-RT-001',
    steps: '1. 粘贴测试数据（含 LEFT JOIN、无分区过滤、无先删后插的 SQL）\n2. 点击【开始分析】\n3. 检查"风险点与问题方向"',
    data: S3,
    expect: '风险点包含以下三条静态分析：\n1. LEFT JOIN 空值风险（涉及非空列 txnl_id、data_dt，评分 8.2）\n2. 来源表未按数据日期过滤（etl_dt，评分 7.5）\n3. 未见先清理目标表逻辑（评分 7）' },
  { id: 'TC-PA-002', mod: '存储过程分析', title: '血缘解析与作业匹配完整性', pri: '中',
    pre: '同 TC-RT-001',
    steps: '1. 使用 TC-RT-003 测试数据\n2. 检查"对象识别与血缘链路"清单',
    data: S3,
    expect: '清单包含：目标表 dwd_txnl_detail_d【在库】、来源表 ods_txnl_detail 与 dim_cust【在库】、LEFT JOIN dim_cust、疑似作业 job_dwd_txnl_clean、上游来源 3 张、下游消费 2 张' },
  { id: 'TC-PA-003', mod: '存储过程分析', title: '相关表结构展示', pri: '中',
    pre: '同 TC-RT-001',
    steps: '1. 使用 TC-RT-003 测试数据\n2. 检查"相关表结构"区域',
    data: S3,
    expect: '1. 展示 ods_txnl_detail、dim_cust、dwd_txnl_detail_d 三张表的列/类型/约束/说明\n2. 每张表列数≥5\n3. 主键列（如 txnl_id）约束显示"非空"' },
  { id: 'TC-PA-004', mod: '存储过程分析', title: '知识库外对象的血缘覆盖提示', pri: '低',
    pre: '同 TC-RT-001',
    steps: '1. 在 TC-RT-003 测试数据的 FROM 子句中追加一张不存在的表（如 new_src_table）\n2. 点击【开始分析】',
    data: '在 S3 的 FROM 后追加：new_src_table',
    expect: '1. 对象识别中新表标记为【知识库外】\n2. 风险点出现"血缘覆盖"条目，提示补齐元数据采集' },

  // —— 模块E 案例录入 ——
  { id: 'TC-CE-001', mod: '案例录入', title: '正常录入新案例', pri: '高',
    pre: '知识库已重新初始化，案例数为 0',
    steps: '1. 切换到"案例库"页签\n2. 按测试数据填写四项必填项\n3. 点击【提交案例】',
    data: `案例标题：${CE_INPUT.title}\n问题现象：${CE_INPUT.symptom}\n根因分析：${CE_INPUT.root}\n解决方式：${CE_INPUT.solution}`,
    expect: '1. 提示"已录入案例 CASE-*，立即参与智能排查匹配"\n2. 案例列表条数由 0 变为 1，来源显示"人工录入"' },
  { id: 'TC-CE-002', mod: '案例录入', title: '关联对象自动识别', pri: '高',
    pre: 'TC-CE-001 已执行',
    steps: '1. 检查 TC-CE-001 提交后绿色提示区内容\n2. 检查案例列表新案例的标签',
    data: '—（检查 TC-CE-001 的结果）',
    expect: '1. 提示"系统自动识别：作业 job_dwd_txnl_clean、表 ods_txnl_detail、dwd_txnl_detail_d"\n2. 案例卡片下方标签含 ⚙ job_dwd_txnl_clean、▤ ods_txnl_detail、▤ dwd_txnl_detail_d' },
  { id: 'TC-CE-003', mod: '案例录入', title: '重复现象录入拦截', pri: '高',
    pre: 'TC-CE-001 已执行',
    steps: '1. 再次按 TC-CE-001 相同的现象文本填写\n2. 点击【提交案例】',
    data: '与 TC-CE-001 完全相同的现象文本（其余字段可任意）',
    expect: '提交被拒绝，红字提示"知识库中已存在相同现象的案例（CASE-*），无需重复录入"，案例总数不变' },
  { id: 'TC-CE-004', mod: '案例录入', title: '必填项校验', pri: '中',
    pre: '页面处于案例录入表单',
    steps: '1. 仅填写"案例标题"\n2. 其余必填项留空\n3. 点击【提交案例】',
    data: '案例标题：测试校验',
    expect: '红字提示"请填写：问题现象"，不产生新案例' },
  { id: 'TC-CE-005', mod: '案例录入', title: '录入案例参与后续检索（闭环）', pri: '高',
    pre: 'TC-CE-001 已执行且录入成功',
    steps: '1. 切换到"智能排查"页签\n2. 输入与所录案例现象相近的文本\n3. 点击【开始分析】',
    data: 'job_dwd_txnl_clean 昨天跑了很久被超时杀掉了',
    expect: '候选原因第1条命中刚录入的 CASE-*，匹配依据含"关联作业 job_dwd_txnl_clean"；处置步骤引用所录案例的解决方式' },

  // —— 模块F 反馈沉淀闭环 ——
  { id: 'TC-FB-001', mod: '反馈沉淀', title: '确认原因后自动沉淀案例', pri: '高',
    pre: '已存在任一排查报告',
    steps: '1. 在报告底部点击【👍 有帮助】\n2. 在输入框填写实际原因\n3. 点击【提交反馈】',
    data: '实际原因：上游 job_dwd_txnl_clean 失败未逐级重跑导致汇总缺失',
    expect: '提示"反馈已记录，并已沉淀为案例 CASE-*"，案例列表新增一条来源为"用户反馈沉淀"的案例' },
  { id: 'TC-FB-002', mod: '反馈沉淀', title: '有帮助但未填原因的校验', pri: '中',
    pre: '已存在任一排查报告',
    steps: '1. 点击【👍 有帮助】\n2. 原因输入框留空\n3. 点击【提交反馈】',
    data: '—',
    expect: '提示"请填写实际原因，以便沉淀案例"，不产生新案例' },

  // —— 模块G 边界与异常 ——
  { id: 'TC-BV-001', mod: '边界异常', title: '空输入防护', pri: '高',
    pre: '服务已启动',
    steps: '1. 输入框保持为空\n2. 点击【开始分析】',
    data: '（空字符串）',
    expect: '页面底部弹出提示"请输入异常描述"，不发起请求、页面不报错' },
  { id: 'TC-BV-002', mod: '边界异常', title: '无意义输入友好降级', pri: '中',
    pre: '服务已启动',
    steps: '1. 输入无关联词汇的文本\n2. 点击【开始分析】',
    data: '今天天气怎么样',
    expect: '返回友好提示（未识别场景/请补充表名、作业名或报错日志），HTTP 不返回 500，页面不崩溃' },
  { id: 'TC-BV-003', mod: '边界异常', title: '超长输入不崩溃', pri: '中',
    pre: '服务已启动',
    steps: '1. 粘贴 5000 字符以上的长文本（可重复拼接 TC-RT-003 的 SQL）\n2. 点击【开始分析】',
    data: 'S3 重复粘贴约 20 次（>5000 字符）',
    expect: '系统正常处理或返回友好提示，无白屏/未捕获异常' },

  // —— 模块H 能力图示 ——
  { id: 'TC-GV-001', mod: '能力图示', title: '三大能力展示完整性', pri: '中',
    pre: '服务已启动',
    steps: '1. 点击"能力图示（血缘 / 链路 / 案例）"页签\n2. 依次检查三个区域',
    data: '—',
    expect: '1. 显示三张概念卡（血缘关联/作业链路/案例关联）\n2. 显示血缘×链路关系图（SVG，含 ODS/DIM/DWD/DWS/ADS 五层、蓝/绿节点与连线）\n3. 显示三个真实演示卡，各带【▶ 试一试】按钮' },
  { id: 'TC-GV-002', mod: '能力图示', title: '演示卡一键联动排查', pri: '中',
    pre: '能力图示页已打开',
    steps: '1. 点击"血缘关联"演示卡的【▶ 试一试】\n2. 观察页面行为与报告',
    data: '—（按钮自带输入：ads_cust_asset_rpt 没有最新数据…）',
    expect: '自动切回"智能排查"页签并填入对应文本，生成数据异常排查报告' },

  // —— 模块I 审计 ——
  { id: 'TC-AU-001', mod: '审计留痕', title: '查询记录落库', pri: '低',
    pre: '已执行过至少一次排查',
    steps: '1. 在项目目录执行：node -e "const{DatabaseSync}=require(\'node:sqlite\');const db=new DatabaseSync(\'data/assistant.db\',{readOnly:true});console.log(db.prepare(\'SELECT query_id,input_text,created_at FROM query_log ORDER BY created_at DESC LIMIT 3\').all())"',
    data: '—',
    expect: '能查询到最近排查记录（query_id、输入文本、时间），且最新一条与刚才的排查输入一致' },
];

// ============ 生成工作簿 ============
(async () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Z.ai';

  // ---- Sheet1 测试说明 ----
  const ws1 = wb.addWorksheet('测试说明', { properties: { defaultRowHeight: 18 } });
  ws1.columns = [{ width: 18 }, { width: 100 }];
  const title = ws1.getCell('A1');
  title.value = 'AI 问题排查助手（原型 v0.2）测试用例文档';
  title.font = { size: 16, bold: true, color: { argb: 'FF1E3A8A' } };
  ws1.mergeCells('A1:B1');
  ws1.getRow(1).height = 30;

  const byMod = {}, byPri = {};
  CASES.forEach(c => { byMod[c.mod] = (byMod[c.mod] || 0) + 1; byPri[c.pri] = (byPri[c.pri] || 0) + 1; });
  const info = [
    ['一、测试对象', 'AI 问题排查助手原型 v0.2（数据异常与批量作业失败智能排查）'],
    ['二、测试范围', '输入路由、作业失败排查、数据异常排查、存储过程分析、案例录入、反馈沉淀闭环、边界与异常输入、能力图示、审计留痕'],
    ['三、测试类型', '功能测试、边界测试、异常（负面）测试、闭环业务流测试、UI 交互测试'],
    ['四、测试环境', `Windows 10+ / Node.js ≥ 22（需内置 node:sqlite）/ Chrome 或 Edge 浏览器`],
    ['五、环境准备', '项目根目录执行：\n1. npm install（安装依赖）\n2. npm run build（初始化知识库，案例库清零——执行后用例中"案例数为 0"的前置条件成立）\n3. npm start（启动服务，输出 http://localhost:3000）'],
    ['六、执行说明', '1. 按用例编号顺序执行（TC-CE-005 依赖 TC-CE-001 产生数据）\n2. 严格按"测试数据"列原文输入，勿自行改写\n3. 将实际表现记入"实际结果"列，并在"测试结论"列下拉选择\n4. 结论为"不通过"时，在"缺陷记录"表登记缺陷并回填关联用例编号'],
    ['七、用例统计', `共 ${CASES.length} 条：按模块 — ${Object.entries(byMod).map(([k, v]) => `${k}${v}条`).join('、')}；按优先级 — ${Object.entries(byPri).map(([k, v]) => `${k}${v}条`).join('、')}`],
    ['八、准出标准', '高优先级用例 100% 通过，中优先级通过率 ≥ 90%，低优先级无致命/严重缺陷遗留，视为本轮测试通过'],
  ];
  info.forEach(([k, v], i) => {
    const r = ws1.getRow(i + 3);
    r.getCell(1).value = k;
    r.getCell(1).font = { bold: true, color: { argb: 'FF1E3A8A' } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    r.getCell(2).value = v;
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    [1, 2].forEach(c => { r.getCell(c).border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }; });
    if (String(v).includes('\n')) r.height = 16 * String(v).split('\n').length;
  });

  // ---- Sheet2 测试用例 ----
  const ws2 = wb.addWorksheet('测试用例', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws2.columns = [
    { header: '用例编号', width: 13 }, { header: '所属模块', width: 13 }, { header: '用例标题', width: 30 },
    { header: '优先级', width: 8 }, { header: '前置条件', width: 26 }, { header: '测试步骤', width: 34 },
    { header: '测试数据（原文输入）', width: 48 }, { header: '预期结果', width: 48 },
    { header: '实际结果（执行时填写）', width: 26 }, { header: '测试结论', width: 11 }, { header: '备注', width: 16 },
  ];
  ws2.getRow(1).height = 24;
  ws2.getRow(1).eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  });
  CASES.forEach((c, idx) => {
    const row = ws2.addRow([c.id, c.mod, c.title, c.pri, c.pre, c.steps, c.data, c.expect, '', '未执行', '']);
    row.eachCell((cell, col) => {
      cell.alignment = { wrapText: true, vertical: 'top' };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
    row.getCell(4).font = { bold: true, color: { argb: c.pri === '高' ? 'FFB91C1C' : c.pri === '中' ? 'FF92400E' : 'FF4B5563' } };
    row.getCell(1).font = { bold: true };
    const lines = Math.max(c.steps.split('\n').length, c.expect.split('\n').length, c.data.split('\n').length);
    row.height = Math.max(30, lines * 14);
  });
  for (let r = 2; r <= CASES.length + 1; r++) {
    ws2.getCell(`J${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"通过,不通过,阻塞,未执行"'] };
    ws2.getCell(`D${r}`).alignment = { horizontal: 'center', vertical: 'top' };
    ws2.getCell(`J${r}`).alignment = { horizontal: 'center', vertical: 'top' };
  }

  // ---- Sheet3 缺陷记录 ----
  const ws3 = wb.addWorksheet('缺陷记录', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws3.columns = [
    { header: '缺陷编号', width: 13 }, { header: '关联用例', width: 13 }, { header: '缺陷描述', width: 46 },
    { header: '复现步骤', width: 40 }, { header: '严重级别', width: 10 }, { header: '状态', width: 10 },
    { header: '提交人', width: 10 }, { header: '提交日期', width: 12 }, { header: '处理说明', width: 30 },
  ];
  ws3.getRow(1).eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7F1D1D' } };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  });
  ['严重级别', '状态'].forEach((h, hi) => {
    const col = hi === 0 ? 'E' : 'F';
    for (let r = 2; r <= 30; r++) {
      ws3.getCell(`${col}${r}`).dataValidation = hi === 0
        ? { type: 'list', allowBlank: true, formulae: ['"致命,严重,一般,轻微,建议"'] }
        : { type: 'list', allowBlank: true, formulae: ['"新建,处理中,已修复,已验证,关闭,挂起"'] };
    }
  });
  // 示例行
  const demo = ws3.addRow(['BUG-0001', 'TC-XX-XXX', '（示例）简述缺陷现象与期望差异', '1. …\n2. …', '一般', '新建', '', '', '']);
  demo.eachCell(c => { c.font = { color: { argb: 'FF9CA3AF' }, italic: true }; c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }; });

  fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });
  const out = path.join(__dirname, 'docs', '测试用例-AI问题排查助手-v0.2.xlsx');
  await wb.xlsx.writeFile(out);
  console.log('已生成:', out, '| 用例数:', CASES.length);
})();
