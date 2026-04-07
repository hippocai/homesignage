<template>
  <div class="devices-page">
    <div class="page-header">
      <h2 class="page-title">{{ $t('device.title') }}</h2>
      <el-button type="primary" :icon="Plus" @click="openAddDialog">{{ $t('device.addDevice') }}</el-button>
    </div>

    <el-card shadow="never">
      <el-table
        :data="devicesStore.devices"
        v-loading="devicesStore.loading"
        stripe
        size="default"
        row-key="id"
      >
        <el-table-column prop="name" :label="$t('device.deviceName')" min-width="160">
          <template #default="{ row }">
            <span class="device-name device-name-link" @click="openDeviceClient(row)">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="group_name" :label="$t('device.deviceGroup')" width="130">
          <template #default="{ row }">
            <el-tag v-if="row.group_name" size="small" type="info">{{ row.group_name }}</el-tag>
            <span v-else class="text-muted">{{ $t('device.noGroup') }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.status')" width="90">
          <template #default="{ row }">
            <el-tag :type="isOnline(row) ? 'success' : 'danger'" size="small">
              {{ isOnline(row) ? $t('common.online') : $t('common.offline') }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('device.currentScene')" width="190">
          <template #default="{ row }">
            <div v-if="row.currentScene" class="current-scene-cell">
              <img
                v-if="row.currentScene.previewUrl"
                :src="row.currentScene.previewUrl"
                class="scene-thumbnail"
                :alt="row.currentScene.name"
              />
              <div v-else class="scene-thumbnail scene-thumbnail--placeholder">
                <el-icon><Picture /></el-icon>
              </div>
              <span class="scene-name-label">{{ row.currentScene.name }}</span>
            </div>
            <span v-else class="text-muted">{{ $t('device.noScene') }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('dashboard.lastSeen')" width="160">
          <template #default="{ row }">
            <span class="text-muted">{{ formatTime(row.last_seen) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="ip_address" :label="$t('dashboard.ipAddress')" width="140">
          <template #default="{ row }">
            <span class="text-mono">{{ row.ip_address || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="260" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="Edit" @click="openEditDialog(row)">{{ $t('common.edit') }}</el-button>
            <el-button size="small" type="success" :icon="Connection" @click="openSceneConfig(row)">
              {{ $t('device.sceneBtn') }}
            </el-button>
            <el-button size="small" type="warning" :icon="Refresh" @click="forceRefresh(row)">
              {{ $t('common.refresh') }}
            </el-button>
            <el-button
              size="small"
              type="danger"
              :icon="Delete"
              @click="handleDelete(row)"
            >
              {{ $t('common.delete') }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Add/Edit Device Dialog -->
    <el-dialog
      v-model="deviceDialogVisible"
      :title="editingDevice ? $t('device.editDevice') : $t('device.addDevice')"
      width="500px"
      @closed="resetDeviceForm"
    >
      <el-form
        ref="deviceFormRef"
        :model="deviceForm"
        :rules="deviceRules"
        label-width="90px"
      >
        <el-form-item :label="$t('device.deviceName')" prop="name">
          <el-input v-model="deviceForm.name" :placeholder="$t('device.deviceNamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="$t('device.deviceGroup')" prop="group_name">
          <el-input v-model="deviceForm.group_name" :placeholder="$t('device.deviceGroupPlaceholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deviceDialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="saveDevice">
          {{ editingDevice ? $t('device.saveChanges') : $t('device.addDevice') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- Created Device Info Dialog -->
    <el-dialog
      v-model="createdDeviceDialogVisible"
      :title="$t('device.createdSuccess')"
      width="560px"
    >
      <el-alert type="success" :closable="false" show-icon class="mb-4">
        <template #title>{{ $t('device.createdHint') }}</template>
      </el-alert>
      <div class="device-url-section" v-if="createdDevice">
        <div class="info-row">
          <span class="info-label">{{ $t('device.deviceId') }}</span>
          <el-tag>{{ createdDevice.id }}</el-tag>
        </div>
        <div class="info-row">
          <span class="info-label">{{ $t('device.deviceKey') }}</span>
          <el-tag type="warning">{{ createdDevice.device_key }}</el-tag>
        </div>
        <el-divider />
        <div class="info-row">
          <span class="info-label">{{ $t('device.clientUrl') }}</span>
        </div>
        <el-input
          v-model="createdDeviceUrl"
          readonly
          class="url-input"
        >
          <template #append>
            <el-button :icon="CopyDocument" @click="copyUrl">{{ $t('device.copyUrl') }}</el-button>
          </template>
        </el-input>
        <p class="url-hint">{{ $t('device.clientUrlHint') }}</p>
      </div>
      <template #footer>
        <el-button type="primary" @click="createdDeviceDialogVisible = false">{{ $t('device.savedClose') }}</el-button>
      </template>
    </el-dialog>

    <!-- Scene Config Dialog -->
    <el-dialog
      v-model="sceneConfigVisible"
      :title="$t('device.sceneConfig')"
      width="700px"
      top="5vh"
      @closed="sceneConfigDevice = null"
    >
      <DeviceSceneConfig
        v-if="sceneConfigDevice"
        :device-id="sceneConfigDevice.id"
        @saved="sceneConfigVisible = false"
      />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, Refresh, Connection, CopyDocument, Picture } from '@element-plus/icons-vue'
import { useDevicesStore } from '../stores/devices.js'
import { devicesApi } from '../api/index.js'
import DeviceSceneConfig from '../components/DeviceSceneConfig.vue'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()
const devicesStore = useDevicesStore()

const deviceDialogVisible = ref(false)
const createdDeviceDialogVisible = ref(false)
const sceneConfigVisible = ref(false)
const saving = ref(false)
const editingDevice = ref(null)
const createdDevice = ref(null)
const sceneConfigDevice = ref(null)
const deviceFormRef = ref(null)

const deviceForm = reactive({
  name: '',
  group_name: ''
})

const deviceRules = computed(() => ({
  name: [{ required: true, message: t('device.deviceNameRequired'), trigger: 'blur' }]
}))

const createdDeviceUrl = computed(() => {
  if (!createdDevice.value) return ''
  const base = window.location.origin
  return `${base}/client?deviceId=${createdDevice.value.id}&deviceKey=${createdDevice.value.device_key}`
})

function isOnline(device) {
  if (device.connected) return true
  if (!device.last_seen) return false
  const lastSeen = parseUtcTime(device.last_seen).getTime()
  return Date.now() - lastSeen < 2 * 60 * 1000
}

// SQLite CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" (no timezone).
// JS treats that as local time, causing an 8-hour offset for UTC+8.
// Normalize to ISO 8601 UTC before parsing.
function parseUtcTime(time) {
  if (!time) return null
  const s = time.replace(' ', 'T')
  return new Date(/Z|[+-]\d{2}:\d{2}$/.test(s) ? s : s + 'Z')
}

function formatTime(time) {
  if (!time) return t('common.never')
  const date = parseUtcTime(time)
  const now = new Date()
  const diff = now - date
  if (diff < 60000) return t('common.justNow')
  if (diff < 3600000) return locale.value === 'en' ? `${Math.floor(diff / 60000)}m ago` : `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return locale.value === 'en' ? `${Math.floor(diff / 3600000)}h ago` : `${Math.floor(diff / 3600000)}小时前`
  return date.toLocaleString(locale.value === 'en' ? 'en-US' : 'zh-CN')
}

function openAddDialog() {
  editingDevice.value = null
  deviceDialogVisible.value = true
}

function openEditDialog(device) {
  editingDevice.value = device
  deviceForm.name = device.name
  deviceForm.group_name = device.group_name || ''
  deviceDialogVisible.value = true
}

function openSceneConfig(device) {
  sceneConfigDevice.value = device
  sceneConfigVisible.value = true
}

function resetDeviceForm() {
  deviceForm.name = ''
  deviceForm.group_name = ''
  editingDevice.value = null
  if (deviceFormRef.value) deviceFormRef.value.clearValidate()
}

async function saveDevice() {
  if (!deviceFormRef.value) return
  const valid = await deviceFormRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const data = {
      name: deviceForm.name,
      group_name: deviceForm.group_name || undefined
    }

    if (editingDevice.value) {
      await devicesStore.updateDevice(editingDevice.value.id, data)
      ElMessage.success(t('device.updatedSuccess'))
      deviceDialogVisible.value = false
    } else {
      const result = await devicesStore.createDevice(data)
      deviceDialogVisible.value = false
      createdDevice.value = result
      createdDeviceDialogVisible.value = true
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.message || t('common.operationFailed'))
  } finally {
    saving.value = false
  }
}

async function handleDelete(device) {
  try {
    await ElMessageBox.confirm(
      t('device.deleteConfirm', { name: device.name }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('device.confirmDeleteBtn'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    )
    await devicesStore.deleteDevice(device.id)
    ElMessage.success(t('device.deletedSuccess'))
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || t('device.deleteFailed'))
    }
  }
}

function openDeviceClient(device) {
  const url = `${window.location.origin}/client?deviceId=${device.id}&deviceKey=${device.device_key}`
  window.open(url, '_blank')
}

async function forceRefresh(device) {
  try {
    await devicesApi.forceRefresh(device.id)
    ElMessage.success(t('device.refreshSent', { name: device.name }))
  } catch (error) {
    ElMessage.error(error.response?.data?.message || t('device.sendFailed'))
  }
}

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(createdDeviceUrl.value)
    ElMessage.success(t('device.copySuccess'))
  } catch {
    ElMessage.error(t('device.copyFailed'))
  }
}

onMounted(() => {
  devicesStore.fetchDevices()
})
</script>

<style scoped>
.devices-page {
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

.device-name {
  font-weight: 500;
  color: #303133;
}

.device-name-link {
  cursor: pointer;
  color: #409EFF;
}
.device-name-link:hover {
  text-decoration: underline;
}

.text-muted {
  color: #909399;
  font-size: 13px;
}

.text-mono {
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: #606266;
}

.device-url-section {
  padding: 4px 0;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.info-label {
  color: #606266;
  font-size: 14px;
  min-width: 80px;
  flex-shrink: 0;
}

.url-input {
  margin-bottom: 8px;
}

.url-hint {
  color: #909399;
  font-size: 12px;
}

.mb-4 {
  margin-bottom: 16px;
}

.current-scene-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.scene-thumbnail {
  width: 72px;
  height: 40px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid #e4e7ed;
  flex-shrink: 0;
}

.scene-thumbnail--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
  color: #c0c4cc;
  font-size: 16px;
}

.scene-name-label {
  font-size: 12px;
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 90px;
}
</style>
