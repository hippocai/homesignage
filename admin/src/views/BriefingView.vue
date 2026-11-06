<template>
  <main class="briefing-admin">
    <header>
      <div>
        <h2>资讯</h2>
        <p>符合话题偏好的订阅资讯会自动显示在屏幕上。</p>
      </div>
    </header>
    <el-alert v-if="error" :title="error" type="error" @close="error = ''" />
    <el-tabs v-model="tab">
      <el-tab-pane label="资讯记录" name="events">
        <div class="bar">
          <el-select
            v-model="state"
            @change="
              page = 0;
              loadEvents();
            "
            style="width: 160px"
            ><el-option v-for="(name, k) in filters" :key="k" :label="name" :value="k" /></el-select
          ><el-button @click="loadEvents">刷新</el-button>
        </div>
        <el-table :data="events" empty-text="暂无事件。请先添加订阅并采集。"
          ><el-table-column label="消息" min-width="200"
            ><template #default="{ row }"
              ><b>{{ row.payload.title }}</b>
              <p>{{ row.payload.summary }}</p></template
            ></el-table-column
          ><el-table-column label="来源" prop="payload.source" /><el-table-column label="状态"
            ><template #default="{ row }">{{
              row.expires <= Date.now() ? '已过期' : filters[row.state]
            }}</template></el-table-column
          ><el-table-column width="100"
            ><template #default="{ row }"
              ><el-button @click="openEvent(row)">详情</el-button></template
            ></el-table-column
          ></el-table
        >
        <div class="bar">
          <el-button
            :disabled="!page"
            @click="
              page--;
              loadEvents();
            "
            >上一页</el-button
          ><el-button
            :disabled="events.length < 100"
            @click="
              page++;
              loadEvents();
            "
            >下一页</el-button
          >
        </div>
      </el-tab-pane>
      <el-tab-pane label="订阅来源" name="sources">
        <div class="source-actions">
          <el-select v-model="presetKey" class="preset-picker" aria-label="常用资讯来源" placeholder="选择常用来源">
            <el-option-group v-for="group in presetGroups" :key="group.name" :label="group.name">
              <el-option v-for="p in group.items" :key="p.key" :value="p.key"
                :label="p.name + (p.subscribedId ? '（已订阅）' : '')" :disabled="!!p.subscribedId" />
            </el-option-group>
          </el-select>
          <el-button type="primary" :disabled="!presetKey" :loading="subscribing" @click="subscribePreset">订阅所选来源</el-button>
          <el-button @click="editSource()">自定义来源</el-button>
        </div>
        <el-table :data="sources"
          ><el-table-column label="名称" prop="name" /><el-table-column
            label="来源"
          ><template #default="{ row }">{{ sourceTypes[row.type] || row.type }}</template></el-table-column
          ><el-table-column label="状态" width="78"><template #default="{ row }">{{ row.enabled ? '已启用' : '已停用' }}</template></el-table-column
          ><el-table-column label="上次采集"
            ><template #default="{ row }">{{
              row.error || date(row.last_ok)
            }}</template></el-table-column
          ><el-table-column label="操作" min-width="285"
            ><template #default="{ row }"
              ><el-button link @click="editSource(row)">编辑</el-button
              ><el-button link @click="scan(row, 'test')">试采集</el-button
              ><el-button link @click="scan(row, 'scan')">立即采集</el-button
              ><el-button link type="danger" @click="removeSource(row)">移除</el-button></template
            ></el-table-column
          ></el-table
        >
      </el-tab-pane>
      <el-tab-pane label="话题偏好" name="topics">
        <el-form label-width="115px">
          <p>关注列表留空时接收所有话题。同时命中两个列表时，优先排除。</p>
          <el-form-item v-for="(label,key) in topicLabels" :key="key" :label="label">
            <el-input-tag v-model="settings[key]" :aria-label="label" :max="100" :maxlength="80"
              :delimiter="/[,，、\n]/" placeholder="输入话题，按回车添加" style="width:100%"/>
          </el-form-item>
          <p>可以写「中国发生的重要事件」或「影响苏州通勤的消息」。系统优先按语义判断，模型不可用或额度不足时按关键词筛选。</p>
          <el-button type="primary" @click="saveTopics">保存话题偏好</el-button>
        </el-form>
      </el-tab-pane>
    </el-tabs>
    <el-dialog v-model="sourceDialog" title="订阅来源" width="min(600px,95%)"
      ><el-form label-width="118px">
        <el-form-item label="名称"><el-input v-model="src.name" /></el-form-item
        ><el-form-item label="类型"
          ><el-select v-model="src.type"
            ><el-option value="rss" label="RSS / Atom" /><el-option
              value="zaobao"
              label="联合早报" /><el-option value="brave" label="Brave News" /><el-option
              value="ranking"
              label="平台榜单 JSON" /></el-select
        ></el-form-item>
        <el-form-item v-if="src.type === 'zaobao'" label="早报栏目"
          ><el-select v-model="src.section" placeholder="最新"
            ><el-option
              v-for="(label, key) in {
                all: '最新',
                china: '中港台',
                world: '国际',
                singapore: '新加坡',
                finance: '财经'
              }"
              :key="key"
              :label="label"
              :value="key" /></el-select
        ></el-form-item>
        <el-form-item v-else :label="src.type === 'brave' ? '搜索词' : '订阅地址'"
          ><el-input v-if="src.type === 'brave'" v-model="src.query" /><el-input
            v-else
            v-model="src.url"
            placeholder="https://"
        /></el-form-item>
        <el-form-item v-if="src.type === 'brave'" label="国家 / 语言"
          ><el-input v-model="src.country" /><el-input v-model="src.language"
        /></el-form-item>
        <el-form-item label="关注词"
          ><el-input v-model="src.keywords" placeholder="逗号分隔，留空接收全部" /></el-form-item
        ><el-form-item label="地区关键词"><el-input v-model="src.region" /></el-form-item
        ><el-form-item label="屏蔽词"><el-input v-model="src.blocked" /></el-form-item>
        <el-form-item label="采集间隔（分）"
          ><el-input-number v-model="src.interval" :min="2" :max="1440"
        /></el-form-item>
        <el-form-item label="自动采集"><el-switch v-model="src.enabled" /></el-form-item
        ><el-form-item v-if="src.type === 'rss'" label="权威公告来源"
          ><el-switch v-model="src.trusted"
        /></el-form-item>
        <el-form-item label="接收设备"
          ><el-select v-model="src.targets" multiple clearable placeholder="全部屏幕"
            ><el-option v-for="d in devices" :key="d.id" :label="d.name" :value="d.id" /></el-select
        ></el-form-item> </el-form
      ><template #footer
        ><el-button type="primary" @click="saveSource">保存来源</el-button></template
      ></el-dialog
    >
    <el-dialog v-model="eventDialog" title="资讯详情" width="min(680px,95%)"
      ><template v-if="event"
        ><p>{{ event.payload.reason }}</p>
        <p v-for="a in event.evidence" :key="a.ref">
          <a :href="a.url" target="_blank" rel="noopener">{{ a.title }}</a
          >　{{ a.excerpt }}
        </p>
        <el-form label-width="90px"
          ><el-form-item label="标题"><el-input v-model="event.payload.title" /></el-form-item
          ><el-form-item label="摘要"
            ><el-input v-model="event.payload.summary" type="textarea" /></el-form-item
          ><el-form-item label="提醒文案"
            ><el-input v-model="event.payload.speech" type="textarea" /></el-form-item
          ><el-form-item label="允许主动提醒"
            ><el-switch v-model="event.payload.speak" /><el-button
              link
              @click="listen(event.payload.speech)"
              >本机试听</el-button
            ></el-form-item
          >
          <el-form-item label="目标设备"
            ><el-select v-model="event.targets" multiple clearable
              ><el-option
                v-for="d in devices"
                :key="d.id"
                :label="d.name"
                :value="d.id" /></el-select></el-form-item
        ></el-form>
        <template v-if="event.kind === 'news'"
          ><el-select v-model="mergeId" clearable filterable placeholder="选择要归入的新闻"
            ><el-option
              v-for="e in events.filter(
                (e) => e.id !== event.id && e.kind === 'news' && e.state !== 'withdrawn'
              )"
              :key="e.id"
              :label="e.payload.title"
              :value="e.id"
          /></el-select>
          <el-button :disabled="!mergeId" @click="group('merge')">合并</el-button>
          <p v-for="a in event.evidence.length > 1 ? event.evidence : []" :key="a.sourceId + a.ref">
            {{ a.title }} <el-button link @click="group('split', a)">拆为独立资讯</el-button>
          </p></template
        >
        <p v-for="r in event.deliveries" :key="r.device">
          {{ devices.find((d) => d.id === r.device)?.name || r.device }} · {{ r.result }} ·
          {{ date(r.claimed) }}
        </p></template
      >
      <template #footer
        ><template v-if="event && ['news', 'ranking'].includes(event.kind)"
          ><el-button @click="act('withdraw')">撤回</el-button
          ><el-button @click="act('edit')">保存修改</el-button
          ></template
        ><span v-else>家庭事项在信息列表编辑，降温提醒在设备规则里设置。</span></template
      >
    </el-dialog>
    <el-dialog v-model="sampleVisible" title="试采集结果"
      ><p v-for="s in samples" :key="s.ref">
        <a :href="s.url" target="_blank" rel="noopener">{{ s.title }}</a>
      </p>
      <el-empty v-if="!samples.length" description="没有符合话题偏好的条目"
    /></el-dialog>
  </main>
