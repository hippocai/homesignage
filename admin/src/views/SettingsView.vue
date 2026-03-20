<template>
  <div class="settings-page">
    <h2 class="page-title">{{ $t('settings.title') }}</h2>

    <el-row :gutter="24">
      <!-- Change password -->
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <el-icon><Lock /></el-icon>
              <span>{{ $t('settings.changePassword') }}</span>
            </div>
          </template>
          <el-form
            ref="passwordFormRef"
            :model="passwordForm"
            :rules="passwordRules"
            label-width="110px"
          >
            <el-form-item :label="$t('settings.currentPassword')" prop="currentPassword">
              <el-input
                v-model="passwordForm.currentPassword"
                type="password"
                show-password
                :placeholder="$t('settings.currentPasswordPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="$t('settings.newPassword')" prop="newPassword">
              <el-input
                v-model="passwordForm.newPassword"
                type="password"
                show-password
                :placeholder="$t('settings.newPasswordPlaceholder')"
              />
            </el-form-item>
            <el-form-item :label="$t('settings.confirmPassword')" prop="confirmPassword">
              <el-input
                v-model="passwordForm.confirmPassword"
                type="password"
                show-password
                :placeholder="$t('settings.confirmPasswordPlaceholder')"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="changingPassword" @click="changePassword">
                {{ $t('settings.changePasswordBtn') }}
              </el-button>
              <el-button @click="resetPasswordForm">{{ $t('settings.reset') }}</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <!-- System info -->
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <el-icon><InfoFilled /></el-icon>
              <span>{{ $t('settings.systemInfo') }}</span>
            </div>
          </template>
          <div class="sys-info" v-loading="sysLoading">
            <div class="info-row">
              <span class="info-label">{{ $t('settings.nodeVersion') }}</span>
              <el-tag type="success" size="small">{{ systemInfo.node_version || '—' }}</el-tag>
            </div>
            <div class="info-row">
              <span class="info-label">{{ $t('settings.platform') }}</span>
              <span class="info-value">{{ systemInfo.platform || '—' }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ $t('settings.uptime') }}</span>
              <span class="info-value">{{ formatUptime(systemInfo.uptime) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ $t('settings.memoryUsage') }}</span>
              <span class="info-value">{{ formatMemory(systemInfo.memory) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ $t('settings.onlineDevices') }}</span>
              <span class="info-value">{{ $t('settings.onlineDevicesValue', { connected: systemInfo.connected_device_count ?? '—', total: systemInfo.device_count ?? '—' }) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">{{ $t('settings.pid') }}</span>
              <span class="info-value info-mono">{{ systemInfo.pid || '—' }}</span>
            </div>
            <el-divider />
            <div class="refresh-row">
              <el-button size="small" :icon="Refresh" @click="loadSystemInfo">{{ $t('settings.refreshInfo') }}</el-button>
            </div>
          </div>
        </el-card>

        <el-card shadow="never" style="margin-top: 20px;">
          <template #header>
            <div class="card-header">
              <el-icon><Setting /></el-icon>
              <span>{{ $t('settings.aboutSystem') }}</span>
            </div>
          </template>
          <div class="about-section">
            <div class="about-logo">
              <el-icon size="48" color="#409EFF"><Monitor /></el-icon>
              <h3>HomeSignage</h3>
              <p>{{ $t('settings.subtitle') }}</p>
            </div>
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item :label="$t('settings.systemVersion')">
                <el-tag size="small">v1.0.0</el-tag>
              </el-descriptions-item>
              <el-descriptions-item :label="$t('settings.license')">MIT License</el-descriptions-item>
            </el-descriptions>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Lock, InfoFilled, Refresh } from '@element-plus/icons-vue'
import { systemApi, authApi } from '../api/index.js'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()

const changingPassword = ref(false)
const sysLoading = ref(false)
const systemInfo = ref({})
const passwordFormRef = ref(null)

const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const validateConfirm = (rule, value, callback) => {
  if (value !== passwordForm.newPassword) {
    callback(new Error(t('settings.passwordMismatch')))
  } else {
    callback()
  }
}

const passwordRules = computed(() => ({
  currentPassword: [
    { required: true, message: t('settings.currentPasswordRequired'), trigger: 'blur' }
  ],
  newPassword: [
    { required: true, message: t('settings.newPasswordRequired'), trigger: 'blur' },
    { min: 6, message: t('settings.newPasswordMinLength'), trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: t('settings.confirmPasswordRequired'), trigger: 'blur' },
    { validator: validateConfirm, trigger: 'blur' }
  ]
}))

function resetPasswordForm() {
  passwordForm.currentPassword = ''
  passwordForm.newPassword = ''
  passwordForm.confirmPassword = ''
  if (passwordFormRef.value) passwordFormRef.value.clearValidate()
}

function formatUptime(seconds) {
  if (!seconds) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (locale.value === 'en') {
    if (days > 0) parts.push(`${days}d`)
    if (hours > 0) parts.push(`${hours}h`)
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`)
  } else {
    if (days > 0) parts.push(`${days}天`)
    if (hours > 0) parts.push(`${hours}小时`)
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}分钟`)
  }
  return parts.join('')
}

function formatMemory(mem) {
  if (!mem) return '—'
  const heapMB = Math.round((mem.heapUsed || 0) / 1024 / 1024)
  const totalMB = Math.round((mem.heapTotal || 0) / 1024 / 1024)
  return `${heapMB} MB / ${totalMB} MB`
}

async function changePassword() {
  if (!passwordFormRef.value) return
  const valid = await passwordFormRef.value.validate().catch(() => false)
  if (!valid) return

  changingPassword.value = true
  try {
    await authApi.changePassword(passwordForm.currentPassword, passwordForm.newPassword)
    ElMessage.success(t('settings.changedSuccess'))
    resetPasswordForm()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || t('settings.changeFailed'))
  } finally {
    changingPassword.value = false
  }
}

async function loadSystemInfo() {
  sysLoading.value = true
  try {
    const res = await systemApi.getStatus()
    systemInfo.value = res.data.data || {}
  } catch {
    systemInfo.value = {}
  } finally {
    sysLoading.value = false
  }
}

onMounted(loadSystemInfo)
</script>

<style scoped>
.settings-page {
  min-height: 100%;
}

.page-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 24px;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.sys-info {
  min-height: 80px;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #f2f6fc;
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  font-size: 13px;
  color: #909399;
}

.info-value {
  font-size: 13px;
  color: #303133;
  font-weight: 500;
}

.info-mono {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.refresh-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.about-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.about-logo {
  text-align: center;
  padding: 12px 0;
}

.about-logo h3 {
  font-size: 20px;
  font-weight: 700;
  color: #303133;
  margin: 8px 0 4px;
  letter-spacing: 2px;
}

.about-logo p {
  font-size: 13px;
  color: #909399;
}
</style>
