<template>
  <el-dialog
    v-model="visible"
    title="个人资料"
    class="profile-dlg"
    body-class="profile-dlg-body"
    width="min(24rem, 92vw)"
    top="7vh"
    destroy-on-close
  >
    <div class="dlg-sec">基本资料</div>
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="登录名">
        <el-input v-model="form.username" placeholder="小写字母/数字/下划线" />
        <div class="field-hint">修改后下次登录使用新登录名；历史排查记录保留当时的登录名（审计留痕）</div>
      </el-form-item>
      <el-form-item label="姓名（用于案例与排查历史展示）">
        <el-input v-model="form.display_name" maxlength="32" />
      </el-form-item>
      <el-form-item label="所属系统（用于按系统收敛检索）">
        <el-select
          v-model="form.system_code"
          clearable
          filterable
          placeholder="共享/公共（不限定系统）"
          style="width: 100%"
        >
          <el-option v-for="s in systems" :key="s.code" :label="`${s.name}（${s.code}）`" :value="s.code" />
        </el-select>
      </el-form-item>
      <el-button type="primary" :loading="saving" @click="saveProfile">保存资料</el-button>
    </el-form>

    <el-divider />
    <div class="dlg-sec">修改密码</div>
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="当前密码">
        <el-input v-model="pwd.old_password" type="password" show-password @keyup.enter="savePassword" />
      </el-form-item>
      <el-form-item label="新密码（至少 6 位）">
        <el-input v-model="pwd.new_password" type="password" show-password @keyup.enter="savePassword" />
      </el-form-item>
      <el-form-item label="确认新密码">
        <el-input v-model="pwd.confirm" type="password" show-password @keyup.enter="savePassword" />
      </el-form-item>
      <el-button :loading="savingPwd" @click="savePassword">修改密码</el-button>
    </el-form>
  </el-dialog>
</template>

<script setup>
import { reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api, auth, updateProfile, changePassword } from '../store';

const visible = defineModel({ type: Boolean, default: false });

const form = reactive({ username: '', display_name: '', system_code: '' });
const pwd = reactive({ old_password: '', new_password: '', confirm: '' });
const saving = ref(false);
const savingPwd = ref(false);
const systems = ref([]);

watch(visible, (v) => {
  if (!v || !auth.user) return;
  form.username = auth.user.username;
  form.display_name = auth.user.display_name || '';
  form.system_code = auth.user.system_code || '';
  pwd.old_password = pwd.new_password = pwd.confirm = '';
  api('/systems')
    .then((s) => (systems.value = s))
    .catch(() => {});
});

async function saveProfile() {
  if (!form.username.trim()) {
    ElMessage.warning('登录名不能为空');
    return;
  }
  saving.value = true;
  try {
    await updateProfile({ ...form });
    ElMessage.success('资料已保存');
    visible.value = false;
  } catch (e) {
    ElMessage.error(e.message);
  }
  saving.value = false;
}

async function savePassword() {
  if (!pwd.old_password || !pwd.new_password) {
    ElMessage.warning('请输入当前密码和新密码');
    return;
  }
  if (pwd.new_password !== pwd.confirm) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }
  savingPwd.value = true;
  try {
    await changePassword({ old_password: pwd.old_password, new_password: pwd.new_password });
    ElMessage.success('密码已更新');
    pwd.old_password = pwd.new_password = pwd.confirm = '';
  } catch (e) {
    ElMessage.error(e.message);
  }
  savingPwd.value = false;
}
</script>

<style scoped>
.field-hint {
  font-size: var(--fs-cap);
  color: var(--ink-faint);
  line-height: 1.6;
  margin-top: var(--sp-1);
}
.dlg-sec {
  font-size: var(--fs-title);
  font-weight: 600;
  color: var(--brand-deep);
  margin-bottom: var(--sp-3);
}
</style>

<style>
/* 资料弹窗：限高 + 内容区内部滚动（弹窗可能被 teleport，样式不走 scoped） */
.profile-dlg.el-dialog {
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin-bottom: 0;
  padding: 0;
}
.profile-dlg .el-dialog__header {
  flex: none;
  padding: var(--el-dialog-padding-primary) var(--pad-panel) var(--sp-3);
  border-bottom: 1px solid var(--line-soft);
}
.profile-dlg .el-dialog__headerbtn {
  top: var(--el-dialog-padding-primary);
  right: var(--pad-panel);
}
.profile-dlg-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-4) var(--pad-panel) var(--pad-panel);
}
.profile-dlg .el-divider {
  margin: var(--sp-5) 0 var(--sp-4);
}
.profile-dlg .el-button {
  width: 100%;
}
</style>
