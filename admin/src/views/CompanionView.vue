<template>
  <main class="companion-admin">
    <header>
      <div>
        <h2>猪猪伙伴</h2>
        <p>维护家庭记忆、聊天和系统操作记录。提醒类型、声音及免打扰请在画面编辑器的猪猪组件中设置。</p>
      </div>
      <img :src="'/client/assets/peach-pig.svg#wave'" alt="桃桃猪" />
    </header>
    <el-alert v-if="error" :title="error" type="error" @close="error = ''" />
    <HouseholdAgent />
    <el-card
      ><h3>家庭事项</h3>
      <el-switch
        v-if="familyAI !== null"
        v-model="familyAI"
        active-text="允许使用模型润色家庭提醒"
        :disabled="saving"
        @change="saveFamily"
    /></el-card>
  </main>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api/index.js';
import HouseholdAgent from '../components/HouseholdAgent.vue';
const error = ref(''),
  familyAI = ref(null),
  saving = ref(false);
async function call(method, url, body) {
  try {
    error.value = '';
    return (await api.request({ method, url, data: body })).data.data;
  } catch (e) {
    error.value = e.response?.data?.error || e.message;
    ElMessage.error(error.value);
    throw e;
  }
}
async function saveFamily(value) {
  saving.value = true;
  try {
    await call('put', '/companion/settings', { familyAI: value });
  } catch {
    familyAI.value = !value;
  } finally {
    saving.value = false;
  }
}
onMounted(async () => {
  familyAI.value = (await call('get','/companion/settings')).familyAI;
});
</script>
<style scoped>
.companion-admin {
  max-width: 980px;
}
.companion-admin header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 26px;
  background: #fff3dd;
  border-radius: 16px;
  color: #334d43;
}
.companion-admin header img {
  height: 90px;
}
.companion-admin .el-card {
  margin-top: 16px;
}
.companion-admin h3 {
  margin-bottom: 14px;
}
.el-form {
  max-width: 640px;
  margin: 16px 0;
}
input[type='time'] {
  border: 1px solid #d3d9d6;
  border-radius: 5px;
  padding: 5px;
}
.rule-preview {
  display: flex;
  align-items: center;
  background: #fff4dd;
  padding: 12px;
  margin: 16px 0;
  border-radius: 12px;
}
.rule-preview img {
  width: 110px;
}
.rule-preview small {
  color: #54675c;
}
</style>
