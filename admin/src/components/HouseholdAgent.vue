<template>
  <el-card class="agent">
    <h3>猪猪家庭助手</h3>
    <el-alert v-if="error" :title="error" type="error" @close="error=''" />
    <div v-if="shareUrl" class="share">
      <b>家庭聊天链接</b><small>任何能打开此链接的人都可以聊天，无需后台账号。</small>
      <div><a :href="shareUrl" target="_blank" rel="noopener">{{shareUrl}}</a>
        <el-button link @click="copyLink">复制链接</el-button></div>
    </div>
    <el-tabs v-model="tab">
      <el-tab-pane label="和猪猪聊天" name="chat">
        <p v-if="!turns.length">告诉猪猪：「明早提醒我拿红包，只记在你自己的记忆里」；也可明确要求：「今晚18点至23点在信息列表提示给车充电」。独立记忆由模型决定气泡提醒时机，需要屏幕在线及模型可用。</p>
        <div ref="thread" class="thread" aria-live="polite">
          <div v-for="turn in turns" :key="turn.id">
            <p class="user-line"><b>你</b>{{ turn.message }}</p>
            <p><b>猪猪</b>{{ turn.reply }}</p>
          </div>
        </div>
        <el-input v-model="draft" type="textarea" :rows="2" :maxlength="1600" aria-label="发给猪猪的消息"
          placeholder="说说出行计划，或问问最近有哪些消息会影响家里" @keydown="submitKey"/>
        <el-button type="primary" :loading="busy" :disabled="!ready || !draft.trim()" @click="send">发送</el-button>
        <div v-if="plans.length" class="plans">
          <h4>记住的计划</h4>
          <div v-for="plan in plans" :key="plan.id" class="plan">
            <span>{{plan.text}} <small>{{[plan.start,plan.end!==plan.start && plan.end].filter(Boolean).join(' 至 ')}}</small></span>
            <el-button link :disabled="busy" @click="remove(plan.id)">取消跟进</el-button>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane label="家庭记忆" name="profile">
        <p>像写 MEMORY.md 一样，用自己的话记下家人、习惯、地点、偏好或提醒约定。聊天与资讯判断都会参考这份共享记忆；请只写愿意让家庭聊天助手使用的信息。</p>
        <el-form v-if="ready" label-width="100px">
          <el-form-item label="记忆文档"><el-input v-model="form.memory" type="textarea" aria-label="记忆文档"
            :autosize="{minRows:8,maxRows:24}" :maxlength="12000" show-word-limit placeholder="例如：每周三接孩子，回家要经过青禾路。"/></el-form-item>
          <el-form-item label="家庭时区"><el-input v-model="form.zone" placeholder="Asia/Shanghai"/></el-form-item>
          <el-button type="primary" :loading="busy" @click="save">保存家庭记忆</el-button>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="猪猪自己的记忆" name="memory">
        <p>通过聊天新增、修改或取消，临时事项到期自动删除。文件：data/pig-agent-memory.md（可读镜像）。</p>
        <el-button @click="loadMemory">刷新记忆</el-button>
        <el-radio-group v-model="memoryView" aria-label="独立记忆查看方式">
          <el-radio-button value="text" label="text">文本</el-radio-button><el-radio-button value="list" label="list">列表</el-radio-button>
        </el-radio-group>
        <el-input v-if="memoryView==='text'" :model-value="memoryText" type="textarea" readonly :autosize="{minRows:10,maxRows:30}" aria-label="猪猪独立记忆文本" style="margin-top:12px" />
        <template v-else>
        <p v-if="!ownMemory.length">目前没有独立记忆。</p>
        <article v-for="m in ownMemory" :key="m.id"><b>{{m.text}}</b><p>生效：{{new Date(m.starts).toLocaleString()}} · 到期：{{m.expires?new Date(m.expires).toLocaleString():'长期保留'}}</p><small>{{m.id}}</small></article>
        </template>
        <h4>最近记忆操作</h4>
        <p v-for="a in memoryAudit" :key="a.id">{{new Date(a.at).toLocaleString()}} · {{ {remember:'记住',update:'修改',forget:'取消',expire:'自动到期'}[a.op] || a.op }} · {{a.memory_id}}</p>
      </el-tab-pane>
      <el-tab-pane label="聊天审计" name="audit">
        <p>记录用户聊天和自动气泡的完整模型对话。访客称呼由本人填写，会话编号用于区分浏览器。</p>
        <el-select v-model="auditType" aria-label="审计信息类型" style="width:190px" @change="loadAudit(false)">
          <el-option v-for="o in auditTypes" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="auditScope" aria-label="审计用户" clearable filterable placeholder="全部用户与系统" style="width:240px" @change="loadAudit(false)">
          <el-option label="猪猪气泡（系统）" value="system:narration" />
          <el-option v-for="u in auditUsers" :key="u.scope" :label="u.actor+' · '+(u.scope==='admin'?'后台':u.scope.slice(0,8))" :value="u.scope" />
        </el-select>
        <el-button @click="loadAudit(false)">刷新记录</el-button>
        <p v-if="!auditRows.length">暂无聊天记录。</p>
        <article v-for="row in auditRows" :key="row.id" class="audit">
          <b>{{row.actor}}</b> · {{new Date(row.created).toLocaleString()}} · {{ {ok:'已回复',failed:'失败',pending:'处理中'}[row.status] }}
          <small>{{row.scope==='admin'?'管理后台':'会话 '+row.scope}} · {{row.ip || '未记录地址'}}</small>
          <small v-if="row.model">模型：{{row.model}}</small>
          <p v-if="row.message"><strong>消息：</strong>{{row.message}}</p><p v-if="row.reply"><strong>回复：</strong>{{row.reply}}</p><p v-if="row.error">{{row.error}}</p>
          <details v-if="row.system_prompt" :open="auditType==='system_prompt'"><summary>System prompt</summary><pre>{{row.system_prompt}}</pre></details>
          <details v-if="row.model_context" :open="auditType==='model_context'"><summary>发送给模型的上下文</summary><pre>{{row.model_context}}</pre></details>
          <details v-if="row.model_response" :open="auditType==='model_response'"><summary>模型原始返回</summary><pre>{{row.model_response}}</pre></details>
          <div v-for="a in row.actions" :key="a.id" class="audit-action">
            <small>{{ {create:'创建',view:'查看',update:'修改',cancel:'取消'}[a.op || 'create'] }} · {{a.type==='info'?'信息列表':'定时提示'}} · {{a.id}}</small>
            <p v-if="a.before">原记录：{{a.before.text}}（{{a.before.start}} 至 {{a.before.end}}）</p>
            <p v-if="a.after">新记录：{{a.after.text}}（{{a.after.start}} 至 {{a.after.end}}）</p>
          </div>
          <p v-for="a in row.memoryActions" :key="a.id">猪猪独立记忆 · {{ {remember:'记住',update:'修改',forget:'取消'}[a.op] }} · {{a.text || a.id}}</p>
        </article>
        <el-button v-if="auditNext" @click="loadAudit(true)">查看更早记录</el-button>
      </el-tab-pane>
      <el-tab-pane label="气泡判断记录" name="impacts">
        <p v-if="!impacts.length">暂无模型气泡决策，屏幕上线后会生成。</p>
        <article v-for="item in impacts" :key="item.id">
          <b>{{item.payload.speech}}</b><p>{{item.payload.reason}}</p>
          <small>{{new Date(item.created).toLocaleString()}} · {{item.result || '尚未展示'}} · 有效至 {{new Date(item.expires).toLocaleString()}}</small>
        </article>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>
