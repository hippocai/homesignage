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
    <el-card><h3>气泡生成设置</h3>
      <el-form label-width="180px"><el-form-item label="问候生成间隔（分钟）">
        <el-input-number v-model="greetingMinutes" :min="1" :max="1440" :step="1" :precision="0" aria-label="问候生成间隔（分钟）" />
      </el-form-item></el-form>
      <p>默认5分钟，最少1分钟。屏幕在线时按间隔重新生成；记忆、天气、新闻或系统事项变化及旧话语到期时提前重新判断。每次模型请求与返回均记录在聊天审计中。</p>
      <el-button type="primary" :loading="saving" @click="saveGeneration">保存生成设置</el-button>
    </el-card>
  </main>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api/index.js';
import HouseholdAgent from '../components/HouseholdAgent.vue';
const error = ref(''),
  greetingMinutes = ref(5),
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
async function saveGeneration() {
  saving.value = true;
  try {
    await call('put', '/companion/settings', { greetingMinutes:greetingMinutes.value });
    ElMessage.success('气泡生成设置已保存');
  } catch {} finally {
    saving.value = false;
  }
}
onMounted(async () => {
  greetingMinutes.value = (await call('get','/companion/settings')).greetingMinutes;
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
