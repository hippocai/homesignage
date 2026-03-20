<template>
  <div class="reminders-page">
    <div class="page-header">
      <h2 class="page-title">定时提示</h2>
      <el-button type="primary" :icon="Plus" @click="openCreateDialog">创建提示</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="reminders" v-loading="loading" stripe size="default">
        <el-table-column prop="name" label="名称" min-width="140" />
        <el-table-column label="开始时间" width="170">
          <template #default="{ row }">
            {{ formatDateTime(row, 'start_time') }}
          </template>
        </el-table-column>
        <el-table-column label="结束时间" width="100">
          <template #default="{ row }">
            {{ formatDateTime(row, 'end_time') }}
          </template>
        </el-table-column>
        <el-table-column label="重复" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="getRepeatType(row.repeat_rule)">
              {{ getRepeatLabel(row.repeat_rule) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="优先级" width="80">
          <template #default="{ row }">
            <el-tag size="small" type="warning">{{ row.priority || 5 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="样式" width="120">
          <template #default="{ row }">
            <span class="text-muted">{{ getStyleLabel(row.content?.style) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="80">
          <template #default="{ row }">
            <el-switch
              v-model="row.enabled"
              @change="toggleEnabled(row)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="Edit" @click="openEditDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" :icon="Delete" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Create/Edit Reminder Drawer -->
    <el-drawer
      v-model="drawerVisible"
      :title="editingReminder ? '编辑提示' : '创建提示'"
      size="520px"
      @closed="resetForm"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="100px"
        class="reminder-form"
      >
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="提示名称" />
        </el-form-item>

        <el-form-item label="目标设备" prop="device_ids">
          <el-select
            v-model="form.device_ids"
            multiple
            placeholder="选择目标设备（留空=全部）"
            class="full-width"
          >
            <el-option
              v-for="device in devices"
              :key="device.id"
              :label="device.name"
              :value="device.id"
            />
          </el-select>
        </el-form-item>

        <el-form-item v-if="form.repeat_rule === 'none'" label="日期" prop="start_date">
          <el-date-picker
            v-model="form.start_date"
            type="date"
            placeholder="选择日期"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            class="full-width"
          />
        </el-form-item>

        <el-form-item label="开始时间" prop="start_time">
          <el-time-picker
            v-model="form.start_time"
            placeholder="选择开始时间"
            format="HH:mm"
            value-format="HH:mm"
            class="full-width"
          />
        </el-form-item>

        <el-form-item label="结束时间" prop="end_time">
          <el-time-picker
            v-model="form.end_time"
            placeholder="选择结束时间"
            format="HH:mm"
            value-format="HH:mm"
            class="full-width"
          />
        </el-form-item>

        <el-form-item label="重复规则">
          <el-select v-model="form.repeat_rule" class="full-width">
            <el-option label="不重复" value="none" />
            <el-option label="每天" value="daily" />
            <el-option label="工作日" value="weekday" />
            <el-option label="周末" value="weekend" />
          </el-select>
        </el-form-item>

        <el-divider content-position="left">内容设置</el-divider>

        <el-form-item label="提示内容" prop="content">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="3"
            placeholder="输入提示文字"
          />
        </el-form-item>

        <el-form-item label="显示样式">
          <el-select v-model="form.content_style" class="full-width">
            <el-option label="闪烁" value="blink" />
            <el-option label="高亮" value="highlight" />
            <el-option label="顶部横幅" value="bar-top" />
            <el-option label="底部横幅" value="bar-bottom" />
            <el-option label="居中全屏" value="center" />
          </el-select>
        </el-form-item>

        <el-form-item label="字体大小">
          <el-input-number
            v-model="form.font_size"
            :min="12"
            :max="200"
            controls-position="right"
          />
          <span class="unit-label">px</span>
        </el-form-item>

        <el-form-item label="文字颜色">
          <el-color-picker v-model="form.text_color" />
          <span class="color-value">{{ form.text_color }}</span>
        </el-form-item>

        <el-form-item label="背景颜色">
          <el-color-picker v-model="form.background_color" show-alpha />
          <span class="color-value">{{ form.background_color }}</span>
        </el-form-item>

        <el-form-item label="优先级">
          <el-slider
            v-model="form.priority"
            :min="1"
            :max="10"
            show-stops
            :marks="priorityMarks"
            class="priority-slider"
          />
        </el-form-item>

        <el-divider content-position="left">声音设置</el-divider>

        <el-form-item label="启用声音">
          <el-switch v-model="form.sound_enabled" />
        </el-form-item>

        <el-form-item label="声音文件" v-if="form.sound_enabled">
          <div class="url-with-picker">
            <el-input v-model="form.sound_url" placeholder="声音文件URL" />
            <el-button :icon="FolderOpened" @click="soundPickerVisible = true">从仓库选择</el-button>
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="drawer-footer">
          <el-button @click="drawerVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="saveReminder">
            {{ editingReminder ? '保存修改' : '创建提示' }}
          </el-button>
        </div>
      </template>
    </el-drawer>

    <FilePicker v-model="soundPickerVisible" type="audio" @select="(url) => form.sound_url = url" />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, FolderOpened } from '@element-plus/icons-vue'
import FilePicker from '../components/FilePicker.vue'
import { remindersApi, devicesApi } from '../api/index.js'

const loading = ref(false)
const saving = ref(false)
const reminders = ref([])
const devices = ref([])
const drawerVisible = ref(false)
const editingReminder = ref(null)
const formRef = ref(null)
const soundPickerVisible = ref(false)

const form = reactive({
  name: '',
  device_ids: [],
  start_date: '',
  start_time: '',
  end_time: '',
  repeat_rule: 'none',
  content: '',
  content_style: 'bar-bottom',
  font_size: 24,
  text_color: '#FFFFFF',
  background_color: '#FF6600',
  priority: 5,
  sound_enabled: false,
  sound_url: ''
})

const rules = {
  name: [{ required: true, message: '请输入提示名称', trigger: 'blur' }],
  content: [{ required: true, message: '请输入提示内容', trigger: 'blur' }],
  start_date: [{ required: true, message: '请选择日期', trigger: 'change' }],
  start_time: [{ required: true, message: '请选择开始时间', trigger: 'change' }],
  end_time: [{ required: true, message: '请选择结束时间', trigger: 'change' }]
}

const priorityMarks = { 1: '低', 5: '中', 10: '高' }

function formatDateTime(row, field) {
  const time = row[field]
  if (!time) return '—'
  if (row.repeat === 'none' && row.start_date) {
    return field === 'start_time' ? `${row.start_date} ${time}` : time
  }
  return time
}

function getRepeatLabel(rule) {
  const map = { none: '不重复', daily: '每天', weekday: '工作日', weekend: '周末' }
  return map[rule] || rule || '不重复'
}

function getRepeatType(rule) {
  return rule && rule !== 'none' ? 'primary' : 'info'
}

function getStyleLabel(style) {
  const map = {
    blink: '闪烁',
    highlight: '高亮',
    'bar-top': '顶部横幅',
    'bar-bottom': '底部横幅',
    center: '居中全屏'
  }
  return map[style] || style || '底部横幅'
}

function openCreateDialog() {
  editingReminder.value = null
  drawerVisible.value = true
}

function openEditDialog(reminder) {
  editingReminder.value = reminder
  const content = reminder.content || {}
  const sound = reminder.sound || {}
  form.name = reminder.name || ''
  form.device_ids = reminder.device_ids || []
  form.start_date = reminder.start_date || ''
  form.start_time = reminder.start_time || ''
  form.end_time = reminder.end_time || ''
  form.repeat_rule = reminder.repeat || 'none'
  form.content = content.text || ''
  form.content_style = content.style || 'bar-bottom'
  form.font_size = content.fontSize || 24
  form.text_color = content.color || '#FFFFFF'
  form.background_color = content.backgroundColor || '#FF6600'
  form.priority = reminder.priority || 5
  form.sound_enabled = !!(sound.file || reminder.sound_enabled)
  form.sound_url = sound.file || ''
  drawerVisible.value = true
}

function resetForm() {
  editingReminder.value = null
  form.name = ''
  form.device_ids = []
  form.start_date = ''
  form.start_time = ''
  form.end_time = ''
  form.repeat_rule = 'none'
  form.content = ''
  form.content_style = 'bar-bottom'
  form.font_size = 24
  form.text_color = '#FFFFFF'
  form.background_color = '#FF6600'
  form.priority = 5
  form.sound_enabled = false
  form.sound_url = ''
  if (formRef.value) formRef.value.clearValidate()
}

async function saveReminder() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const deviceIds = (form.device_ids.length === 0 || form.device_ids.includes('all'))
      ? ['all']
      : form.device_ids
    const data = {
      name: form.name,
      device_ids: deviceIds,
      start_date: form.repeat_rule === 'none' ? form.start_date : null,
      start_time: form.start_time,
      end_time: form.end_time,
      repeat: form.repeat_rule || 'none',
      content: {
        text: form.content,
        style: form.content_style,
        fontSize: form.font_size,
        color: form.text_color,
        backgroundColor: form.background_color
      },
      sound: form.sound_enabled ? { file: form.sound_url || 'bell.mp3', volume: 0.7, loop: false } : null,
      priority: form.priority,
      enabled: true
    }

    if (editingReminder.value) {
      await remindersApi.updateTimed(editingReminder.value.id, data)
      ElMessage.success('提示已更新')
    } else {
      await remindersApi.createTimed(data)
      ElMessage.success('提示已创建')
    }
    drawerVisible.value = false
    await loadReminders()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(reminder) {
  try {
    await remindersApi.updateTimed(reminder.id, { enabled: reminder.enabled })
    ElMessage.success(reminder.enabled ? '已启用' : '已禁用')
  } catch (error) {
    reminder.enabled = !reminder.enabled // revert
    ElMessage.error('操作失败')
  }
}

async function handleDelete(reminder) {
  try {
    await ElMessageBox.confirm(`确定删除提示 "${reminder.name}" 吗？`, '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await remindersApi.deleteTimed(reminder.id)
    ElMessage.success('已删除')
    await loadReminders()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '删除失败')
    }
  }
}

async function loadReminders() {
  loading.value = true
  try {
    const res = await remindersApi.listTimed()
    reminders.value = res.data.data || []
  } finally {
    loading.value = false
  }
}

async function loadDevices() {
  try {
    const res = await devicesApi.list()
    devices.value = res.data.data || []
  } catch {
    devices.value = []
  }
}

onMounted(() => {
  loadReminders()
  loadDevices()
})
</script>

<style scoped>
.reminders-page {
  min-height: 100%;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.text-muted {
  color: #909399;
  font-size: 13px;
}

.reminder-form {
  padding: 0 4px;
}

.full-width {
  width: 100%;
}

.unit-label {
  margin-left: 8px;
  color: #909399;
  font-size: 13px;
}

.color-value {
  margin-left: 10px;
  font-size: 13px;
  color: #606266;
}

.priority-slider {
  width: 100%;
  margin-right: 0;
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 0 0;
}

.url-with-picker {
  display: flex;
  gap: 8px;
  width: 100%;
}
</style>
