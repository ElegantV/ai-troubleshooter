<template>
  <div class="panel">
    <el-input v-model="input" type="textarea" :rows="5" resize="vertical"
      placeholder="不限输入类型，系统自动识别：① 粘贴存储过程/SQL 片段（解析血缘+静态风险分析）② 异常表名/字段名（数据异常排查）③ 失败作业名/报错日志（作业失败排查）" />
    <div class="row" style="display:flex;gap:10px;margin-top:10px;align-items:center;flex-wrap:wrap">
      <el-button type="primary" :loading="busy" @click="go">开始分析</el-button>
      <span class="examples">示例：
        <el-link v-for="ex in examples" :key="ex.label" type="primary" @click="input = ex.text; go()">{{ ex.label }}</el-link>
      </span>
    </div>
  </div>
  <ReportView v-if="report" :report="report" />
  <div v-else-if="errText" class="panel"><el-alert type="error" :title="errText" :closable="false" show-icon /></div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api, ui } from '../store';
import ReportView from './ReportView.vue';

const SAMPLE_PROC = `INSERT INTO dwd_txnl_detail_d
    (txnl_id, cust_id, acct_no, txnl_type, txnl_amt, txnl_dt, data_dt)
SELECT t.txnl_id, c.cust_id, t.acct_no, t.txnl_type, t.txnl_amt, t.txnl_dt, '20260903'
FROM ods_txnl_detail t
LEFT JOIN dim_cust c ON t.acct_no = c.acct_no;`;

const input = ref('');
const busy = ref(false);
const report = ref(null);
const errText = ref('');

const examples = [
  { label: '存储过程分析', text: SAMPLE_PROC },
  { label: '作业失败排查', text: 'job_dwd_txnl_clean 昨晚失败了，报 ORA-01400，下游日报也没生成' },
  { label: '数据异常排查', text: 'dws_cust_asset_d 昨天数据量骤降，客户资产汇总缺失' },
  { label: '仅字段输入', text: 'cust_id 这个字段昨天好多空的' },
  { label: '死锁排查', text: 'job_dws_asset_agg 晚上失败了，报 ORA-00060 死锁' },
  { label: '文件超时排查', text: 'job_ods_cust_info_load 昨天文件超时失败' },
];

async function go() {
  const text = input.value.trim();
  if (!text) { ElMessage.warning('请输入异常描述'); return; }
  busy.value = true;
  report.value = null;
  errText.value = '';
  try {
    const r = await api('/api/troubleshoot', { method: 'POST', body: JSON.stringify({ text }) });
    if (r.error) errText.value = r.error;
    else report.value = r;
  } catch (e) {
    errText.value = '请求失败：' + e.message;
  }
  busy.value = false;
}

// 能力图示/演示卡"试一试"联动
watch(() => ui.pendingInput, v => {
  if (v) { input.value = v; ui.pendingInput = null; go(); }
});
</script>
