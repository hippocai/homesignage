<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">信息列表</h2>
        <p class="page-desc">管理显示在信息列表组件中的条目，支持定时显示和永久显示。</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openDialog()">添加信息</el-button>
    </div>

    <el-card>
      <el-table :data="items" v-loading="loading" stripe>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag :type="TYPE_MAP[row.type]?.tagType || 'info'" size="small">
              {{ TYPE_MAP[row.type]?.label || row.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="信息内容" prop="text" min-width="220" show-overflow-tooltip />
        <el-table-column label="开始时间" width="180">
          <template #default="{ row }">
            <span v-if="row.start_time">{{ formatTime(row.start_time) }}</span>
            <el-tag v-else type="info" size="small">立即</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="结束时间" width="180">
          <template #default="{ row }">
            <span v-if="row.end_time">{{ formatTime(row.end_time) }}</span>
            <el-tag v-else type="success" size="small">永久</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row)" size="small">{{ getStatusLabel(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="180">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDialog(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && items.length === 0" description="暂无信息条目" />
    </el-card>

    <!-- Add/Edit Dialog -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingItem ? '编辑信息' : '添加信息'"
      width="520px"
      @closed="resetForm"
    >
      <el-form :model="form" :rules="rules" ref="formRef" label-width="90px">
        <el-form-item label="信息类型" prop="type">
          <el-radio-group v-model="form.type">
            <el-radio-button value="info">
              <span style="color:#409EFF">● 提示</span>
            </el-radio-button>
            <el-radio-button value="important">
              <span style="color:#E6A23C">● 重要</span>
            </el-radio-button>
            <el-radio-button value="urgent">
              <span style="color:#F56C6C">● 紧急</span>
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="信息内容" prop="text">
          <el-input
            v-model="form.text"
            type="textarea"
            :rows="3"
            placeholder="输入要显示的信息内容"
          />
        </el-form-item>
        <el-form-item label="开始时间">
          <el-date-picker
            v-model="form.start_time"
            type="datetime"
            placeholder="不填则立即显示"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:00"
            style="width: 100%"
            clearable
          />
        </el-form-item>
        <el-form-item label="结束时间">
          <el-date-picker
            v-model="form.end_time"
            type="datetime"
            placeholder="不填则永久显示"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:00"
            style="width: 100%"
            clearable
          />
          <div class="form-tip">不填写结束时间则信息将永久保留在列表中。</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { infoItemsApi } from '../api/index.js'

const loading = ref(false)
const saving = ref(false)
const items = ref([])
const dialogVisible = ref(false)
const editingItem = ref(null)
const formRef = ref(null)

const TYPE_MAP = {
  info:      { label: '提示', tagType: 'primary' },
  important: { label: '重要', tagType: 'warning' },
  urgent:    { label: '紧急', tagType: 'danger' },
}

const form = ref({ type: 'info', text: '', start_time: null, end_time: null })

const rules = {
  text: [{ required: true, message: '请输入信息内容', trigger: 'blur' }]
}

function openDialog(item = null) {
  editingItem.value = item
  if (item) {
    form.value = {
      type: item.type || 'info',
      text: item.text,
      start_time: item.start_time || null,
      end_time: item.end_time || null,
    }
  } else {
    form.value = { type: 'info', text: '', start_time: null, end_time: null }
  }
  dialogVisible.value = true
}

function resetForm() {
  formRef.value?.resetFields()
  editingItem.value = null
}

async function loadItems() {
  loading.value = true
  try {
    const res = await infoItemsApi.list()
    items.value = res.data.data || []
  } catch {
    ElMessage.error('加载信息列表失败')
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  saving.value = true
  try {
    const payload = {
      type: form.value.type,
      text: form.value.text,
      start_time: form.value.start_time || null,
      end_time: form.value.end_time || null,
    }
    if (editingItem.value) {
      await infoItemsApi.update(editingItem.value.id, payload)
      ElMessage.success('信息已更新')
    } else {
      await infoItemsApi.create(payload)
      ElMessage.success('信息已添加')
    }
    dialogVisible.value = false
    loadItems()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || '保存失败')
  } finally {
    saving.value = false
  }
}

async function handleDelete(item) {
  try {
    await ElMessageBox.confirm(`确定要删除这条信息吗？\n"${item.text}"`, '确认删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await infoItemsApi.delete(item.id)
    ElMessage.success('信息已删除')
    loadItems()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error('删除失败')
  }
}

function formatTime(isoStr) {
  if (!isoStr) return ''
  return isoStr.replace('T', ' ').slice(0, 16)
}

function getStatusType(row) {
  const now = new Date().toISOString()
  if (row.end_time && row.end_time < now) return 'danger'
  if (row.start_time && row.start_time > now) return 'warning'
  return 'success'
}

function getStatusLabel(row) {
  const now = new Date().toISOString()
  if (row.end_time && row.end_time < now) return '已过期'
  if (row.start_time && row.start_time > now) return '待生效'
  return '显示中'
}

onMounted(loadItems)
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}
.page-title {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
}
.page-desc {
  font-size: 13px;
  color: #909399;
}
.form-tip {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
</style>
