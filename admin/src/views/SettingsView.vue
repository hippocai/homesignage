<template>
  <div class="settings-page">
    <h2 class="page-title">系统设置</h2>

    <el-row :gutter="24">
      <!-- Change password -->
      <el-col :span="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <el-icon><Lock /></el-icon>
              <span>修改管理员密码</span>
            </div>
          </template>
          <el-form
            ref="passwordFormRef"
            :model="passwordForm"
            :rules="passwordRules"
            label-width="110px"
          >
            <el-form-item label="当前密码" prop="currentPassword">
              <el-input
                v-model="passwordForm.currentPassword"
                type="password"
                show-password
                placeholder="请输入当前密码"
              />
            </el-form-item>
            <el-form-item label="新密码" prop="newPassword">
              <el-input
                v-model="passwordForm.newPassword"
                type="password"
                show-password
                placeholder="请输入新密码（至少6位）"
              />
            </el-form-item>
            <el-form-item label="确认新密码" prop="confirmPassword">
              <el-input
                v-model="passwordForm.confirmPassword"
                type="password"
                show-password
                placeholder="再次输入新密码"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="changingPassword" @click="changePassword">
                修改密码
              </el-button>
              <el-button @click="resetPasswordForm">重置</el-button>
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
              <span>系统信息</span>
            </div>
          </template>
          <div class="sys-info" v-loading="sysLoading">
            <div class="info-row">
              <span class="info-label">Node.js 版本</span>
              <el-tag type="success" size="small">{{ systemInfo.node_version || '—' }}</el-tag>
            </div>
            <div class="info-row">
              <span class="info-label">系统平台</span>
              <span class="info-value">{{ systemInfo.platform || '—' }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">系统运行时间</span>
              <span class="info-value">{{ formatUptime(systemInfo.uptime) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">内存使用</span>
              <span class="info-value">{{ formatMemory(systemInfo.memory) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">在线设备</span>
              <span class="info-value">{{ systemInfo.connected_device_count ?? '—' }} / {{ systemInfo.device_count ?? '—' }} 台</span>
            </div>
            <div class="info-row">
              <span class="info-label">进程 PID</span>
              <span class="info-value info-mono">{{ systemInfo.pid || '—' }}</span>
            </div>
            <el-divider />
            <div class="refresh-row">
              <el-button size="small" :icon="Refresh" @click="loadSystemInfo">刷新信息</el-button>
            </div>
          </div>
        </el-card>

        <el-card shadow="never" style="margin-top: 20px;">
          <template #header>
            <div class="card-header">
              <el-icon><Setting /></el-icon>
              <span>关于系统</span>
            </div>
          </template>
          <div class="about-section">
            <div class="about-logo">
              <el-icon size="48" color="#409EFF"><Monitor /></el-icon>
              <h3>HomeSignage</h3>
              <p>智能家庭信息展示系统</p>
            </div>
            <el-descriptions :column="1" size="small" border>
              <el-descriptions-item label="系统版本">
                <el-tag size="small">v1.0.0</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="许可证">MIT License</el-descriptions-item>
            </el-descriptions>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { Lock, InfoFilled, Refresh } from '@element-plus/icons-vue'
import { systemApi, authApi } from '../api/index.js'

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
    callback(new Error('两次输入的密码不一致'))
  } else {
    callback()
  }
}

const passwordRules = {
  currentPassword: [
    { required: true, message: '请输入当前密码', trigger: 'blur' }
  ],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码长度至少6位', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, message: '请确认新密码', trigger: 'blur' },
    { validator: validateConfirm, trigger: 'blur' }
  ]
}

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
  if (days > 0) parts.push(`${days}天`)
  if (hours > 0) parts.push(`${hours}小时`)
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}分钟`)
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
    ElMessage.success('密码已修改，请重新登录')
    resetPasswordForm()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '密码修改失败')
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
