<template>
  <div class="dashboard">
    <div class="page-header">
      <h2 class="page-title">{{ $t('dashboard.title') }}</h2>
      <el-button :icon="Refresh" @click="loadData" :loading="loading">{{ $t('common.refresh') }}</el-button>
    </div>

    <!-- Stats cards -->
    <el-row :gutter="20" class="stats-row">
      <el-col :span="6">
        <el-card class="stat-card stat-online" shadow="hover">
          <div class="stat-content">
            <div class="stat-icon">
              <el-icon size="32" color="#67C23A"><CircleCheck /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ onlineCount }}</div>
              <div class="stat-label">{{ $t('dashboard.onlineDevices') }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card" shadow="hover">
          <div class="stat-content">
            <div class="stat-icon">
              <el-icon size="32" color="#409EFF"><Monitor /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ totalDevices }}</div>
              <div class="stat-label">{{ $t('dashboard.totalDevices') }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card" shadow="hover">
          <div class="stat-content">
            <div class="stat-icon">
              <el-icon size="32" color="#E6A23C"><AlarmClock /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ activeReminders }}</div>
              <div class="stat-label">{{ $t('dashboard.activeReminders') }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card" shadow="hover">
          <div class="stat-content">
            <div class="stat-icon">
              <el-icon size="32" color="#909399"><Timer /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ uptime }}</div>
              <div class="stat-label">{{ $t('dashboard.uptime') }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- Device status list -->
    <el-row :gutter="20" class="content-row">
      <el-col :span="16">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span class="card-title">{{ $t('dashboard.deviceStatus') }}</span>
              <el-tag type="info" size="small">{{ $t('common.realtime') }}</el-tag>
            </div>
          </template>
          <el-table :data="devices" v-loading="loading" size="default" stripe>
            <el-table-column prop="name" :label="$t('dashboard.deviceName')" min-width="140">
              <template #default="{ row }">
                <span class="device-name">{{ row.name }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="group_name" :label="$t('dashboard.group')" width="120">
              <template #default="{ row }">
                <el-tag v-if="row.group_name" size="small" type="info">{{ row.group_name }}</el-tag>
                <span v-else class="text-muted">—</span>
              </template>
            </el-table-column>
            <el-table-column :label="$t('common.status')" width="100">
              <template #default="{ row }">
                <el-tag :type="isOnline(row) ? 'success' : 'danger'" size="small">
                  {{ isOnline(row) ? $t('common.online') : $t('common.offline') }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="ip_address" :label="$t('dashboard.ipAddress')" width="140">
              <template #default="{ row }">
                <span class="text-mono">{{ row.ip_address || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column :label="$t('dashboard.lastSeen')" min-width="160">
              <template #default="{ row }">
                <span class="text-muted">{{ formatTime(row.last_seen) }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card shadow="hover" class="system-info-card">
          <template #header>
            <div class="card-header">
              <span class="card-title">{{ $t('dashboard.systemInfo') }}</span>
            </div>
          </template>
          <div class="system-info" v-loading="systemLoading">
            <div class="info-item">
              <span class="info-label">{{ $t('dashboard.nodeVersion') }}</span>
              <span class="info-value">{{ systemStatus.node_version || '—' }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">{{ $t('dashboard.platform') }}</span>
              <span class="info-value">{{ systemStatus.platform || '—' }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">{{ $t('dashboard.connectedDevices') }}</span>
              <span class="info-value">{{ systemStatus.connected_device_count ?? '—' }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">{{ $t('dashboard.memoryUsage') }}</span>
              <span class="info-value">{{ formatMemory(systemStatus.memory) }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">{{ $t('dashboard.systemVersion') }}</span>
              <span class="info-value">1.0.0</span>
            </div>
            <el-divider />
            <div class="info-item">
              <span class="info-label">{{ $t('dashboard.emergencyAlert') }}</span>
              <el-tag :type="activeEmergency ? 'danger' : 'success'" size="small">
                {{ activeEmergency ? $t('dashboard.activeAlert') : $t('dashboard.noAlert') }}
              </el-tag>
            </div>
          </div>
        </el-card>

        <el-card shadow="hover" class="quick-actions-card" style="margin-top: 20px;">
          <template #header>
            <span class="card-title">{{ $t('dashboard.quickActions') }}</span>
          </template>
          <div class="quick-actions">
            <el-button type="primary" plain class="action-btn" @click="$router.push('/devices')">
              <el-icon><Monitor /></el-icon> {{ $t('dashboard.manageDevices') }}
            </el-button>
            <el-button type="warning" plain class="action-btn" @click="$router.push('/emergency')">
              <el-icon><Warning /></el-icon> {{ $t('dashboard.emergencyNotice') }}
            </el-button>
            <el-button type="success" plain class="action-btn" @click="$router.push('/scenes')">
              <el-icon><Picture /></el-icon> {{ $t('dashboard.manageScenes') }}
            </el-button>
            <el-button type="info" plain class="action-btn" @click="$router.push('/reminders')">
              <el-icon><AlarmClock /></el-icon> {{ $t('dashboard.timedReminders') }}
            </el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { devicesApi, systemApi, remindersApi } from '../api/index.js'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()

const loading = ref(false)
const systemLoading = ref(false)
const devices = ref([])
const systemStatus = ref({})
const activeEmergency = ref(false)
const activeReminders = ref(0)

let refreshTimer = null

const onlineCount = computed(() => devices.value.filter(d => isOnline(d)).length)
const totalDevices = computed(() => devices.value.length)

const uptime = computed(() => {
  const seconds = systemStatus.value.uptime || 0
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return locale.value === 'en' ? `${days}d ${hours}h` : `${days}天${hours}小时`
  if (hours > 0) return locale.value === 'en' ? `${hours}h ${minutes}m` : `${hours}小时${minutes}分钟`
  return locale.value === 'en' ? `${minutes}m` : `${minutes}分钟`
})

function isOnline(device) {
  if (device.connected) return true
  if (!device.last_seen) return false
  const lastSeen = parseUtcTime(device.last_seen).getTime()
  return Date.now() - lastSeen < 2 * 60 * 1000
}

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
  return date.toLocaleDateString(locale.value === 'en' ? 'en-US' : 'zh-CN')
}

function formatMemory(mem) {
  if (!mem) return '—'
  const mb = Math.round(mem.heapUsed / 1024 / 1024)
  return `${mb} MB`
}

async function loadData() {
  loading.value = true
  systemLoading.value = true
  try {
    const [devRes, statusRes] = await Promise.allSettled([
      devicesApi.list(),
      systemApi.getStatus()
    ])

    if (devRes.status === 'fulfilled') {
      devices.value = devRes.value.data.data || []
    }
    if (statusRes.status === 'fulfilled') {
      systemStatus.value = statusRes.value.data.data || {}
    }

    try {
      const emergRes = await remindersApi.getActiveEmergency()
      const alerts = emergRes.data.data || []
      activeEmergency.value = alerts.length > 0
    } catch {
      activeEmergency.value = false
    }

    try {
      const remRes = await remindersApi.listTimed()
      const reminders = remRes.data.data || []
      activeReminders.value = reminders.filter(r => r.enabled).length
    } catch {
      activeReminders.value = 0
    }
  } finally {
    loading.value = false
    systemLoading.value = false
  }
}

onMounted(() => {
  loadData()
  refreshTimer = setInterval(loadData, 30000)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
})
</script>

<style scoped>
.dashboard {
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

.stats-row {
  margin-bottom: 20px;
}

.stat-card {
  height: 100px;
}

.stat-content {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 60px;
}

.stat-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background-color: #f0f7ff;
  flex-shrink: 0;
}

.stat-info {
  flex: 1;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  color: #303133;
  line-height: 1;
}

.stat-label {
  font-size: 13px;
  color: #909399;
  margin-top: 6px;
}

.content-row {
  margin-top: 4px;
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

.device-name {
  font-weight: 500;
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

.system-info {
  min-height: 100px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #f2f6fc;
}

.info-item:last-child {
  border-bottom: none;
}

.info-label {
  color: #909399;
  font-size: 13px;
}

.info-value {
  color: #303133;
  font-size: 13px;
  font-weight: 500;
}

.quick-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.action-btn {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: auto;
  padding: 12px 8px;
}
</style>
