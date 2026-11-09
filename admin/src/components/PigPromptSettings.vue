<template>
  <el-card class="prompt-settings">
    <h3>气泡 System prompt</h3>
    <p>决定猪猪如何结合家庭资料、独立记忆、天气和资讯说话。保存后直接生效，无需重启；下次生成使用新内容，不再等待原来的生成间隔。</p>
    <p>当前版本：{{ isDefault?'系统默认':'自定义' }}<span v-if="dirty"> · 有未保存修改</span>。请保留 JSON 输出格式要求，模型请求和返回会继续写入聊天审计。</p>
    <p>字数上限在提示词中单独一行配置：<code>speechMaxChars: 40</code>。默认含标点、空格等不超过40个字符，可改为1–180；超限时让模型重新写短句，不直接截断。</p>
    <el-alert v-if="error" :title="error" type="error" :closable="false" />
    <el-input v-model="draft" type="textarea" :rows="16" maxlength="20000" show-word-limit
      aria-label="气泡 System prompt" :disabled="!ready || busy" />
    <div class="actions">
      <el-button type="primary" :disabled="!ready || !draft.trim() || !dirty" :loading="busy" @click="save(false)">保存 System prompt</el-button>
      <el-button :disabled="!ready || busy" @click="save(true)">恢复默认版本</el-button>
      <el-button :disabled="busy" @click="load">重新载入已保存版本</el-button>
    </div>
  </el-card>
</template>
<script setup>
import {ref,computed,onMounted} from 'vue';
import {ElMessage} from 'element-plus';
import api from '../api/index.js';
const draft=ref(''),saved=ref(''),revision=ref(0),isDefault=ref(true),ready=ref(false),busy=ref(false),error=ref('');
const dirty=computed(()=>draft.value!==saved.value);
const url='/companion/agent/narration-prompt';
function accept(data){draft.value=data.prompt;saved.value=data.prompt;revision.value=data.revision;isDefault.value=data.isDefault;ready.value=true;}
async function load(){busy.value=true;error.value='';try{accept((await api.get(url)).data.data);}catch(e){error.value=e.response?.data?.error||e.message;}finally{busy.value=false;}}
async function save(reset){busy.value=true;error.value='';try{
  accept((await api.put(url,{revision:revision.value,...(reset?{reset:true}:{prompt:draft.value})})).data.data);
  ElMessage.success(reset?'已恢复默认 System prompt，立即生效':'System prompt 已保存，立即生效');
}catch(e){error.value=e.response?.data?.error||e.message;}finally{busy.value=false;}}
onMounted(load);
</script>
<style scoped>.prompt-settings p{line-height:1.6;color:#526157}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.actions .el-button{margin-left:0}</style>
