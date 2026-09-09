<template>
  <div>
    <div class="panel">
      <h3>
        <el-icon class="h3-ico"><DocumentAdd /></el-icon>录入已有案例
      </h3>
      <div class="panel-sub">录入 / 浏览 · 把已解决的问题沉淀进知识库，后续排查自动关联</div>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="案例标题" prop="title">
          <el-input v-model="form.title" placeholder="如：job_dws_asset_agg 死锁失败 ORA-00060" />
        </el-form-item>
        <el-form-item label="问题现象" prop="symptom">
          <el-input
            v-model="form.symptom"
            type="textarea"
            :rows="2"
            placeholder="何时、什么作业/表、什么表现（报错信息、数据表现、影响范围）"
          />
        </el-form-item>
        <el-form-item label="根因分析" prop="root_cause">
          <el-input v-model="form.root_cause" type="textarea" :rows="2" placeholder="定位到的根本原因" />
        </el-form-item>
        <el-form-item label="解决方式 / 处置步骤" prop="solution">
          <el-input
            v-model="form.solution"
            type="textarea"
            :rows="2"
            placeholder="分步骤描述处理过程，如：1. …；2. …；3. …"
          />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :xs="24" :sm="24" :md="6">
            <el-form-item label="错误码">
              <el-select
                v-model="form.error_code"
                filterable
                allow-create
                clearable
                placeholder="可留空自动识别"
                style="width: 100%"
              >
                <el-option
                  v-for="c in dict.errorCodes"
                  :key="c.code"
                  :label="`${c.code}：${c.meaning}`"
                  :value="c.code"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="9">
            <el-form-item label="关联作业">
              <el-select
                v-model="form.related_jobs"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="可留空自动识别"
                style="width: 100%"
              >
                <el-option v-for="j in dict.jobs" :key="j.name" :label="`${j.name}（${j.desc}）`" :value="j.name" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="9">
            <el-form-item label="关联表">
              <el-select
                v-model="form.related_tables"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="可留空自动识别"
                style="width: 100%"
              >
                <el-option v-for="t in dict.tables" :key="t.name" :label="`${t.name}：${t.comment}`" :value="t.name" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <div class="form-actions">
          <el-button type="primary" :loading="busy" @click="submit">提交案例</el-button>
          <el-button @click="reset">清空</el-button>
        </div>
      </el-form>
      <el-alert v-if="autoNote" :title="autoNote" type="success" :closable="false" class="auto-note" />
      <div class="hint">
        提示：标题、现象、根因、解决方式为必填；关联作业/表/错误码留空时，系统会从您填写的文本中自动识别。录入后立即参与智能排查的案例检索与匹配。
      </div>
    </div>

    <div class="panel">
      <h3>
        <el-icon class="h3-ico"><Collection /></el-icon>案例列表（{{ cases.length }} 条，含人工录入与反馈沉淀）
      </h3>
      <div v-if="!cases.length" class="empty">暂无案例，快录入第一条吧</div>
      <el-card v-for="c in cases" :key="c.case_id" shadow="never" class="case-card">
        <template #header>
          <div class="case-head">
            <b class="case-title">{{ caseTitle(c) }}</b>
            <span class="case-meta"
              >{{ c.case_id }} · {{ c.source }}{{ c.created_by ? ' · ' + c.created_by : '' }} ·
              {{ fmtTime(c.created_at) }}</span
            >
          </div>
        </template>
        <div class="case-body">
          <div v-if="showSymptomRow(c)" class="case-row">
            <span class="case-k">现象</span>
            <p>{{ c.symptom }}</p>
          </div>
          <div class="case-row">
            <span class="case-k">根因</span>
            <p>{{ c.root_cause }}</p>
          </div>
          <div class="case-row">
            <span class="case-k">解决</span>
            <p>{{ c.solution }}</p>
          </div>
        </div>
        <div class="case-tags">
          <el-tag v-if="c.error_code" size="small">{{ c.error_code }}</el-tag>
          <el-tag v-for="j in c.related_jobs" :key="j" size="small" type="primary" effect="plain"
            ><el-icon class="tag-ico"><SetUp /></el-icon>{{ j }}</el-tag
          >
          <el-tag v-for="t in c.related_tables" :key="t" size="small" type="success" effect="plain"
            ><el-icon class="tag-ico"><Coin /></el-icon>{{ t }}</el-tag
          >
        </div>
      </el-card>
      <div v-if="cases.length < total" class="load-more">
        <el-button plain @click="loadMore">加载更多（已显示 {{ cases.length }} / {{ total }}）</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { DocumentAdd, Collection, SetUp, Coin } from '@element-plus/icons-vue';
import { api } from '../store';
import { fmtTime } from '../utils/format';
import { useTabReload } from '../composables/useTabReload';