</template>
<script setup>
import { computed, ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api/index.js';
const tab = ref(useRoute().query.tab === 'sources' ? 'sources' : 'events'),
  sources = ref([]),
  events = ref([]),
  devices = ref([]),
  settings = ref({}),
  src = ref({}),
  event = ref(null),
  error = ref('');
const state = ref(''),
  page = ref(0),
  sourceDialog = ref(false),
  eventDialog = ref(false),
  sampleVisible = ref(false),
  samples = ref([]);
const filters = { '': '全部', review: '历史记录', published: '已发布', withdrawn: '已撤回' };
const sourceTypes = {rss:'新闻 RSS/Atom',ranking:'热搜榜',zaobao:'新闻索引',brave:'Brave 新闻'};
const presets = ref([]), presetKey = ref(''), subscribing = ref(false);
const presetGroups = computed(() => [...new Set(presets.value.map(p => p.group))]
  .map(name => ({name, items:presets.value.filter(p => p.group === name)})));
const topicLabels = { interests:'感兴趣的话题', dislikes:'不感兴趣的话题' };
async function saveTopics() {
  await call('put', '/news/settings', { interests:settings.value.interests || [], dislikes:settings.value.dislikes || [], blocked:'' });
  await loadEvents();
  ElMessage.success('话题偏好已保存');
}
const date = (n) => (n ? new Date(n).toLocaleString() : '尚无记录');
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
async function loadEvents() {
  events.value = await call('get', '/news/events?scope=news&state=' + state.value + '&offset=' + page.value * 100);
}
async function loadSources() {
  [sources.value, presets.value] = await Promise.all([call('get', '/news/sources'), call('get', '/news/presets')]);
}
async function subscribePreset() {
  if (!presetKey.value || subscribing.value) return;
  subscribing.value = true;
  try {
    const result = await call('post', '/news/presets/' + presetKey.value + '/subscribe');
    presetKey.value = '';
    await loadSources();
    ElMessage.success(result.added ? '已添加订阅来源' : '该来源已订阅');
  } finally { subscribing.value = false; }
}
async function loadSettings() {
  const saved = await call('get', '/news/settings');
  settings.value = {...saved, dislikes:[...new Set([...(saved.dislikes || []), ...(saved.blocked || '').split(/[,，\n]/).map(s=>s.trim()).filter(Boolean)])]};
}
function editSource(row) {
  src.value = row
    ? structuredCloneSafe(row)
    : {
        name: '',
        type: 'rss',
        url: '',
        interval: 10,
        enabled: true,
        trusted: false,
        targets: [],
        country: 'ALL',
        language: 'zh-hans'
      };
  sourceDialog.value = true;
}
const structuredCloneSafe = (v) => JSON.parse(JSON.stringify(v));
async function saveSource() {
  const s = src.value;
  await call(s.id ? 'patch' : 'post', '/news/sources' + (s.id ? '/' + s.id : ''), s);
  sourceDialog.value = false;
  await loadSources();
}
async function scan(row, op) {
  const r = await call('post', '/news/sources/' + row.id + '/' + op);
  if (op === 'test') {
    samples.value = r;
    sampleVisible.value = true;
  } else {
    const message = r.unchanged ? row.name + '：来源内容未更新' :
      row.name + '：读取 ' + r.received + ' 条，通过筛选并处理 ' + r.count + ' 条';
    if (r.topicFallback) ElMessage.warning(message + '。部分或全部条目使用关键词匹配（' + r.topicFallback + '）');
    else ElMessage.success(message);
    await loadEvents();
  }
  await loadSources();
}
async function removeSource(row) {
  await ElMessageBox.confirm('移除订阅「' + row.name + '」？');
  await call('delete', '/news/sources/' + row.id);
  await loadSources();
}
const mergeId = ref('');
async function group(action, a = {}) {
  const e = event.value,
    d = events.value.find((x) => x.id === mergeId.value);
  await call('post', '/news/events/' + e.id + '/actions', {
    action,
    version: e.version,
    source: a.sourceId,
    ref: a.ref,
    destination: d?.id,
    destinationVersion: d?.version
  });
  eventDialog.value = false;
  await loadEvents();
}
async function openEvent(row) {
  mergeId.value = '';
  event.value = await call('get', '/news/events/' + row.id);
  eventDialog.value = true;
}
async function act(action) {
  const e = event.value;
  await call('post', '/news/events/' + e.id + '/actions', {
    ...e.payload,
    action,
    version: e.version,
    targets: e.targets
  });
  eventDialog.value = false;
  await loadEvents();
}
function listen(line) {
  if (!window.speechSynthesis) return ElMessage.warning('本机没有中文朗读服务');
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(line);
  u.lang = 'zh-CN';
  window.speechSynthesis.speak(u);
}
onMounted(async () => {
  await Promise.all([
    loadEvents(),
    loadSources(),
    loadSettings(),
    call('get', '/devices').then((d) => (devices.value = d))
  ]);
});
</script>
<style scoped>
.briefing-admin {
  max-width: 1220px;
}
.briefing-admin header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 30px;
  background: #fff3dd;
  border-radius: 16px;
  color: #334d43;
}
.briefing-admin header img {
  height: 95px;
}
.briefing-admin header p,
.briefing-admin td p {
  color: #69776e;
}
.briefing-admin .el-tabs {
  margin-top: 18px;
  background: white;
  padding: 12px 20px;
  border-radius: 12px;
}
.bar {
  display: flex;
  gap: 10px;
  margin: 12px 0;
}
.source-actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 12px 0; }
.source-actions .el-button { margin-left: 0; }
.preset-picker { width: min(240px, 100%); }
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
