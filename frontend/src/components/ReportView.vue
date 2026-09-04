<template>
  <div class="panel" v-if="report">
    <el-alert :title="`结论 · 置信度${report.confidence}`" :type="alertType" :description="report.summary" show-icon :closable="false" />
    <div v-if="report.llmSummary" class="llm-note">🤖 AI 归纳：{{ report.llmSummary }}</div>

    <template v-for="s in report.sections" :key="s.key">
      <!-- 候选原因 -->
      <template v-if="s.key === 'causes' && s.causes.length">
        <h3>📌 {{ s.title }}</h3>
        <div v-for="(c, i) in s.causes" :key="i" class="cause">
          <div class="cause-head">
            <div class="title">{{ c.title }}</div>
            <el-tag :type="confTag(c.confidence)" size="small">{{ c.confidence }} · {{ c.score }}</el-tag>
          </div>
          <div class="type">归因途径：{{ c.type }}</div>
          <ul class="plain"><li v-for="(e, j) in c.evidence" :key="j">{{ e }}</li></ul>
        </div>
      </template>

      <!-- 验证 SQL -->
      <template v-else-if="s.key === 'sql' && s.sqls.length">
        <h3>🧪 {{ s.title }}</h3>
        <template v-for="(q, i) in s.sqls" :key="i">
          <div class="sql-purpose">{{ q.purpose }}</div>
          <pre class="sql">{{ q.sql }}</pre>
        </template>
      </template>

      <!-- 表结构 -->
      <template v-else-if="s.key === 'structures' && s.tables.length">
        <h3>🗄 {{ s.title }}</h3>
        <div v-for="t in s.tables" :key="t.name" class="cause">
          <div class="cause-head">
            <div class="title">▤ {{ t.name }}</div>
            <el-tag :type="t.inKb ? 'primary' : 'info'" size="small">{{ t.inKb ? '在库' : '知识库外' }}</el-tag>
          </div>
          <div class="type">{{ t.comment }}</div>
          <el-table v-if="t.columns.length" :data="t.columns.map(c => ({ col: c[0], type: c[1], nullable: c[2], comment: c[3] }))" size="small" style="margin-top:6px">
            <el-table-column prop="col" label="列" width="150" /><el-table-column prop="type" label="类型" width="110" />
            <el-table-column prop="nullable" label="约束" width="90" /><el-table-column prop="comment" label="说明" />
          </el-table>
        </div>
      </template>

      <!-- 影响范围 / 参考案例 等列表 -->
      <template v-else-if="(s.key === 'impact' || s.key === 'refs') && s.items.length">
        <h3>{{ s.key === 'impact' ? '🌐' : '📚' }} {{ s.title }}</h3>
        <ul class="plain"><li v-for="(i, j) in s.items" :key="j">{{ i }}</li></ul>
      </template>

      <!-- 处置步骤 -->
      <template v-else-if="s.key === 'solution'">
        <h3>🛠 {{ s.title }}</h3>
        <ol class="steps"><li v-for="(i, j) in s.items" :key="j">{{ i }}</li></ol>
        <div v-if="s.source" class="src">依据：{{ s.source }}</div>
      </template>
    </template>

    <!-- 反馈沉淀闭环 -->
    <el-divider />
    <div style="font-size:13px;font-weight:600;margin-bottom:8px">本次排查是否帮助你定位问题？（确认后自动沉淀案例，持续提升准确率）</div>
    <template v-if="!fbDone">
      <el-button size="small" @click="causeInput = true">👍 有帮助</el-button>
      <el-button size="small" @click="submitFb('no', '')">👎 没帮助</el-button>
      <div v-if="causeInput" style="display:flex;gap:8px;margin-top:10px">
        <el-input v-model="cause" placeholder="请确认实际原因（沉淀为案例，必填）" />
        <el-button type="primary" @click="submitFb('yes', cause)">提交反馈</el-button>
      </div>
    </template>
    <div v-else class="src">✅ {{ fbDone }}</div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../store';

const props = defineProps({ report: { type: Object, required: true } });

const alertType = computed(() => (props.report.confidence === '高' ? 'success' : props.report.confidence === '中' ? 'warning' : 'info'));
const confTag = c => (c === '高' ? 'danger' : c === '中' ? 'warning' : 'info');

const causeInput = ref(false);
const cause = ref('');
const fbDone = ref('');

async function submitFb(helpful, confirmed) {
  if (helpful === 'yes' && !confirmed) { ElMessage.warning('请填写实际原因，以便沉淀案例'); return; }
  const r = await api('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({ query_id: props.report.query_id, helpful, confirmed_cause: confirmed, note: '' }),
  });
  ElMessage.info(r.message || '已提交');
  if (r.caseId) { fbDone.value = r.message; causeInput.value = false; }
}
</script>

<style scoped>
.cause-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.llm-note { margin-top: 8px; font-size: 13px; color: #374151; background: #f5f3ff; border-left: 4px solid #8b5cf6; padding: 8px 10px; border-radius: 6px; }
</style>