const emptyForm = () => ({
  title: '',
  symptom: '',
  root_cause: '',
  solution: '',
  error_code: '',
  related_jobs: [],
  related_tables: [],
});
const form = reactive(emptyForm());
const rules = {
  title: [{ required: true, message: '请填写案例标题', trigger: 'blur' }],
  symptom: [{ required: true, message: '请填写问题现象', trigger: 'blur' }],
  root_cause: [{ required: true, message: '请填写根因分析', trigger: 'blur' }],
  solution: [{ required: true, message: '请填写解决方式', trigger: 'blur' }],
};
const formRef = ref(null);
const dict = reactive({ errorCodes: [], jobs: [], tables: [] });
const cases = ref([]);
const total = ref(0);
const busy = ref(false);
const autoNote = ref('');
let noteTimer = null;

/** 优先用标题；无标题的旧数据用现象摘要，但此时不在卡片正文重复展示现象行，避免一句两遍 */
const caseTitle = (c) => c.title || (c.symptom.length > 60 ? c.symptom.slice(0, 60) + '…' : c.symptom);
const showSymptomRow = (c) => !!c.title;

async function load() {
  const [d, res] = await Promise.all([api('/dict'), api('/cases?limit=100&offset=0')]);
  dict.errorCodes = d.errorCodes;
  dict.jobs = d.jobs;
  dict.tables = d.tables;
  cases.value = res.items || res || [];
  total.value = res.total ?? cases.value.length;
}

async function loadMore() {
  const res = await api(`/cases?limit=100&offset=${cases.value.length}`);
  cases.value = cases.value.concat(res.items || []);
}

async function submit() {
  await formRef.value.validate().catch(() => undefined);
  if (!form.title || !form.symptom || !form.root_cause || !form.solution) return;
  busy.value = true;
  autoNote.value = '';
  try {
    const r = await api('/cases', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        related_jobs: form.related_jobs.join(','),
        related_tables: form.related_tables.join(','),
      }),
    });
    if (r.error) {
      ElMessage.error(r.error);
      return;
    }
    const a = r.auto_detected || {};
    const detected = [
      ...a.jobs.map((j) => '作业 ' + j),
      ...a.tables.map((t) => '表 ' + t),
      ...(a.error_code ? ['错误码 ' + a.error_code] : []),
    ];
    autoNote.value =
      `已录入案例 ${r.caseId}，立即参与智能排查匹配` +
      (detected.length ? `；系统自动识别：${detected.join('、')}` : '（文本中未识别到额外关联对象）');
    Object.assign(form, emptyForm());
    load();
    ElMessage.success('案例 ' + r.caseId + ' 已录入知识库');
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => (autoNote.value = ''), 8000);
  } catch (e) {
    ElMessage.error('提交失败：' + e.message);
  }
  busy.value = false;
}

async function reset() {
  const dirty = Object.values(form).some((v) => (Array.isArray(v) ? v.length : String(v || '').trim()));
  if (dirty) {
    try {
      await ElMessageBox.confirm('清空当前表单内容？', '确认清空', { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消' });
    } catch {
      return;
    }
  }
  Object.assign(form, emptyForm());
  formRef.value?.clearValidate();
  autoNote.value = '';
  clearTimeout(noteTimer);
}

useTabReload('cases', load);
</script>

<style scoped>
.tag-ico {
  font-size: 0.75rem;
  vertical-align: -0.125rem;
  margin-right: 0.1875rem;
}

.form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.auto-note {
  margin-top: var(--sp-3);
}
.empty {
  color: var(--ink-faint);
  font-size: var(--fs-body);
  text-align: center;
  padding: var(--sp-6) 0;
}
.load-more {
  margin-top: var(--sp-3);
  text-align: center;
}

/* ---- 案例卡 ---- */
.case-card {
  margin-top: var(--gap-panel);
  border-radius: var(--r-lg);
  transition:
    box-shadow 0.15s ease,
    transform 0.15s ease;
}
.case-card:hover {
  box-shadow: 0 0.375rem 1.125rem -0.625rem rgba(15, 23, 42, 0.18);
  transform: translateY(-0.0625rem);
}

.case-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.case-title {
  font-size: var(--fs-body);
  line-height: 1.5;
  min-width: 0;
}
.case-meta {
  font-size: var(--fs-cap);
  color: var(--ink-faint);
}

.case-body {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.case-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--sp-3);
  align-items: start;
  font-size: var(--fs-body);
  line-height: 1.75;
}
.case-k {
  color: var(--ink-faint);
  font-size: var(--fs-cap);
  padding-top: 0.125rem;
  white-space: nowrap;
}
.case-row p {
  color: var(--ink-2);
  min-width: 0;
  overflow-wrap: anywhere;
}

.case-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}

@media (max-width: 45rem) {
  .case-row {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .case-k {
    padding-top: 0;
  }
}
</style>
