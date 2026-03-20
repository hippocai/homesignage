<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('infoItems.title') }}</h2>
        <p class="page-desc">{{ $t('infoItems.pageDesc') }}</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openDialog()">{{ $t('infoItems.addItem') }}</el-button>
    </div>

    <el-card>
      <el-table :data="items" v-loading="loading" stripe>
        <el-table-column :label="$t('infoItems.type')" width="90">
          <template #default="{ row }">
            <el-tag :type="typeMap[row.type]?.tagType || 'info'" size="small">
              {{ typeMap[row.type]?.label || row.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('infoItems.content')" prop="text" min-width="220" show-overflow-tooltip />
        <el-table-column :label="$t('infoItems.startTime')" width="180">
          <template #default="{ row }">
            <span v-if="row.start_time">{{ formatTime(row.start_time) }}</span>
            <el-tag v-else type="info" size="small">{{ $t('infoItems.immediate') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('infoItems.endTime')" width="180">
          <template #default="{ row }">
            <span v-if="row.end_time">{{ formatTime(row.end_time) }}</span>
            <el-tag v-else type="success" size="small">{{ $t('infoItems.permanent') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('infoItems.status')" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row)" size="small">{{ getStatusLabel(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('infoItems.createdAt')" width="180">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="140" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDialog(row)">{{ $t('common.edit') }}</el-button>
            <el-button size="small" type="danger" @click="handleDelete(row)">{{ $t('common.delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loading && items.length === 0" :description="$t('infoItems.noItems')" />
    </el-card>

    <!-- Add/Edit Dialog -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingItem ? $t('infoItems.editItem') : $t('infoItems.addItem')"
      width="520px"
      @closed="resetForm"
    >
      <el-form :model="form" :rules="rules" ref="formRef" label-width="90px">
        <el-form-item :label="$t('infoItems.itemType')" prop="type">
          <el-radio-group v-model="form.type">
            <el-radio-button value="info">
              <span style="color:#409EFF">● {{ $t('infoItems.typeInfo') }}</span>
            </el-radio-button>
            <el-radio-button value="important">
              <span style="color:#E6A23C">● {{ $t('infoItems.typeImportant') }}</span>
            </el-radio-button>
            <el-radio-button value="urgent">
              <span style="color:#F56C6C">● {{ $t('infoItems.typeUrgent') }}</span>
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="$t('infoItems.itemContent')" prop="text">
          <el-input
            v-model="form.text"
            type="textarea"
            :rows="3"
            :placeholder="$t('infoItems.itemContentPlaceholder')"
          />
        </el-form-item>
        <el-form-item :label="$t('infoItems.startTime')">
          <el-date-picker
            v-model="form.start_time"
            type="datetime"
            :placeholder="$t('infoItems.startTimePlaceholder')"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:00"
            style="width: 100%"
            clearable
          />
        </el-form-item>
        <el-form-item :label="$t('infoItems.endTime')">
          <el-date-picker
            v-model="form.end_time"
            type="datetime"
            :placeholder="$t('infoItems.endTimePlaceholder')"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DDTHH:mm:00"
            style="width: 100%"
            clearable
          />
          <div class="form-tip">{{ $t('infoItems.endTimeHint') }}</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { infoItemsApi } from '../api/index.js'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const loading = ref(false)
const saving = ref(false)
const items = ref([])
const dialogVisible = ref(false)
const editingItem = ref(null)
const formRef = ref(null)

const typeMap = computed(() => ({
  info:      { label: t('infoItems.typeInfo'), tagType: 'primary' },
  important: { label: t('infoItems.typeImportant'), tagType: 'warning' },
  urgent:    { label: t('infoItems.typeUrgent'), tagType: 'danger' },
}))

const form = ref({ type: 'info', text: '', start_time: null, end_time: null })

const rules = computed(() => ({
  text: [{ required: true, message: t('infoItems.itemContentRequired'), trigger: 'blur' }]
}))

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
    ElMessage.error(t('infoItems.loadFailed'))
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
      ElMessage.success(t('infoItems.updatedSuccess'))
    } else {
      await infoItemsApi.create(payload)
      ElMessage.success(t('infoItems.addedSuccess'))
    }
    dialogVisible.value = false
    loadItems()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || t('common.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function handleDelete(item) {
  try {
    await ElMessageBox.confirm(
      t('infoItems.deleteConfirm', { text: item.text }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      }
    )
    await infoItemsApi.delete(item.id)
    ElMessage.success(t('infoItems.deletedSuccess'))
    loadItems()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(t('infoItems.deleteFailed'))
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
  if (row.end_time && row.end_time < now) return t('infoItems.statusExpired')
  if (row.start_time && row.start_time > now) return t('infoItems.statusPending')
  return t('infoItems.statusActive')
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
