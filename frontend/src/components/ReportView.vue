<template>
  <div class="panel" v-if="report">
    <!-- 结论（一级 · 最重） -->
    <div class="conclusion" :class="'conf-' + report.confidence">
      <div class="conclusion-head">
        <div class="conclusion-title">
          <el-icon class="conclusion-ico"><CircleCheck /></el-icon>
          <span>排查结论</span>
        </div>
        <el-tag :type="confTag(report.confidence)" size="small" effect="dark">置信度 · {{ report.confidence }}</el-tag>
      </div>
      <div class="conclusion-text">{{ report.summary }}</div>
    </div>

    <!-- AI 综合分析：只留根因，依据默认折叠（避免喧宾夺主） -->
    <div v-if="report.aiAnalysis" class="ai-card">
      <div class="ai-head">
        <span class="ai-title"
          ><el-icon class="ai-ico"><MagicStick /></el-icon>AI 综合分析</span
        >
        <el-tag
          size="small"
          :type="confTag(report.aiAnalysis.confidence)"
          effect="dark"
          v-if="report.aiAnalysis.confidence"
          >{{ report.aiAnalysis.confidence }}</el-tag
        >
      </div>
      <div class="ai-cause"><b>最可能根因：</b>{{ report.aiAnalysis.topCause }}</div>

      <button v-if="hasEvidence" class="ai-toggle" :class="{ open: aiOpen }" @click="aiOpen = !aiOpen">
        <el-icon class="ai-chev"><ArrowDown /></el-icon>
        <span>{{ aiOpen ? '收起分析依据' : '查看分析依据' }}</span>
      </button>
      <div v-if="aiOpen" class="ai-detail">
        <div v-if="report.aiAnalysis.evidenceRefs.length" class="ai-sec">
          <b>依据引用：</b>
          <ul class="plain">
            <li v-for="(e, i) in report.aiAnalysis.evidenceRefs" :key="i">{{ e }}</li>
          </ul>
        </div>
        <div v-if="report.aiAnalysis.verifySql.length" class="ai-sec">
          <b>建议验证 SQL：</b>
          <template v-for="(q, i) in report.aiAnalysis.verifySql" :key="i">
            <pre class="sql">{{ q }}</pre>
          </template>
        </div>
        <div v-if="report.aiAnalysis.steps.length" class="ai-sec">
          <b>建议处置：</b>
          <ol class="steps">
            <li v-for="(s, i) in report.aiAnalysis.steps" :key="i">{{ s }}</li>
          </ol>
        </div>
      </div>

      <div class="ai-actions" v-if="!fbDone">
        <el-button size="small" type="primary" plain :loading="fbBusy" :icon="CircleCheck" @click="confirmAi"
          >采纳此结论</el-button
        >
        <span class="hint">采纳后按此结论沉淀为案例，并在排查历史中标记为已确认</span>
      </div>
    </div>
    <div v-if="report.llmError" class="llm-note warn">
      <el-icon class="llm-ico"><Warning /></el-icon> LLM 增强失败，已降级为纯规则结果（{{ report.llmError }}）
    </div>

    <!-- 二级：影响范围 + 候选原因（始终可见） -->
    <template v-for="s in level2Sections" :key="s.key">
      <template v-if="s.key === 'causes' && s.causes.length">
        <h3 class="sec-h2">
          <el-icon class="sec-ico"><Aim /></el-icon>{{ s.title }}
        </h3>
        <div v-for="(c, i) in visibleCauses" :key="i" :class="['cause', 'cause-' + c.confidence]">
          <div class="cause-head">
            <div class="title">{{ c.title }}</div>
            <el-tag :type="confTag(c.confidence)" size="small">{{ c.confidence }} · {{ c.score }}</el-tag>
          </div>
          <div class="type">归因途径：{{ c.type }}</div>
          <ul class="plain">
            <li v-for="(e, j) in c.evidence" :key="j">{{ e }}</li>
          </ul>
        </div>
        <button v-if="allCauses.length > CAUSE_LIMIT" class="more-toggle" @click="causesOpen = !causesOpen">
          <el-icon class="more-chev" :class="{ open: causesOpen }"><ArrowDown /></el-icon>
          <span>{{ causesOpen ? '收起低置信度候选' : `展开其余 ${allCauses.length - CAUSE_LIMIT} 条候选` }}</span>
        </button>
      </template>
      <template v-else-if="s.key === 'impact' && s.items.length">
        <h3 class="sec-h2">
          <el-icon class="sec-ico"><TrendCharts /></el-icon>{{ s.title }}
        </h3>
        <ul class="plain">
          <li v-for="(i, j) in s.items" :key="j">{{ i }}</li>
        </ul>
      </template>
    </template>

    <!-- 三级：SQL / 表结构 / 参考案例 / 处置步骤（默认折叠） -->
    <el-collapse v-if="level3Sections.length" v-model="collapsedOpen" class="level3">
      <el-collapse-item v-for="s in level3Sections" :key="s.key" :name="s.key">
        <template #title>
          <span class="sec-h3"
            ><el-icon class="sec-ico"><component :is="secIcon[s.key]" /></el-icon>{{ s.title }}</span
          >
        </template>
        <template v-if="s.key === 'sql'">
          <template v-for="(q, i) in s.sqls" :key="i">
            <div class="sql-head">
              <div class="sql-purpose">{{ q.purpose }}</div>
              <el-button size="small" text type="primary" @click="copySql(q.sql)">复制</el-button>
            </div>
            <pre class="sql">{{ q.sql }}</pre>
          </template>
        </template>
        <template v-else-if="s.key === 'structures'">
          <div v-for="t in s.tables" :key="t.name" class="cause">
            <div class="cause-head">
              <div class="title">
                <el-icon class="tbl-ico"><Coin /></el-icon>{{ t.name }}
              </div>
              <el-tag :type="t.inKb ? 'primary' : 'info'" size="small">{{ t.inKb ? '在库' : '知识库外' }}</el-tag>
            </div>
            <div class="type">{{ t.comment }}</div>
            <el-table
              v-if="t.columns.length"
              class="cols"
              :data="t.columns.map((c) => ({ col: c[0], type: c[1], nullable: c[2], comment: c[3] }))"
              size="small"
            >
              <el-table-column prop="col" label="列" :min-width="colW(9)" show-overflow-tooltip />
              <el-table-column prop="type" label="类型" :min-width="colW(7)" show-overflow-tooltip />
              <el-table-column prop="nullable" label="约束" :min-width="colW(6)" />
              <el-table-column prop="comment" label="说明" :min-width="colW(12)" show-overflow-tooltip />
            </el-table>
          </div>
        </template>
        <template v-else-if="s.key === 'refs'">
          <ul class="plain">
            <li v-for="(i, j) in s.items" :key="j">{{ i }}</li>
          </ul>
        </template>
        <template v-else-if="s.key === 'solution'">
          <ol class="steps">
            <li v-for="(i, j) in s.items" :key="j">{{ i }}</li>
          </ol>
          <div v-if="s.source" class="src">依据：{{ s.source }}</div>
        </template>
      </el-collapse-item>
    </el-collapse>

    <!-- 反馈沉淀闭环 -->
    <el-divider />
    <div class="fb-title">本次排查是否帮助你定位问题？（确认后自动沉淀案例，持续提升准确率）</div>
    <template v-if="!fbDone">
      <el-button size="small" :icon="CircleCheck" @click="causeInput = true">有帮助</el-button>
      <el-button size="small" :icon="CircleClose" @click="submitFb('no', '')">没帮助</el-button>
      <div v-if="causeInput" class="fb-input">
        <el-input v-model="cause" placeholder="请确认实际原因（沉淀为案例，必填）" />
        <el-button type="primary" @click="submitFb('yes', cause)">提交反馈</el-button>
      </div>
    </template>
    <div v-else class="src">
      <el-icon class="fb-ok"><CircleCheck /></el-icon>{{ fbDone }}
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  CircleCheck,
  CircleClose,
  MagicStick,
  Warning,
  Aim,
  TrendCharts,
  DocumentChecked,
  Coin,
  Collection,
  Tools,
  ArrowDown,
} from '@element-plus/icons-vue';
import { api, colW } from '../store';

