<template>
  <div class="api-keys-page">
    <div class="page-header">
      <h2 class="page-title">API密钥管理</h2>
      <el-button type="primary" :icon="Plus" @click="openCreateDialog">生成新密钥</el-button>
    </div>

    <el-card shadow="never">
      <el-table :data="keys" v-loading="loading" stripe size="default">
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column label="密钥" min-width="260">
          <template #default="{ row }">
            <div class="key-cell">
              <el-input
                :model-value="visibleKeys[row.id] ? row.key : maskKey(row.key)"
                readonly
                size="small"
                class="key-input"
              />
              <el-button
                :icon="visibleKeys[row.id] ? Hide : View"
                size="small"
                circle
                @click="toggleKeyVisibility(row.id)"
              />
              <el-button
                :icon="CopyDocument"
                size="small"
                circle
                @click="copyKey(row.key)"
              />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="最后使用" width="170">
          <template #default="{ row }">
            <span class="text-muted">{{ formatDate(row.last_used_at) || '从未使用' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
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

    <!-- Create Key Dialog -->
    <el-dialog
      v-model="createDialogVisible"
      title="生成新API密钥"
      width="440px"
      @closed="resetForm"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="80px"
      >
        <el-form-item label="密钥名称" prop="name">
          <el-input v-model="form.name" placeholder="例如：HomeAssistant, N8N" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="createKey">生成密钥</el-button>
      </template>
    </el-dialog>

    <!-- Show New Key Dialog -->
    <el-dialog
      v-model="newKeyDialogVisible"
      title="密钥已生成"
      width="520px"
    >
      <el-alert type="warning" :closable="false" show-icon style="margin-bottom: 16px;">
        <template #title>请立即复制并保存此密钥，关闭后将无法再次查看完整密钥！</template>
      </el-alert>
      <div class="new-key-section">
        <div class="new-key-label">密钥名称：<strong>{{ newKeyData?.name }}</strong></div>
        <div class="new-key-value">
          <el-input
            v-model="newKeyData.key"
            readonly
            class="key-full-input"
          >
            <template #append>
              <el-button :icon="CopyDocument" @click="copyKey(newKeyData.key)">复制</el-button>
            </template>
          </el-input>
        </div>
      </div>
      <template #footer>
        <el-button type="primary" @click="newKeyDialogVisible = false">我已保存，关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Delete, CopyDocument, View, Hide } from '@element-plus/icons-vue'
import { apiKeysApi } from '../api/index.js'

const loading = ref(false)
const saving = ref(false)
const keys = ref([])
const createDialogVisible = ref(false)
const newKeyDialogVisible = ref(false)
const newKeyData = ref(null)
const visibleKeys = reactive({})
const formRef = ref(null)

const form = reactive({
  name: ''
})

const rules = {
  name: [{ required: true, message: '请输入密钥名称', trigger: 'blur' }]
}

function maskKey(key) {
  if (!key) return '—'
  const visible = key.slice(0, 8)
  return visible + '••••••••••••••••••••••••'
}

function toggleKeyVisibility(id) {
  visibleKeys[id] = !visibleKeys[id]
}

function formatDate(dt) {
  if (!dt) return null
  return new Date(dt).toLocaleString('zh-CN')
}

async function copyKey(key) {
  try {
    await navigator.clipboard.writeText(key)
    ElMessage.success('密钥已复制到剪贴板')
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}

function openCreateDialog() {
  createDialogVisible.value = true
}

function resetForm() {
  form.name = ''
  if (formRef.value) formRef.value.clearValidate()
}

async function createKey() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const res = await apiKeysApi.create({ name: form.name })
    newKeyData.value = res.data.data
    createDialogVisible.value = false
    newKeyDialogVisible.value = true
    await loadKeys()
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '生成失败')
  } finally {
    saving.value = false
  }
}

async function handleDelete(keyItem) {
  try {
    await ElMessageBox.confirm(
      `确定要删除密钥 "${keyItem.name}" 吗？使用此密钥的服务将无法访问API。`,
      '确认删除',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    await apiKeysApi.delete(keyItem.id)
    ElMessage.success('密钥已删除')
    await loadKeys()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '删除失败')
    }
  }
}

async function loadKeys() {
  loading.value = true
  try {
    const res = await apiKeysApi.list()
    keys.value = res.data.data || []
  } finally {
    loading.value = false
  }
}

onMounted(loadKeys)
</script>

<style scoped>
.api-keys-page {
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

.key-cell {
  display: flex;
  align-items: center;
  gap: 6px;
}

.key-input {
  flex: 1;
  font-family: 'Courier New', monospace;
}

.text-muted {
  color: #909399;
}

.new-key-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.new-key-label {
  font-size: 14px;
  color: #606266;
}

.key-full-input {
  font-family: 'Courier New', monospace;
}
</style>
