<template>
  <main class="model-settings">
    <h2>模型设置</h2>
    <p>资讯摘要、猪猪聊天和家庭提醒共用这里的模型和每日额度。</p>
    <el-alert v-if="error" :title="error" type="error" @close="error = ''" />
    <template v-if="form">
      <el-card>
        <el-form label-width="145px">
          <el-form-item label="模型服务">
            <el-select v-model="form.provider" @change="form.model = form.provider === 'glm' ? 'glm-5.3-flash' : 'deepseek-chat'">
              <el-option value="glm" label="智谱 GLM" /><el-option value="deepseek" label="DeepSeek" />
            </el-select>
          </el-form-item>
          <el-form-item label="模型名称"><el-input v-model="form.model" /></el-form-item>
          <el-form-item v-for="limit in limits" :key="limit.key" :label="limit.label">
            <el-input-number v-if="form[limit.key] !== -1" v-model="form[limit.key]" :min="0" :max="limit.max" :precision="0" :aria-label="limit.label" />
            <el-checkbox :model-value="form[limit.key] === -1" @change="toggleLimit(limit, $event)" :aria-label="limit.label + '不限额'">不限额</el-checkbox>
          </el-form-item>
          <el-form-item label="Brave 每日搜索上限"><el-input-number v-model="form.braveCalls" :min="0" :max="10000" :precision="0" /></el-form-item>
          <el-form-item label="今日用量（UTC）">
            <div v-for="u in form.usage" :key="u.provider">{{ u.provider }} · {{ u.calls }} 次<span v-if="u.provider !== 'brave'"> / {{ u.tokens }} 令牌</span></div>
            <span v-if="!form.usage.length">暂无调用</span>
          </el-form-item>
          <el-button type="primary" :loading="busy" @click="save">保存设置</el-button>
          <el-button :disabled="busy" @click="testModel">测试已保存的模型</el-button>
        </el-form>
      </el-card>
      <el-card>
        <h3>服务商 API Key</h3>
        <el-form label-width="110px" @submit.prevent>
          <el-form-item v-for="p in providers" :key="p.key" :label="p.label">
            <span>{{ ready(p.key) ? '已配置' : '尚未配置' }}</span>
            <el-input v-model="keys[p.key]" type="password" autocomplete="new-password" :aria-label="p.label + ' API Key'" placeholder="输入新的 API Key" />
            <el-button :disabled="busy || !keys[p.key]?.trim()" @click="saveKey(p)">保存密钥</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </template>
  </main>
</template>
<script setup>
import {ref,onMounted} from 'vue';
import {ElMessage} from 'element-plus';
import api from '../api/index.js';
const form=ref(null), keys=ref({}), busy=ref(false), error=ref('');
const providers=[{key:'glm',label:'智谱 GLM'},{key:'deepseek',label:'DeepSeek'},{key:'brave',label:'Brave Search'}];
const limits=[
  {key:'dailyCalls',label:'每日调用次数上限',max:10000},
  {key:'dailyTokens',label:'每日令牌上限',max:10000000}
];
const lastLimit={dailyCalls:100,dailyTokens:100000};
function toggleLimit(limit, unlimited) {
  if (unlimited) lastLimit[limit.key]=form.value[limit.key];
  form.value[limit.key]=unlimited ? -1 : lastLimit[limit.key];
}
const ready=key=>key==='brave' ? form.value.braveReady : form.value.ready[key];
async function run(action) {
  if (busy.value) return;
  busy.value=true; error.value='';
  try { await action(); }
  catch(e) { error.value=e.response?.data?.error || e.message; }
  finally { busy.value=false; }
}
const read=async()=>(await api.get('/news/settings')).data.data;
onMounted(()=>run(async()=>{ form.value=await read(); }));
function save() {
  return run(async()=>{
    const {provider,model,dailyCalls,dailyTokens,braveCalls}=form.value;
    await api.put('/news/settings',{provider,model,dailyCalls,dailyTokens,braveCalls});
    form.value=await read();
    ElMessage.success('模型设置已保存');
  });
}
function saveKey(p) {
  return run(async()=>{
    await api.put('/model/credentials/'+p.key,{apiKey:keys.value[p.key]});
    keys.value[p.key]='';
    if(p.key==='brave') form.value.braveReady=true;
    else form.value.ready[p.key]=true;
    ElMessage.success(p.label+' 密钥已保存');
  });
}
function testModel() {
  return run(async()=>{
    const result=(await api.post('/news/model/test')).data.data;
    form.value.usage=(await read()).usage;
    ElMessage.success('模型已连接：'+result.speech);
  });
}
</script>
<style scoped>
.model-settings { max-width: 860px; }
.model-settings > p { color: #606266; }
.model-settings .el-card { margin: 18px 0; }
.model-settings h3 { margin: 0 0 16px; }
.model-settings .el-checkbox { margin-left: 12px; }
.model-settings .el-input { max-width: 340px; }
.model-settings .el-card:last-child .el-input { margin: 0 10px; }
</style>