const props = defineProps({ report: { type: Object, required: true } });

const confTag = (c) => (c === '高' ? 'danger' : c === '中' ? 'warning' : 'info');
const secIcon = { sql: DocumentChecked, structures: Coin, refs: Collection, solution: Tools };

const level2Sections = computed(() => props.report.sections.filter((s) => s.key === 'causes' || s.key === 'impact'));
const level3Sections = computed(() =>
  props.report.sections.filter((s) => ['sql', 'structures', 'refs', 'solution'].includes(s.key)),
);

/** 候选原因默认只出前 N 条，其余折叠——避免二级区把一级结论挤下去 */
const CAUSE_LIMIT = 3;
const causesOpen = ref(false);
const allCauses = computed(() => level2Sections.value.find((s) => s.key === 'causes')?.causes || []);
const visibleCauses = computed(() => (causesOpen.value ? allCauses.value : allCauses.value.slice(0, CAUSE_LIMIT)));

const aiOpen = ref(false);
const hasEvidence = computed(() => {
  const a = props.report.aiAnalysis;
  return !!a && (a.evidenceRefs.length > 0 || a.verifySql.length > 0 || a.steps.length > 0);
});

const collapsedOpen = ref([]);
const causeInput = ref(false);
const cause = ref('');
const fbDone = ref('');
const fbBusy = ref(false);

