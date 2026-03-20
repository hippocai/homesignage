<template>
  <div class="emergency-page">
    <div class="page-header">
      <h2 class="page-title">紧急提示</h2>
    </div>

    <!-- Trigger button -->
    <el-card shadow="never" class="trigger-card">
      <div class="trigger-section">
        <div class="trigger-desc">
          <h3>触发紧急警报</h3>
          <p>紧急提示会立即推送到目标设备，覆盖所有正在显示的内容。请谨慎使用。</p>
        </div>
        <el-button
          type="danger"
          size="large"
          class="trigger-btn"
          :icon="Warning"
          @click="openTriggerDialog"
        >
          触发紧急提示
        </el-button>
      </div>
    </el-card>

    <!-- Active alerts -->
    <el-card shadow="never" class="active-card">
      <template #header>
        <div class="card-header">
          <span class="card-title">当前活跃警报</span>
          <el-button size="small" :icon="Refresh" @click="loadActiveAlerts" :loading="activeLoading">
            刷新
          </el-button>
        </div>
      </template>

      <div v-loading="activeLoading">
        <div v-if="activeAlerts.length > 0" class="active-alerts">
          <div
            v-for="alert in activeAlerts"
            :key="alert.id"
            class="alert-item"
            :style="{ borderLeftColor: alert.background_color || '#FF0000' }"
          >
            <div class="alert-content">
              <div class="alert-text">{{ alert.content?.text || alert.content }}</div>
              <div class="alert-meta">
                <el-tag size="small" type="danger">紧急</el-tag>
                <span class="alert-time">{{ formatTime(alert.triggered_at) }}</span>
                <span>目标：{{ formatTargets(alert.device_ids) }}</span>
              </div>
            </div>
            <el-button
              type="warning"
              size="small"
              @click="clearAlert(alert)"
              :loading="clearingId === alert.id"
            >
              解除警报
            </el-button>
          </div>
        </div>
        <el-empty v-else description="当前无活跃警报" />
      </div>
    </el-card>

    <!-- History -->
    <el-card shadow="never" class="history-card">
      <template #header>
        <span class="card-title">历史记录（最近20条）</span>
      </template>

      <el-table :data="history" v-loading="historyLoading" stripe size="default">
        <el-table-column label="警报内容" min-width="200">
          <template #default="{ row }">
            <span class="alert-text-cell">{{ row.content?.text || row.content }}</span>
          </template>
        </el-table-column>
        <el-table-column label="目标设备" width="150">
          <template #default="{ row }">
            {{ formatTargets(row.device_ids) }}
          </template>
        </el-table-column>
        <el-table-column label="触发时间" width="170">
          <template #default="{ row }">
            {{ formatDateTime(row.created_at || row.triggered_at) }}
          </template>
        </el-table-column>
        <el-table-column label="解除时间" width="170">
          <template #default="{ row }">
            <span v-if="row.cleared_at">{{ formatDateTime(row.cleared_at) }}</span>
            <el-tag v-else size="small" type="danger">活跃中</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.cleared_at ? 'info' : 'danger'" size="small">
              {{ row.cleared_at ? '已解除' : '活跃' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Trigger Dialog -->
    <el-dialog
      v-model="triggerDialogVisible"
      title="配置紧急提示"
      width="560px"
    >
      <el-form
        ref="triggerFormRef"
        :model="triggerForm"
        :rules="triggerRules"
        label-width="100px"
      >
        <el-form-item label="目标设备">
          <el-select
            v-model="triggerForm.target_devices"
            multiple
            placeholder="留空表示全部设备"
            class="full-width"
          >
            <el-option label="全部设备" value="all" />
            <el-option
              v-for="device in devices"
              :key="device.id"
              :label="device.name"
              :value="String(device.id)"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="警报文字" prop="text">
          <el-input
            v-model="triggerForm.text"
            type="textarea"
            :rows="3"
            placeholder="输入紧急警报内容"
          />
        </el-form-item>

        <el-form-item label="背景颜色">
          <el-color-picker v-model="triggerForm.background_color" />
          <span class="color-hint">{{ triggerForm.background_color }}</span>
        </el-form-item>

        <el-form-item label="文字颜色">
          <el-color-picker v-model="triggerForm.text_color" />
          <span class="color-hint">{{ triggerForm.text_color }}</span>
        </el-form-item>

        <el-form-item label="闪烁效果">
          <el-switch v-model="triggerForm.blink" />
        </el-form-item>

        <el-form-item label="声音循环">
          <el-switch v-model="triggerForm.sound_loop" />
        </el-form-item>

        <el-form-item label="声音文件" v-if="triggerForm.sound_loop">
          <div class="url-with-picker">
            <el-input v-model="triggerForm.sound_url" placeholder="声音文件URL" />
            <el-button :icon="FolderOpened" @click="soundPickerVisible = true">从仓库选择</el-button>
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="triggerDialogVisible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="triggering"
          :icon="Warning"
          @click="triggerEmergency"
        >
          立即触发
        </el-button>
      </template>
    </el-dialog>

    <FilePicker v-model="soundPickerVisible" type="audio" @select="(url) => triggerForm.sound_url = url" />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Warning, Refresh, FolderOpened } from '@element-plus/icons-vue'
import FilePicker from '../components/FilePicker.vue'
import { remindersApi, devicesApi } from '../api/index.js'

const activeLoading = ref(false)
const historyLoading = ref(false)
const triggering = ref(false)
const triggerDialogVisible = ref(false)
const clearingId = ref(null)
const activeAlerts = ref([])
const history = ref([])
const devices = ref([])
const triggerFormRef = ref(null)
const soundPickerVisible = ref(false)

const triggerForm = reactive({
  target_devices: [],
  text: '',
  background_color: '#FF0000',
  text_color: '#FFFFFF',
  blink: true,
  sound_loop: false,
  sound_url: ''
})

const triggerRules = {
  text: [{ required: true, message: '请输入警报文字', trigger: 'blur' }]
}

function formatTime(time) {
  if (!time) return '—'
  const date = new Date(time)
  const now = new Date()
  const diff = now - date
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  return date.toLocaleString('zh-CN')
}

function formatDateTime(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('zh-CN')
}

function formatTargets(targets) {
  if (!targets || targets === 'all' || (Array.isArray(targets) && targets.includes('all'))) {
    return '全部设备'
  }
  if (Array.isArray(targets)) {
    return targets.length > 0 ? `${targets.length}台设备` : '全部设备'
  }
  return String(targets)
}

function openTriggerDialog() {
  triggerForm.target_devices = []
  triggerForm.text = ''
  triggerForm.background_color = '#FF0000'
  triggerForm.text_color = '#FFFFFF'
  triggerForm.blink = true
  triggerForm.sound_loop = false
  triggerForm.sound_url = ''
  triggerDialogVisible.value = true
}

async function triggerEmergency() {
  if (!triggerFormRef.value) return
  const valid = await triggerFormRef.value.validate().catch(() => false)
  if (!valid) return

  triggering.value = true
  try {
    const deviceIds = (triggerForm.target_devices.length === 0 || triggerForm.target_devices.includes('all'))
      ? ['all']
      : triggerForm.target_devices

    const data = {
      device_ids: deviceIds,
      content: {
        text: triggerForm.text,
        backgroundColor: triggerForm.background_color,
        textColor: triggerForm.text_color,
        blink: triggerForm.blink
      },
      sound: {
        file: triggerForm.sound_url || 'alarm.mp3',
        volume: 0.8,
        loop: triggerForm.sound_loop
      }
    }

    await remindersApi.triggerEmergency(data)
    ElMessage.success('紧急警报已触发')
    triggerDialogVisible.value = false
    await Promise.all([loadActiveAlerts(), loadHistory()])
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '触发失败')
  } finally {
    triggering.value = false
  }
}

