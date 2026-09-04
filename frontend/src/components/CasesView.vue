<template>
  <div>
    <div class="panel">
      <h3>📥 录入已有案例（把已解决的问题沉淀进知识库，后续排查自动关联）</h3>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="案例标题" prop="title">
          <el-input v-model="form.title" placeholder="如：job_dws_asset_agg 死锁失败 ORA-00060" />
        </el-form-item>
        <el-form-item label="问题现象" prop="symptom">
          <el-input v-model="form.symptom" type="textarea" :rows="2" placeholder="何时、什么作业/表、什么表现（报错信息、数据表现、影响范围）" />
        </el-form-item>
        <el-form-item label="根因分析" prop="root_cause">
          <el-input v-model="form.root_cause" type="textarea" :rows="2" placeholder="定位到的根本原因" />
        </el-form-item>
        <el-form-item label="解决方式 / 处置步骤" prop="solution">
          <el-input v-model="form.solution" type="textarea" :rows="2" placeholder="分步骤描述处理过程，如：1. …；2. …；3. …" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="6">
            <el-form-item label="错误码">
              <el-select v-model="form.error_code" filterable allow-create clearable placeholder="可留空自动识别" style="width:100%">
                <el-option v-for="c in dict.errorCodes" :key="c.code" :label="`${c.code}：${c.meaning}`" :value="c.code" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="9">
            <el-form-item label="关联作业">
              <el-select v-model="form.related_jobs" multiple filterable allow-create default-first-option placeholder="可留空自动识别" style="width:100%">
                <el-option v-for="j in dict.jobs" :key="j.name" :label="`${j.name}（${j.desc}）`" :value="j.name" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="9">
            <el-form-item label="关联表">
              <el-select v-model="form.related_tables" multiple filterable allow-create default-first-option placeholder="可留空自动识别" style="width:100%">
                <el-option v-for="t in dict.tables" :key="t.name" :label="`${t.name}：${t.comment}`" :value="t.name" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-button type="primary" :loading="busy" @click="submit">提交案例</el-button>
        <el-button @click="reset">清空</el-button>
      </el-form>
      <el-alert v-if="autoNote" :title="autoNote" type="success" :closable="false" style="margin-top:10px" />
      <div class="hint">提示：标题、现象、根因、解决方式为必填；关联作业/表/错误码留空时，系统会从您填写的文本中自动识别。录入后立即参与智能排查的案例检索与匹配。</div>
    </div>

    <div class="panel">
      <h3>📚 案例列表（{{ cases.length }} 条，含人工录入与反馈沉淀）</h3>
      <div v-if="!cases.length" style="color:#9ca3af;font-size:13px;text-align:center;padding:24px 0">暂无案例，快录入第一条吧</div>
      <el-card v-for="c in cases" :key="c.case_id" shadow="never" style="margin-top:10px">
        <template #header>
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline">
            <b>{{ c.symptom.slice(0, 60) }}{{ c.symptom.length > 60 ? '…' : '' }}</b>
            <span style="font-size:11px;color:#9ca3af">{{ c.case_id }} · {{ c.source }}{{ c.created_by ? ' · ' + c.created_by : '' }} · {{ fmtTime(c.created_at) }}</span>
          </div>
        </template>
        <div style="font-size:13px;line-height:1.75"><b>现象：</b>{{ c.symptom }}<br><b>根因：</b>{{ c.root_cause }}<br><b>解决：</b>{{ c.solution }}</div>
        <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:5px">
          <el-tag v-if="c.error_code" size="small">{{ c.error_code }}</el-tag>
          <el-tag v-for="j in c.related_jobs" :key="j" size="small" type="primary" effect="plain">⚙ {{ j }}</el-tag>
          <el-tag v-for="t in c.related_tables" :key="t" size="small" type="success" effect="plain">▤ {{ t }}</el-tag>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api, ui } from '../store';

const emptyForm = () => ({ title: '', symptom: '', root_cause: '', solution: '', error_code: '', related_jobs: [], related_tables: [] });
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
const busy = ref(false);
const autoNote = ref('');

const fmtTime = s => String(s || '').slice(0, 16).replace('T', ' ');

async function load() {
  const [d, list] = await Promise.all([api('/api/dict'), api('/api/cases')]);
  dict.errorCodes = d.errorCodes;
  dict.jobs = d.jobs;
  dict.tables = d.tables;
  cases.value = list;
}

async function submit() {
  await formRef.value.validate().catch(() => undefined);
  if (!form.title || !form.symptom || !form.root_cause || !form.solution) return;
  busy.value = true;
  autoNote.value = '';
  try {
    const r = await api('/api/cases', {
      method: 'POST',
      body: JSON.stringify({ ...form, related_jobs: form.related_jobs.join(','), related_tables: form.related_tables.join(',') }),
    });
    if (r.error) { ElMessage.error(r.error); return; }
    const a = r.auto_detected || {};
    const detected = [...a.jobs.map(j => '作业 ' + j), ...a.tables.map(t => '表 ' + t), ...(a.error_code ? ['错误码 ' + a.error_code] : [])];
    autoNote.value = `✅ 已录入案例 ${r.caseId}，立即参与智能排查匹配` + (detected.length ? `；系统自动识别：${detected.join('、')}` : '（文本中未识别到额外关联对象）');
    Object.assign(form, emptyForm());
    load();
    ElMessage.success('案例 ' + r.caseId + ' 已录入知识库');
    setTimeout(() => (autoNote.value = ''), 8000);
  } catch (e) {
    ElMessage.error('提交失败：' + e.message);
  }
  busy.value = false;
}

function reset() {
  Object.assign(form, emptyForm());
  formRef.value?.clearValidate();
  autoNote.value = '';
}

watch(() => ui.activeTab, v => { if (v === 'cases') load(); }, { immediate: true });
</script>
