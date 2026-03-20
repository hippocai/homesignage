<template>
  <div class="file-repo-page">
    <div class="page-header">
      <h2 class="page-title">{{ $t('fileRepo.title') }}</h2>
      <el-upload
        :show-file-list="false"
        :before-upload="handleUpload"
        multiple
      >
        <el-button type="primary" :icon="Upload">{{ $t('fileRepo.uploadFile') }}</el-button>
      </el-upload>
    </div>

    <el-card shadow="never">
      <div class="filter-bar">
        <el-radio-group v-model="filterType" @change="loadFiles">
          <el-radio-button value="">{{ $t('fileRepo.filterAll') }}</el-radio-button>
          <el-radio-button value="image">{{ $t('fileRepo.filterImage') }}</el-radio-button>
          <el-radio-button value="audio">{{ $t('fileRepo.filterAudio') }}</el-radio-button>
          <el-radio-button value="video">{{ $t('fileRepo.filterVideo') }}</el-radio-button>
          <el-radio-button value="other">{{ $t('fileRepo.filterOther') }}</el-radio-button>
        </el-radio-group>
      </div>

      <el-table :data="files" v-loading="loading" stripe size="default">
        <el-table-column :label="$t('fileRepo.fileName')" min-width="200">
          <template #default="{ row }">
            <div class="file-name-cell">
              <img v-if="row.type === 'image'" :src="row.url" class="file-thumb-sm" />
              <el-icon v-else-if="row.type === 'audio'" color="#67C23A"><Headset /></el-icon>
              <el-icon v-else-if="row.type === 'video'" color="#409EFF"><VideoPlay /></el-icon>
              <el-icon v-else color="#909399"><Document /></el-icon>
              <span class="file-name-text">{{ row.name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="$t('fileRepo.type')" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="getTypeTagType(row.type)">{{ row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('fileRepo.size')" width="100">
          <template #default="{ row }">
            {{ formatSize(row.size) }}
          </template>
        </el-table-column>
        <el-table-column :label="$t('fileRepo.modifiedAt')" width="170">
          <template #default="{ row }">
            {{ formatDate(row.mtime) }}
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="Download" @click="handleDownload(row)">{{ $t('common.download') }}</el-button>
            <el-button size="small" :icon="Edit" @click="openRename(row)">{{ $t('common.rename') }}</el-button>
            <el-button size="small" type="danger" :icon="Delete" @click="handleDelete(row)">{{ $t('common.delete') }}</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="files.length === 0 && !loading" class="empty-state">
        <el-empty :description="$t('fileRepo.emptyHint')" />
      </div>
    </el-card>

    <!-- Rename Dialog -->
    <el-dialog v-model="renameDialogVisible" :title="$t('fileRepo.renameDialog')" width="400px">
      <el-form @submit.prevent="confirmRename">
        <el-form-item :label="$t('fileRepo.newFileName')">
          <el-input v-model="newName" :placeholder="$t('fileRepo.newFileNamePlaceholder')" autofocus />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="renameDialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="renaming" @click="confirmRename">{{ $t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload, Download, Edit, Delete, Headset, VideoPlay, Document } from '@element-plus/icons-vue'
import { fileRepoApi } from '../api/index.js'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()

const loading = ref(false)
const files = ref([])
const filterType = ref('')
const renameDialogVisible = ref(false)
const renamingFile = ref(null)
const newName = ref('')
const renaming = ref(false)

function getTypeTagType(type) {
  return { image: 'success', audio: 'primary', video: 'warning', other: 'info' }[type] || 'info'
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(locale.value === 'en' ? 'en-US' : 'zh-CN')
}

async function loadFiles() {
  loading.value = true
  try {
    const res = await fileRepoApi.list(filterType.value || undefined)
    files.value = res.data.data || []
  } catch (err) {
    ElMessage.error(t('fileRepo.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function handleUpload(file) {
  const fd = new FormData()
  fd.append('file', file)
  try {
    await fileRepoApi.upload(fd)
    ElMessage.success(t('fileRepo.uploadSuccess', { name: file.name }))
    await loadFiles()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || t('fileRepo.uploadFailed'))
  }
  return false // prevent default upload behavior
}

async function handleDownload(file) {
  try {
    const res = await fileRepoApi.download(file.name)
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    ElMessage.error(t('fileRepo.downloadFailed'))
  }
}

function openRename(file) {
  renamingFile.value = file
  newName.value = file.name
  renameDialogVisible.value = true
}

async function confirmRename() {
  if (!newName.value.trim() || newName.value === renamingFile.value.name) {
    renameDialogVisible.value = false
    return
  }
  renaming.value = true
  try {
    await fileRepoApi.rename(renamingFile.value.name, newName.value.trim())
    ElMessage.success(t('fileRepo.renameSuccess'))
    renameDialogVisible.value = false
    await loadFiles()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || t('fileRepo.renameFailed'))
  } finally {
    renaming.value = false
  }
}

async function handleDelete(file) {
  try {
    await ElMessageBox.confirm(
      t('fileRepo.deleteConfirm', { name: file.name }),
      t('common.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    await fileRepoApi.delete(file.name)
    ElMessage.success(t('fileRepo.deletedSuccess'))
    await loadFiles()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err.response?.data?.error || t('fileRepo.deleteFailed'))
  }
}

onMounted(loadFiles)
</script>

<style scoped>
.file-repo-page {
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
.filter-bar {
  margin-bottom: 16px;
}
.file-name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.file-thumb-sm {
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 3px;
  flex-shrink: 0;
}
.file-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
