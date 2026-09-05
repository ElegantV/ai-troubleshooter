<template>
  <el-dialog v-model="visible" :title="auth.mode === 'login' ? '登录' : '注册'" class="login-dlg"
    width="min(23.75rem, 92vw)"
    :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false">
    <div class="login-sub">
      <el-icon class="login-ico"><User /></el-icon>
      {{ auth.mode === 'login' ? '欢迎回来，登录后您的排查、案例录入与反馈将记录归属' : '注册后自动登录，排查/反馈/案例将归属到您，沉淀为团队资产' }}
    </div>
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
      <el-button type="primary" style="width:100%" :loading="busy" @click="submit">
        {{ auth.mode === 'login' ? '登录' : '注册' }}
      </el-button>
      <div class="login-switch">
        <template v-if="auth.mode === 'login'">没有账号？<el-link type="primary" @click="switchMode">注册一个</el-link></template>
        <template v-else>已有账号？<el-link type="primary" @click="switchMode">去登录</el-link></template>
      </div>
    </el-form>
  </el-dialog>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { User } from '@element-plus/icons-vue';
import { api, auth, doLogin } from '../store';

const visible = computed({ get: () => auth.loginVisible, set: v => (auth.loginVisible = v) });
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
.login-sub {
  font-size: var(--fs-cap); color: var(--ink-muted);
  margin-bottom: var(--sp-4); line-height: 1.6;
  background: var(--surface-sunken); border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-3);
  display: flex; align-items: flex-start; gap: var(--sp-2);
}
.login-ico { font-size: 0.875rem; flex: none; margin-top: 0.125rem; color: var(--el-color-primary); }
.login-err { color: #b91c1c; font-size: var(--fs-cap); min-height: 1.125rem; margin-bottom: var(--sp-2); }
.login-switch { font-size: var(--fs-cap); color: var(--ink-muted); text-align: center; margin-top: var(--sp-3); }
.login-switch :deep(.el-link) { font-weight: 500; }
</style>
