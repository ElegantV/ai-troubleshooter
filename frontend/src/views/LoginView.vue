<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <div class="login-brand-icon"><el-icon :size="24"><Search /></el-icon></div>
        <h1>AI 问题排查助手 <span class="login-ver">v0.4</span></h1>
        <p class="login-sub">面向数据异常与批量作业失败 · 血缘 / 链路 / 案例关联分析 · 规则归因（可解释可审计）</p>
      </div>

      <el-alert v-if="auth.msg" :title="auth.msg" type="warning" :closable="false" class="login-alert" />

      <div class="login-title">{{ auth.mode === 'login' ? '登录' : '注册' }}</div>
      <p class="login-hint">
        {{ auth.mode === 'login'
          ? '登录后您的排查、案例录入与反馈将记录归属'
          : '注册后自动登录，排查/反馈/案例将归属到您，沉淀为团队资产' }}
      </p>

      <el-form label-position="top" @submit.prevent>
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="小写字母/数字/下划线" @keyup.enter="submit" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 6 位" @keyup.enter="submit" />
        </el-form-item>
        <el-form-item v-if="auth.mode === 'register'" label="姓名（可选，用于案例展示）">
          <el-input v-model="form.display_name" @keyup.enter="submit" />
        </el-form-item>
        <el-form-item v-if="auth.mode === 'register'" label="所属系统（用于按系统收敛检索）">
          <el-select v-model="form.system_code" clearable filterable placeholder="共享/公共（不限定系统）" style="width:100%">
            <el-option v-for="s in systems" :key="s.code" :label="`${s.name}（${s.code}）`" :value="s.code" />
          </el-select>
        </el-form-item>
        <div class="login-err">{{ err }}</div>
        <el-button type="primary" class="login-btn" :loading="busy" @click="submit">
          {{ auth.mode === 'login' ? '登录' : '注册并登录' }}
        </el-button>
        <div class="login-switch">
          <template v-if="auth.mode === 'login'">没有账号？<el-link type="primary" @click="switchMode">注册一个</el-link></template>
          <template v-else>已有账号？<el-link type="primary" @click="switchMode">去登录</el-link></template>
        </div>
      </el-form>

      <div class="login-foot">验证 SQL 仅供人工只读执行 · 所有查询已审计留痕并归属操作人</div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Search } from '@element-plus/icons-vue';
import { api, auth, doLogin } from '../store';

const form = reactive({ username: '', password: '', display_name: '', system_code: '' });
const err = ref('');
const busy = ref(false);
const systems = ref([]);

async function loadSystems() {
  try { systems.value = await api('/systems'); } catch (e) { /* 公开接口，忽略 */ }
}
onMounted(loadSystems);

function switchMode() {
  auth.mode = auth.mode === 'login' ? 'register' : 'login';
  err.value = '';
}

async function submit() {
  err.value = '';
  if (!form.username || !form.password) { err.value = '请输入用户名和密码'; return; }
  busy.value = true;
  try {
    await doLogin(form);
    ElMessage.success(auth.mode === 'register' ? '注册成功，已自动登录' : '登录成功');
  } catch (e) {
    err.value = e.message;
  }
  busy.value = false;
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  padding: var(--sp-6) var(--sp-4);
  background:
    radial-gradient(60rem 30rem at 110% -10%, rgba(37, 99, 235, 0.16), transparent 60%),
    linear-gradient(180deg, #f8fafc 0%, #edf1f7 100%);
}
.login-card {
  width: min(25rem, 94vw);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-2xl);
  box-shadow: 0 0.625rem 1.875rem -0.75rem rgba(15, 23, 42, 0.18);
  padding: clamp(1.5rem, 1rem + 2vw, 2.25rem);
}
.login-brand { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--sp-2); }
.login-brand-icon {
  width: 2.875rem; height: 2.875rem; border-radius: var(--r-lg);
  background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
  color: #fff; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0.375rem 1rem -0.375rem rgba(37, 99, 235, 0.5);
}
.login-brand h1 { font-size: var(--fs-h1); font-weight: 600; line-height: 1.3; }
.login-ver {
  font-size: var(--fs-cap); background: var(--el-color-primary-light-9); color: var(--el-color-primary);
  padding: 0.125rem 0.5rem; border-radius: var(--r-pill); font-weight: 500; vertical-align: 0.125rem;
}
.login-sub { font-size: var(--fs-cap); color: var(--ink-muted); line-height: 1.7; }

.login-alert { margin: var(--sp-4) 0 0; }
.login-title {
  font-size: var(--fs-title); font-weight: 600; color: var(--brand-deep);
  margin-top: var(--sp-5);
}
.login-hint { font-size: var(--fs-cap); color: var(--ink-muted); margin: var(--sp-1) 0 var(--sp-3); line-height: 1.6; }

.login-err { color: #b91c1c; font-size: var(--fs-cap); min-height: 1.125rem; margin-bottom: var(--sp-2); }
.login-btn { width: 100%; }
.login-switch { font-size: var(--fs-cap); color: var(--ink-muted); text-align: center; margin-top: var(--sp-3); }
.login-foot {
  margin-top: var(--sp-5); padding-top: var(--sp-3);
  border-top: 1px solid var(--line-soft);
  font-size: var(--fs-cap); color: var(--ink-faint); text-align: center; line-height: 1.7;
}
</style>
