<template>
  <div class="devices-page">
    <div class="page-header">
      <h2 class="page-title">设备管理</h2>
      <el-button type="primary" :icon="Plus" @click="openAddDialog">添加设备</el-button>
    </div>

    <el-card shadow="never">
      <el-table
        :data="devicesStore.devices"
        v-loading="devicesStore.loading"
        stripe
        size="default"
        row-key="id"
      >
        <el-table-column prop="name" label="设备名称" min-width="160">
          <template #default="{ row }">
            <span class="device-name device-name-link" @click="openDeviceClient(row)">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="group_name" label="分组" width="130">
          <template #default="{ row }">
            <el-tag v-if="row.group_name" size="small" type="info">{{ row.group_name }}</el-tag>
            <span v-else class="text-muted">未分组</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="isOnline(row) ? 'success' : 'danger'" size="small">
              {{ isOnline(row) ? '在线' : '离线' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最后活跃" width="160">
          <template #default="{ row }">
            <span class="text-muted">{{ formatTime(row.last_seen) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="ip_address" label="IP地址" width="140">
          <template #default="{ row }">
            <span class="text-mono">{{ row.ip_address || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="Edit" @click="openEditDialog(row)">编辑</el-button>
            <el-button size="small" type="success" :icon="Connection" @click="openSceneConfig(row)">
              画面
            </el-button>
            <el-button size="small" type="warning" :icon="Refresh" @click="forceRefresh(row)">
              刷新
            </el-button>
            <el-button
              size="small"
              type="danger"
              :icon="Delete"
              @click="handleDelete(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- Add/Edit Device Dialog -->
    <el-dialog
      v-model="deviceDialogVisible"
      :title="editingDevice ? '编辑设备' : '添加设备'"
      width="500px"
      @closed="resetDeviceForm"
    >
      <el-form
        ref="deviceFormRef"
        :model="deviceForm"
        :rules="deviceRules"
        label-width="90px"
      >
        <el-form-item label="设备名称" prop="name">
          <el-input v-model="deviceForm.name" placeholder="请输入设备名称" />
        </el-form-item>
        <el-form-item label="设备分组" prop="group_name">
          <el-input v-model="deviceForm.group_name" placeholder="请输入分组名称（可选）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deviceDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveDevice">
          {{ editingDevice ? '保存修改' : '添加设备' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- Created Device Info Dialog -->
    <el-dialog
      v-model="createdDeviceDialogVisible"
      title="设备创建成功"
      width="560px"
    >
      <el-alert type="success" :closable="false" show-icon class="mb-4">
        <template #title>设备已创建，请保存以下信息用于客户端连接</template>
      </el-alert>
      <div class="device-url-section" v-if="createdDevice">
        <div class="info-row">
          <span class="info-label">设备ID：</span>
          <el-tag>{{ createdDevice.id }}</el-tag>
        </div>
        <div class="info-row">
          <span class="info-label">设备密钥：</span>
          <el-tag type="warning">{{ createdDevice.device_key }}</el-tag>
        </div>
        <el-divider />
        <div class="info-row">
          <span class="info-label">客户端URL：</span>
        </div>
        <el-input
          v-model="createdDeviceUrl"
          readonly
          class="url-input"
        >
          <template #append>
            <el-button :icon="CopyDocument" @click="copyUrl">复制</el-button>
          </template>
        </el-input>
        <p class="url-hint">将此URL配置到客户端设备的浏览器中</p>
      </div>
      <template #footer>
        <el-button type="primary" @click="createdDeviceDialogVisible = false">我已保存，关闭</el-button>
      </template>
    </el-dialog>

    <!-- Scene Config Dialog -->
    <el-dialog
      v-model="sceneConfigVisible"
      title="画面配置"
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
import { Plus, Edit, Delete, Refresh, Connection, CopyDocument } from '@element-plus/icons-vue'
import { useDevicesStore } from '../stores/devices.js'
import { devicesApi } from '../api/index.js'
import DeviceSceneConfig from '../components/DeviceSceneConfig.vue'

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

const deviceRules = {
  name: [{ required: true, message: '请输入设备名称', trigger: 'blur' }]
}

const createdDeviceUrl = computed(() => {
  if (!createdDevice.value) return ''
  const base = window.location.origin
  return `${base}/client?deviceId=${createdDevice.value.id}&deviceKey=${createdDevice.value.device_key}`
})

function isOnline(device) {
  if (device.connected) return true
  if (!device.last_seen) return false
  const lastSeen = new Date(device.last_seen).getTime()
  return Date.now() - lastSeen < 2 * 60 * 1000
}

function formatTime(time) {
  if (!time) return '从未'
  const date = new Date(time)
  const now = new Date()
  const diff = now - date
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  return date.toLocaleString('zh-CN')
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
      ElMessage.success('设备已更新')
      deviceDialogVisible.value = false
    } else {
      const result = await devicesStore.createDevice(data)
      deviceDialogVisible.value = false
      createdDevice.value = result
      createdDeviceDialogVisible.value = true
    }
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '操作失败')
  } finally {
    saving.value = false
  }
}

async function handleDelete(device) {
  try {
    await ElMessageBox.confirm(
      `确定要删除设备 "${device.name}" 吗？此操作不可恢复。`,
      '确认删除',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    )
    await devicesStore.deleteDevice(device.id)
    ElMessage.success('设备已删除')
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '删除失败')
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
    ElMessage.success(`已向设备 "${device.name}" 发送刷新指令`)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '发送失败')
  }
}

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(createdDeviceUrl.value)
    ElMessage.success('已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败，请手动复制')
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
</style>