<script setup>
import {ref, onMounted, onBeforeUnmount, nextTick, watch} from 'vue';
import {ElMessage} from 'element-plus';
import api from '../api/index.js';
const tab=ref('chat'), ready=ref(false), busy=ref(false), error=ref(''), draft=ref('');
const form=ref({}), revision=ref(0), plans=ref([]), turns=ref([]), impacts=ref([]), thread=ref(null);
const impactStatus=ref('');
const shareUrl=ref(''),auditRows=ref([]),auditNext=ref(null);
const auditType=ref('all'),auditScope=ref(''),auditUsers=ref([]);
const auditTypes=[{value:'all',label:'全部类型'},{value:'chat',label:'用户对话'},{value:'narration',label:'自动气泡完整对话'},{value:'system_prompt',label:'仅 System prompt'},{value:'model_context',label:'仅模型上下文'},{value:'model_response',label:'仅模型返回'}];
const ownMemory=ref([]),memoryAudit=ref([]);
const memoryText=ref(''),memoryView=ref('text');
async function loadMemory(){try{const result=(await api.get('/companion/agent/memory')).data.data;ownMemory.value=result.entries;memoryText.value=result.text;memoryAudit.value=result.audit;}catch(e){showError(e);}}
async function loadLinks() {
  shareUrl.value=(await api.get('/companion/agent/share')).data.data.links[0];
}
async function copyLink() {
  try { await navigator.clipboard.writeText(shareUrl.value); ElMessage.success('链接已复制'); }
  catch { const input=document.createElement('textarea');input.value=shareUrl.value;document.body.append(input);input.select();
    const ok=document.execCommand('copy');input.remove();ElMessage.info(ok?'链接已复制':'请长按或右键上方链接复制'); }
}
let auditRequest=0;
async function loadAudit(older) {
  const ticket=++auditRequest;
  try {const result=(await api.get('/companion/agent/audit',{params:{type:auditType.value,scope:auditScope.value,...(older?{before:auditNext.value}:{})}})).data.data;
    if(ticket!==auditRequest)return;
    auditRows.value=older?[...auditRows.value,...result.items]:result.items;auditNext.value=result.next;auditUsers.value=result.users || [];
  }catch(e){showError(e);}
}
function showError(e) { error.value=e.response?.data?.error || e.message; }
let loadedProfile='';
async function load(resetForm=true) {
  const {data:{data:h}}=await api.get('/companion/agent');
  const snapshot=JSON.stringify(h.profile);
  if(resetForm) { form.value={...h.profile}; loadedProfile=snapshot; }
  if(loadedProfile===snapshot) revision.value=h.revision;
  plans.value=h.plans; turns.value=h.history; ready.value=true;
  await nextTick();
  if(thread.value) thread.value.scrollTop=thread.value.scrollHeight;
}
async function save() {
  if(busy.value) return;
  busy.value=true; error.value='';
  try {
    await api.put('/companion/agent/profile',{profile:{memory:form.value.memory,zone:form.value.zone},revision:revision.value});
    await load(); ElMessage.success('家庭记忆已保存');
  } catch(e) {showError(e); if(e.response?.status===409) {
    const draft={...form.value};await load();form.value=draft;error.value='其他人刚更新过家庭资料或计划。你的草稿已保留；请核对后再保存，或刷新查看已保存的版本。';
  }}
  finally {busy.value=false;}
}
let retry;
async function send() {
  const message=draft.value.trim();
  if(!message || busy.value) return;
  if(retry?.message!==message) retry={message,requestId:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)};
  busy.value=true; error.value='';
  try {
    await api.post('/companion/agent/messages',retry);
    await load(false);
    if(draft.value.trim()===message) draft.value='';
    retry=null;
  } catch(e) {showError(e);}
  finally {busy.value=false;}
}
function submitKey(e) {
  if(e.key==='Enter' && !e.shiftKey && !e.isComposing && e.keyCode!==229) {e.preventDefault();send();}
}
async function remove(id) {
  if(busy.value) return;
  busy.value=true; error.value='';
  try {await api.delete('/companion/agent/plans/'+id); await load(false);}
  catch(e) {showError(e);} finally {busy.value=false;}
}
async function loadImpacts() {
  try { const result=(await api.get('/companion/agent/narrations')).data.data; impacts.value=result.items; }
  catch(e) {showError(e);}
}
let timer;
watch(tab, value=>{
  clearInterval(timer);
  if(value==='impacts') {loadImpacts(); timer=setInterval(loadImpacts,30000);}
  if(value==='audit') loadAudit(false);
  if(value==='memory'){loadMemory();timer=setInterval(loadMemory,30000);}
});
onMounted(()=>{load().catch(showError);loadLinks().catch(showError);});
onBeforeUnmount(()=>clearInterval(timer));
</script>
<style scoped>
.agent .thread{max-height:320px;overflow:auto}
.agent p{line-height:1.55;color:#526157}
.thread p{white-space:pre-wrap;padding:8px 12px;margin:4px 0;border-radius:8px;background:#edf5ef}
.thread b{margin-right:.8em}
.thread .user-line{background:#f9f3e6}
.agent .el-button{margin-top:8px}
.plan{display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid #eee;padding:6px 0}
.agent small{color:#65756e}
.agent article{padding:10px 0;border-bottom:1px solid #eee}
.share{display:grid;gap:4px;padding:12px;background:#f4f7f4;border-radius:8px}.share a{overflow-wrap:anywhere}.share select{max-width:100%}
.audit small{display:block}.audit p{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}
.audit pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:500px;overflow:auto;background:#f5f7f6;padding:12px}
</style>
