<template>
  <div class="panel">
    <h3>
      <el-icon class="h3-ico"><Clock /></el-icon>排查历史
    </h3>
    <div class="panel-sub">审计留痕，归属到人；点击行复看完整报告</div>
    <el-table :data="items" size="small" v-loading="loading" max-height="60vh">
      <el-table-column label="时间" :min-width="colW(10)">
        <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column v-if="vp.bp === 'lg'" prop="user" label="操作人" :min-width="colW(8)" show-overflow-tooltip />
      <el-table-column prop="input" label="输入" :min-width="colW(18)">
        <template #default="{ row }">
          <el-link type="primary" class="row-link" @click="open(row)">{{ row.input }}</el-link>
        </template>
      </el-table-column>
      <el-table-column v-if="vp.bp === 'lg'" label="场景" :min-width="colW(7)">
        <template #default="{ row }"
          ><el-tag size="small" effect="plain">{{ ROUTE_LABEL[row.route] || row.route }}</el-tag></template
        >
      </el-table-column>
      <el-table-column v-if="vp.bp !== 'sm'" label="置信度" :min-width="colW(6)">
        <template #default="{ row }">
          <el-tag
            size="small"
            :type="row.confidence === '高' ? 'danger' : row.confidence === '中' ? 'warning' : 'info'"
            >{{ row.confidence }}</el-tag
          >
        </template>
      </el-table-column>
      <el-table-column :min-width="colW(5)" align="right">
        <template #default="{ row }">
          <el-button size="small" text type="primary" @click="open(row)">查看</el-button>
        </template>
      </el-table-column>
      <template #empty><span class="tbl-empty">暂无排查记录</span></template>
    </el-table>
    <div class="load-more" v-if="items.length < total">
      <el-button size="small" @click="loadMore">加载更多（{{ items.length }}/{{ total }}）</el-button>
    </div>

    <el-dialog
      v-model="dlg"
      title="排查报告复看"
      class="report-dlg"
      body-class="report-dlg-body"
      width="min(48.75rem, 92vw)"
      top="4vh"
      destroy-on-close
    >
      <div v-if="detail" class="dlg-head">
        <div class="dlg-meta">
          {{ fmtTime(detail.created_at) }} · 操作人 {{ detail.user }}
          <template v-if="detail.confirmed_cause"> · 确认原因：{{ detail.confirmed_cause }}</template>
        </div>
        <div v-if="detail?.input" class="dlg-input">{{ detail.input }}</div>
      </div>
      <ReportView v-if="detail" :report="detail.report" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { Clock } from '@element-plus/icons-vue';
import { api, vp, colW, ROUTE_LABEL } from '../store';
import ReportView from './ReportView.vue';
import { fmtTime } from '../utils/format';
import { useTabReload } from '../composables/useTabReload';

const items = ref([]);
const total = ref(0);
const loading = ref(false);
const dlg = ref(false);
const detail = ref(null);
const PAGE = 20;

async function load(offset) {
  loading.value = true;
  try {
    const r = await api(`/queries?limit=${PAGE}&offset=${offset}`);
    total.value = r.total;
    items.value = offset === 0 ? r.items : [...items.value, ...r.items];
  } finally {
    loading.value = false;
  }
}
const loadMore = () => load(items.value.length);

async function open(row) {
  detail.value = await api('/queries/' + row.query_id);
  dlg.value = true;
}

useTabReload('queries', () => load(0));
</script>

<style scoped>
.tbl-empty {
  font-size: var(--fs-body);
  color: var(--ink-faint);
}

.row-link {
  font-size: var(--fs-body);
  font-weight: 400;
  justify-content: flex-start;
  text-align: left;
  line-height: 1.5;
}
.row-link :deep(.el-link__inner) {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.load-more {
  margin-top: var(--sp-3);
  text-align: center;
}

.dlg-meta {
  font-size: var(--fs-cap);
  color: var(--ink-muted);
  margin-bottom: var(--sp-2);
}

.dlg-head {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--surface);
  padding: var(--sp-3) 0 var(--sp-2);
  border-bottom: 1px solid var(--line-soft);
}

.dlg-input {
  font-size: var(--fs-body);
  color: var(--ink);
  line-height: 1.6;
  background: var(--line-soft);
  border-radius: 6px;
  padding: var(--sp-2) var(--sp-3);
  word-break: break-word;
  white-space: pre-wrap;
}
</style>

<style>
/* 复看弹窗：限高 + 头部固定 + 内容区内部滚动。
   弹窗可能被 teleport 到 body，样式不能走 scoped */
.report-dlg.el-dialog {
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin-bottom: 0;
  padding: 0;
}
.report-dlg .el-dialog__header {
  flex: none;
  padding: var(--el-dialog-padding-primary) var(--pad-panel) var(--sp-3);
  border-bottom: 1px solid var(--line-soft);
}
.report-dlg .el-dialog__headerbtn {
  top: var(--el-dialog-padding-primary);
  right: var(--pad-panel);
}
.report-dlg-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--pad-panel) var(--pad-panel);
}
/* ReportView 自带的 panel 外壳与弹窗形成双层描边，拍平融入弹窗 */
.report-dlg .panel {
  margin-top: 0;
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
}
</style>