async function submitFb(helpful, confirmed) {
  if (helpful === 'yes' && !confirmed) {
    ElMessage.warning('请填写实际原因，以便沉淀案例');
    return;
  }
  fbBusy.value = true;
  try {
    const r = await api('/feedback', {
      method: 'POST',
      body: JSON.stringify({ query_id: props.report.query_id, helpful, confirmed_cause: confirmed, note: '' }),
    });
    ElMessage.info(r.message || '已提交');
    if (r.caseId) {
      fbDone.value = r.message;
      causeInput.value = false;
    }
  } finally {
    fbBusy.value = false;
  }
}

/** 采纳 AI 综合分析结论：按 AI 根因沉淀案例 */
async function confirmAi() {
  const top = props.report.aiAnalysis?.topCause;
  if (!top) {
    ElMessage.warning('AI 未给出可采纳的结论');
    return;
  }
  await submitFb('yes', top);
}

async function copySql(sql) {
  try {
    await navigator.clipboard.writeText(sql);
    ElMessage.success('SQL 已复制');
  } catch (e) {
    ElMessage.error('复制失败：' + e.message);
  }
}
</script>

<style scoped>
.cause-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--sp-2);
}

/* ---------- 结论（一级） ---------- */
.conclusion {
  border: 1px solid var(--line);
  border-left: 0.1875rem solid var(--ink-muted);
  border-radius: var(--r-lg);
  padding: var(--sp-3) var(--sp-4);
  background: var(--surface);
}
.conf-高 {
  border-left-color: #dc2626;
}
.conf-中 {
  border-left-color: #d97706;
}
.conf-低 {
  border-left-color: var(--ink-muted);
}
.conclusion-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.conclusion-title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-body);
  font-weight: 600;
  color: #111827;
}
.conclusion-ico {
  font-size: 1rem;
}
.conf-高 .conclusion-ico {
  color: #dc2626;
}
.conf-中 .conclusion-ico {
  color: #d97706;
}
.conf-低 .conclusion-ico {
  color: var(--ink-muted);
}
.conclusion-text {
  font-size: var(--fs-lead);
  line-height: 1.7;
  color: var(--ink);
  margin-top: var(--sp-2);
  font-weight: 500;
}

