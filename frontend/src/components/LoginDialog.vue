<template>
  <el-dialog v-model="visible" :title="auth.mode === 'login' ? '登录' : '注册'" width="380px"
    :show-close="false" :close-on-click-modal="false" :close-on-press-escape="false">
    <div class="login-sub">登录后您的排查、案例录入与反馈将记录归属，沉淀为团队资产</div>
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
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { auth, doLogin } from '../store';

const visible = computed({ get: () => auth.loginVisible, set: v => (auth.loginVisible = v) });
const form = reactive({ username: '', password: '', display_name: '' });
const err = ref('');
const busy = ref(false);

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
.login-sub { font-size: 12.5px; color: #6b7280; margin-bottom: 12px; line-height: 1.6; }
.login-err { color: #b91c1c; font-size: 12.5px; min-height: 18px; margin-bottom: 6px; }
.login-switch { font-size: 12.5px; color: #6b7280; text-align: center; margin-top: 10px; }
</style>
