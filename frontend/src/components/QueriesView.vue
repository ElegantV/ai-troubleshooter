<template>
  <div class="panel">
    <h3>🕓 排查历史（审计留痕，归属到人；点击行复看完整报告）</h3>
    <el-table :data="items" size="small" v-loading="loading">
      <el-table-column label="时间" width="165">
        <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column prop="user" label="操作人" width="130" show-overflow-tooltip />
      <el-table-column prop="input" label="输入" show-overflow-tooltip />
      <el-table-column label="场景" width="110">
        <template #default="{ row }"><el-tag size="small" effect="plain">{{ ROUTE_LABEL[row.route] || row.route }}</el-tag></template>
      </el-table-column>
      <el-table-column label="置信度" width="80">
        <template #default="{ row }">
          <el-tag size="small" :type="row.confidence === '高' ? 'danger' : row.confidence === '中' ? 'warning' : 'info'">{{ row.confidence }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column width="70">
        <template #default="{ row }">
          <el-button size="small" text type="primary" @click="open(row)">查看</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div style="margin-top:10px;text-align:center" v-if="items.length < total">
      <el-button size="small" @click="loadMore">加载更多（{{ items.length }}/{{ total }}）</el-button>
    </div>

    <el-dialog v-model="dlg" title="排查报告复看" width="780px" top="4vh" destroy-on-close>
      <div v-if="detail" style="font-size:12px;color:#6b7280;margin-bottom:8px">
        {{ fmtTime(detail.created_at) }} · 操作人 {{ detail.user }}
        <template v-if="detail.confirmed_cause"> · 确认原因：{{ detail.confirmed_cause }}</template>
      </div>
      <ReportView v-if="detail" :report="detail.report" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { api, ui, ROUTE_LABEL } from '../store';
import ReportView from './ReportView.vue';

const items = ref([]);
const total = ref(0);
const loading = ref(false);
const dlg = ref(false);
const detail = ref(null);
const PAGE = 20;

const fmtTime = s => String(s || '').slice(0, 19).replace('T', ' ');

async function load(offset) {
  loading.value = true;
  try {
    const r = await api(`/api/queries?limit=${PAGE}&offset=${offset}`);
    total.value = r.total;
    items.value = offset === 0 ? r.items : [...items.value, ...r.items];
  } finally { loading.value = false; }
}
const loadMore = () => load(items.value.length);

async function open(row) {
  detail.value = await api('/api/queries/' + row.query_id);
  dlg.value = true;
}

watch(() => ui.activeTab, v => { if (v === 'queries') load(0); }, { immediate: true });
</script>