async function clearAlert(alert) {
  try {
    await ElMessageBox.confirm('确定要解除此紧急警报吗？', '确认解除', {
      confirmButtonText: '确定解除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    clearingId.value = alert.id
    await remindersApi.clearEmergency(alert.id)
    ElMessage.success('警报已解除')
    await Promise.all([loadActiveAlerts(), loadHistory()])
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '解除失败')
    }
  } finally {
    clearingId.value = null
  }
}

async function loadActiveAlerts() {
  activeLoading.value = true
  try {
    const res = await remindersApi.getActiveEmergency()
    activeAlerts.value = res.data.data || []
  } catch {
    activeAlerts.value = []
  } finally {
    activeLoading.value = false
  }
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const res = await remindersApi.listEmergency()
    history.value = (res.data.data || []).slice(0, 20)
  } catch {
    history.value = []
  } finally {
    historyLoading.value = false
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
  loadActiveAlerts()
  loadHistory()
  loadDevices()
})
</script>

<style scoped>
.emergency-page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.trigger-card {
  border: 2px solid #FEE2E2;
  background: linear-gradient(135deg, #fff5f5 0%, #ffffff 100%);
}

.trigger-section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 8px 0;
}

.trigger-desc h3 {
  font-size: 16px;
  font-weight: 600;
  color: #F56C6C;
  margin-bottom: 6px;
}

.trigger-desc p {
  font-size: 13px;
  color: #909399;
}

.trigger-btn {
  min-width: 160px;
  height: 48px;
  font-size: 16px;
  letter-spacing: 1px;
  flex-shrink: 0;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.active-alerts {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.alert-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: #FFF5F5;
  border-radius: 8px;
  border-left: 4px solid #FF0000;
  gap: 16px;
}

.alert-content {
  flex: 1;
}

.alert-text {
  font-size: 15px;
  font-weight: 500;
  color: #303133;
  margin-bottom: 6px;
}

.alert-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.alert-time {
  font-size: 12px;
  color: #909399;
}

.alert-text-cell {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.full-width {
  width: 100%;
}

.color-hint {
  margin-left: 10px;
  font-size: 13px;
  color: #606266;
}

.url-with-picker {
  display: flex;
  gap: 8px;
  width: 100%;
}
</style>
