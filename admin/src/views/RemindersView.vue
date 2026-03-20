<template>
  <div class="reminders-page">
    <div class="page-header">
      <h2 class="page-title">{{ $t('reminder.title') }}</h2>
      <el-button type="primary" :icon="Plus" @click="openCreateDialog">{{ $t('reminder.createReminder') }}</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="reminders" v-loading="loading" stripe size="default">
        <el-table-column prop="name" :label="$t('reminder.name')" min-width="140" />
        <el-table-column :label="$t('reminder.startTime')" width="170">
          <template #default="{ row }">
            {{ formatDateTime(row, 'start_time') }}
          </template>
        </el-table-column>
        <el-table-column :label="$t('reminder.endTime')" width="100">
          <template #default="{ row }">
            {{ formatDateTime(row, 'end_time') }}
          </template>
        </el-table-column>
        <el-table-column :label="$t('reminder.repeat')" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="getRepeatType(row.repeat_rule)">
              {{ getRepeatLabel(row.repeat_rule) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('reminder.priority')" width="80">
          <template #default="{ row }">
            <el-tag size="small" type="warning">{{ row.priority || 5 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('reminder.style')" width="120">
          <template #default="{ row }">
            <span class="text-muted">{{ getStyleLabel(row.content?.style) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('reminder.enabled')" width="80">
          <template #default="{ row }">
            <el-switch
              v-model="row.enabled"
              @change="toggleEnabled(row)"
            />
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="130" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="Edit" @click="openEditDialog(row)">{{ $t('common.edit') }}</el-button>
            <el-button size="small" type="danger" :icon="Delete" @click="handleDelete(row)">
              {{ $t('common.delete') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Create/Edit Reminder Drawer -->
    <el-drawer
      v-model="drawerVisible"
      :title="editingReminder ? $t('reminder.editReminder') : $t('reminder.createReminder')"
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
        <el-form-item :label="$t('reminder.name')" prop="name">
          <el-input v-model="form.name" :placeholder="$t('reminder.namePlaceholder')" />
        </el-form-item>

        <el-form-item :label="$t('reminder.targetDevices')" prop="device_ids">
          <el-select
            v-model="form.device_ids"
            multiple
            :placeholder="$t('reminder.targetDevicesPlaceholder')"
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

        <el-form-item v-if="form.repeat_rule === 'none'" :label="$t('reminder.date')" prop="start_date">
          <el-date-picker
            v-model="form.start_date"
            type="date"
            :placeholder="$t('reminder.datePlaceholder')"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            class="full-width"
          />
        </el-form-item>

        <el-form-item :label="$t('reminder.startTime')" prop="start_time">
          <el-time-picker
            v-model="form.start_time"
            :placeholder="$t('reminder.startTimePlaceholder')"
            format="HH:mm"
            value-format="HH:mm"
            class="full-width"
          />
        </el-form-item>

        <el-form-item :label="$t('reminder.endTime')" prop="end_time">
          <el-time-picker
            v-model="form.end_time"
            :placeholder="$t('reminder.endTimePlaceholder')"
            format="HH:mm"
            value-format="HH:mm"
            class="full-width"
          />
        </el-form-item>

        <el-form-item :label="$t('reminder.repeatRule')">
          <el-select v-model="form.repeat_rule" class="full-width">
            <el-option :label="$t('reminder.repeatNone')" value="none" />
            <el-option :label="$t('reminder.repeatDaily')" value="daily" />
            <el-option :label="$t('reminder.repeatWeekday')" value="weekday" />
            <el-option :label="$t('reminder.repeatWeekend')" value="weekend" />
          </el-select>
        </el-form-item>

        <el-divider content-position="left">{{ $t('reminder.contentSection') }}</el-divider>

        <el-form-item :label="$t('reminder.content')" prop="content">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="3"
            :placeholder="$t('reminder.contentPlaceholder')"
          />
        </el-form-item>

        <el-form-item :label="$t('reminder.displayStyle')">
          <el-select v-model="form.content_style" class="full-width">
            <el-option :label="$t('reminder.styleBlink')" value="blink" />
            <el-option :label="$t('reminder.styleHighlight')" value="highlight" />
            <el-option :label="$t('reminder.styleBarTop')" value="bar-top" />
            <el-option :label="$t('reminder.styleBarBottom')" value="bar-bottom" />
            <el-option :label="$t('reminder.styleCenter')" value="center" />
          </el-select>
        </el-form-item>

        <el-form-item :label="$t('reminder.fontSize')">
          <el-input-number
            v-model="form.font_size"
            :min="12"
            :max="200"
            controls-position="right"
          />
          <span class="unit-label">px</span>
        </el-form-item>

        <el-form-item :label="$t('reminder.textColor')">
          <el-color-picker v-model="form.text_color" />
          <span class="color-value">{{ form.text_color }}</span>
        </el-form-item>

        <el-form-item :label="$t('reminder.bgColor')">
          <el-color-picker v-model="form.background_color" show-alpha />
          <span class="color-value">{{ form.background_color }}</span>
        </el-form-item>

        <el-form-item :label="$t('reminder.priority')">
          <el-slider
            v-model="form.priority"
            :min="1"
            :max="10"
            show-stops
            :marks="priorityMarks"
            class="priority-slider"
          />
        </el-form-item>

        <el-divider content-position="left">{{ $t('reminder.soundSection') }}</el-divider>

        <el-form-item :label="$t('reminder.soundEnabled')">
          <el-switch v-model="form.sound_enabled" />
        </el-form-item>

        <el-form-item :label="$t('reminder.soundFile')" v-if="form.sound_enabled">
          <div class="url-with-picker">
            <el-input v-model="form.sound_url" :placeholder="$t('reminder.soundUrlPlaceholder')" />
            <el-button :icon="FolderOpened" @click="soundPickerVisible = true">{{ $t('common.selectFromRepo') }}</el-button>
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <div class="drawer-footer">
          <el-button @click="drawerVisible = false">{{ $t('common.cancel') }}</el-button>
          <el-button type="primary" :loading="saving" @click="saveReminder">
            {{ editingReminder ? $t('reminder.saveChanges') : $t('reminder.createReminder') }}
          </el-button>
        </div>
      </template>
    </el-drawer>

    <FilePicker v-model="soundPickerVisible" type="audio" @select="(url) => form.sound_url = url" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, FolderOpened } from '@element-plus/icons-vue'
import FilePicker from '../components/FilePicker.vue'
import { remindersApi, devicesApi } from '../api/index.js'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

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

const rules = computed(() => ({
  name: [{ required: true, message: t('reminder.nameRequired'), trigger: 'blur' }],
  content: [{ required: true, message: t('reminder.contentRequired'), trigger: 'blur' }],
  start_date: [{ required: true, message: t('reminder.dateRequired'), trigger: 'change' }],
  start_time: [{ required: true, message: t('reminder.startTimeRequired'), trigger: 'change' }],
  end_time: [{ required: true, message: t('reminder.endTimeRequired'), trigger: 'change' }]
}))

const priorityMarks = computed(() => ({
  1: t('reminder.priorityLow'),
  5: t('reminder.priorityMid'),
  10: t('reminder.priorityHigh')
}))

function formatDateTime(row, field) {
  const time = row[field]
  if (!time) return '—'
  if (row.repeat === 'none' && row.start_date) {
    return field === 'start_time' ? `${row.start_date} ${time}` : time
  }
  return time
}

function getRepeatLabel(rule) {
  const map = {
    none: t('reminder.repeatNone'),
    daily: t('reminder.repeatDaily'),
    weekday: t('reminder.repeatWeekday'),
    weekend: t('reminder.repeatWeekend')
  }
  return map[rule] || rule || t('reminder.repeatNone')
}

function getRepeatType(rule) {
  return rule && rule !== 'none' ? 'primary' : 'info'
}

function getStyleLabel(style) {
  const map = {
    blink: t('reminder.styleBlink'),
    highlight: t('reminder.styleHighlight'),
    'bar-top': t('reminder.styleBarTop'),
    'bar-bottom': t('reminder.styleBarBottom'),
    center: t('reminder.styleCenter')
  }
  return map[style] || style || t('reminder.styleBarBottom')
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
      ElMessage.success(t('reminder.updatedSuccess'))
    } else {
      await remindersApi.createTimed(data)
      ElMessage.success(t('reminder.createdSuccess'))
    }
    drawerVisible.value = false
    await loadReminders()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || t('common.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(reminder) {
  try {
    await remindersApi.updateTimed(reminder.id, { enabled: reminder.enabled })
    ElMessage.success(reminder.enabled ? t('reminder.enabledSuccess') : t('reminder.disabledSuccess'))
  } catch (error) {
    reminder.enabled = !reminder.enabled // revert
    ElMessage.error(t('common.operationFailed'))
  }
}

async function handleDelete(reminder) {
  try {
    await ElMessageBox.confirm(
      t('reminder.deleteConfirm', { name: reminder.name }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.confirm'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    await remindersApi.deleteTimed(reminder.id)
    ElMessage.success(t('reminder.deletedSuccess'))
    await loadReminders()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || t('common.operationFailed'))
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
