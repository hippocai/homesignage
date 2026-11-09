<template>
  <main class="companion-admin">
    <header>
      <div>
        <h2>猪猪伙伴</h2>
        <p>管理全家共享的猪猪气泡、免打扰、家庭记忆和聊天。每个组件的外观、字号和声音仍可在画面编辑器设置。</p>
      </div>
      <img :src="'/client/assets/peach-pig.svg#wave'" alt="桃桃猪" />
    </header>
    <el-alert v-if="error" :title="error" type="error" @close="error = ''" />
    <HouseholdAgent />
    <el-card><h3>气泡生成设置</h3>
      <p>所有猪猪组件共享同一条气泡，只生成一次。以下时段使用家庭时区 {{ generation.zone }}。</p>
      <el-form label-width="150px">
        <el-form-item label="启用免打扰"><el-switch v-model="generation.quietEnabled" aria-label="启用免打扰" /></el-form-item>
        <el-form-item label="免打扰时段"><input type="time" v-model="generation.quietFrom" aria-label="免打扰开始" /> 至 <input type="time" v-model="generation.quietTo" aria-label="免打扰结束" /></el-form-item>
      </el-form>
      <p>免打扰可跨午夜，期间不朗读或主动提醒；开始与结束相同表示不设置静默时段。是否生成陪伴话语由下方时段控制。</p>
      <div class="generation-slots"><label v-for="(label,index) in slotLabels" :key="index" class="generation-slot">
        <span>{{label}}</span><el-input-number v-model="generation.greetingSchedule[index]" :min="0" :max="120" :step="1" :precision="0" :aria-label="label+'生成间隔（分钟）'" /><span>分钟</span>
      </label></div>
      <p>每天12个两小时时段，0为暂停更新，1–120为两轮自动生成的最小间隔（分钟）。天气、新闻、资料变化和话语到期均不会提前生成。普通问候保留到新话语生成后替换；提醒到期、修改或取消后撤下。暂停生成或更新失败时也保留已有普通问候。切换时段不重置上次生成时间。</p>
      <el-button type="primary" :loading="saving" @click="saveGeneration">保存生成设置</el-button>
    </el-card>
    <PigPromptSettings />
  </main>
</template>
<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api/index.js';
import HouseholdAgent from '../components/HouseholdAgent.vue';
import PigPromptSettings from '../components/PigPromptSettings.vue';
const error = ref(''),
  generation = ref({greetingSchedule:Array(12).fill(5),quietEnabled:true,quietFrom:'22:00',quietTo:'07:00',zone:'Asia/Shanghai'}),
  saving = ref(false);
const slotLabels=Array.from({length:12},(_,i)=>String(i*2).padStart(2,'0')+':00–'+String(i*2+2).padStart(2,'0')+':00');
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
    const {greetingSchedule,quietEnabled,quietFrom,quietTo}=generation.value;
    generation.value=await call('put', '/companion/settings', {greetingSchedule,quietEnabled,quietFrom,quietTo});
    ElMessage.success('气泡生成设置已保存');
  } catch {} finally {
    saving.value = false;
  }
}
onMounted(async () => {
  generation.value = await call('get','/companion/settings');
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
.generation-slots{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:12px}.generation-slot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.generation-slot>span:first-child{min-width:100px}
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