/* ---------- 二级 / 三级标题 ---------- */
.sec-ico {
  font-size: 0.9375rem;
}
.tbl-ico {
  font-size: 0.875rem;
  vertical-align: -0.125rem;
  margin-right: 0.25rem;
  color: #10b981;
}

/* ---------- 展开更多（候选原因 / AI 依据） ---------- */
.more-toggle,
.ai-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: var(--fs-body);
  color: var(--el-color-primary);
  padding: var(--sp-2) 0;
  transition: color 0.15s ease;
}
.more-toggle:hover,
.ai-toggle:hover {
  color: var(--el-color-primary-dark-2);
}
.more-chev,
.ai-chev {
  font-size: 0.75rem;
  transition: transform 0.15s ease;
}
.more-chev.open,
.ai-chev {
  transform: rotate(0deg);
}
.ai-toggle.open .ai-chev {
  transform: rotate(180deg);
}
.ai-toggle {
  margin-top: var(--sp-1);
}

/* ---------- 三级折叠区 ---------- */
.level3 {
  margin-top: var(--sp-1);
  border-top: none;
  border-bottom: none;
}
.level3 :deep(.el-collapse-item__header) {
  border-bottom: 1px solid var(--line);
  height: auto;
  padding: var(--sp-3) var(--sp-1);
}
.sec-h3 {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-strong);
  color: var(--brand-deep);
}
.level3 :deep(.el-collapse-item__content) {
  padding-bottom: var(--sp-3);
}

/* ---------- AI 卡片 / LLM 提示 ---------- */
.llm-note {
  margin-top: var(--sp-3);
  font-size: var(--fs-body);
  color: var(--ink-2);
  background: #f5f3ff;
  border-left: 0.25rem solid #8b5cf6;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.llm-note.warn {
  background: #fff7ed;
  border-left-color: #f59e0b;
  color: #92400e;
}
.llm-ico {
  font-size: 0.9375rem;
  flex: none;
}
.ai-card {
  margin-top: var(--sp-3);
  border: 1px solid #c7d2fe;
  border-left: 0.25rem solid #6366f1;
  background: linear-gradient(180deg, #eef2ff 0%, #f8fafc 100%);
  border-radius: var(--r-lg);
  padding: var(--sp-3) var(--sp-4);
}
.ai-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
  font-weight: 600;
  color: #3730a3;
  font-size: var(--fs-strong);
  margin-bottom: var(--sp-2);
}
.ai-title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.ai-ico {
  font-size: 1rem;
}
.ai-cause {
  font-size: var(--fs-body);
  line-height: 1.7;
  color: #1e1b4b;
}
.ai-detail {
  margin-top: var(--sp-2);
  padding-top: var(--sp-2);
  border-top: 1px dashed #c7d2fe;
}
.ai-sec {
  margin-top: var(--sp-2);
  font-size: var(--fs-body);
  color: #334155;
}
.ai-sec b {
  color: #4338ca;
}
.ai-sec .sql {
  margin: var(--sp-1) 0 var(--sp-2);
}
.ai-actions {
  margin-top: var(--sp-3);
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.ai-actions .hint {
  margin-top: 0;
}

.cause-高 {
  border-left-color: #dc2626;
}
.cause-中 {
  border-left-color: #d97706;
}
.cause-低 {
  border-left-color: var(--ink-muted);
}
.sql-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}
.cols {
  margin-top: var(--sp-2);
}

/* ---------- 反馈区 ---------- */
.fb-title {
  font-size: var(--fs-body);
  font-weight: 600;
  margin-bottom: var(--sp-2);
}
.fb-input {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.fb-ok {
  font-size: 0.875rem;
  color: #059669;
  vertical-align: -0.125rem;
  margin-right: 0.25rem;
}

@media (max-width: 45rem) {
  .conclusion,
  .ai-card {
    padding: var(--sp-3);
  }
  .fb-input {
    flex-wrap: wrap;
  }
  .fb-input .el-input {
    flex: 1 1 100%;
  }
}
</style>
