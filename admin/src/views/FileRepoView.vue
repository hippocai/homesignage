<template>
  <div class="file-repo-page">
    <div class="page-header">
      <h2 class="page-title">文件仓库</h2>
      <el-upload
        :show-file-list="false"
        :before-upload="handleUpload"
        multiple
      >
        <el-button type="primary" :icon="Upload">上传文件</el-button>
      </el-upload>
    </div>

    <el-card shadow="never">
      <div class="filter-bar">
        <el-radio-group v-model="filterType" @change="loadFiles">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="image">图片</el-radio-button>
          <el-radio-button value="audio">音频</el-radio-button>
          <el-radio-button value="video">视频</el-radio-button>
          <el-radio-button value="other">其他</el-radio-button>
        </el-radio-group>
      </div>

      <el-table :data="files" v-loading="loading" stripe size="default">
        <el-table-column label="文件名" min-width="200">
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
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="getTypeTagType(row.type)">{{ row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="大小" width="100">
          <template #default="{ row }">
            {{ formatSize(row.size) }}
          </template>
        </el-table-column>
        <el-table-column label="修改时间" width="170">
          <template #default="{ row }">
            {{ formatDate(row.mtime) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="Download" @click="handleDownload(row)">下载</el-button>
            <el-button size="small" :icon="Edit" @click="openRename(row)">重命名</el-button>
            <el-button size="small" type="danger" :icon="Delete" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="files.length === 0 && !loading" class="empty-state">
        <el-empty description="文件仓库为空，请上传文件" />
      </div>
    </el-card>

    <!-- Rename Dialog -->
    <el-dialog v-model="renameDialogVisible" title="重命名文件" width="400px">
      <el-form @submit.prevent="confirmRename">
        <el-form-item label="新文件名">
          <el-input v-model="newName" placeholder="输入新文件名" autofocus />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="renameDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="renaming" @click="confirmRename">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload, Download, Edit, Delete, Headset, VideoPlay, Document } from '@element-plus/icons-vue'
import { fileRepoApi } from '../api/index.js'

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
  return new Date(iso).toLocaleString('zh-CN')
}

async function loadFiles() {
  loading.value = true
  try {
    const res = await fileRepoApi.list(filterType.value || undefined)
    files.value = res.data.data || []
  } catch (err) {
    ElMessage.error('加载失败')
  } finally {
    loading.value = false
  }
}

async function handleUpload(file) {
  const fd = new FormData()
  fd.append('file', file)
  try {
    await fileRepoApi.upload(fd)
    ElMessage.success(`${file.name} 上传成功`)
    await loadFiles()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || '上传失败')
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
    ElMessage.error('下载失败')
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
    ElMessage.success('重命名成功')
    renameDialogVisible.value = false
    await loadFiles()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || '重命名失败')
  } finally {
    renaming.value = false
  }
}

async function handleDelete(file) {
  try {
    await ElMessageBox.confirm(`确定删除文件 "${file.name}" 吗？`, '确认删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await fileRepoApi.delete(file.name)
    ElMessage.success('已删除')
    await loadFiles()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err.response?.data?.error || '删除失败')
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
