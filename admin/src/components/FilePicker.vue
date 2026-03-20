<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    :title="$t('filePicker.title')"
    width="680px"
    @open="loadFiles"
  >
    <div v-loading="loading">
      <div class="filter-bar">
        <el-radio-group v-model="filterType" size="small" @change="loadFiles">
          <el-radio-button value="">{{ $t('filePicker.filterAll') }}</el-radio-button>
          <el-radio-button value="image">{{ $t('filePicker.filterImage') }}</el-radio-button>
          <el-radio-button value="audio">{{ $t('filePicker.filterAudio') }}</el-radio-button>
          <el-radio-button value="video">{{ $t('filePicker.filterVideo') }}</el-radio-button>
        </el-radio-group>
      </div>
      <div class="file-grid" v-if="files.length > 0">
        <div
          v-for="file in files"
          :key="file.name"
          class="file-item"
          @click="selectFile(file)"
        >
          <div class="file-preview">
            <img v-if="file.type === 'image'" :src="file.url" class="file-thumb" />
            <el-icon v-else-if="file.type === 'audio'" size="32" color="#67C23A"><Headset /></el-icon>
            <el-icon v-else-if="file.type === 'video'" size="32" color="#409EFF"><VideoPlay /></el-icon>
            <el-icon v-else size="32" color="#909399"><Document /></el-icon>
          </div>
          <div class="file-name" :title="file.name">{{ file.name }}</div>
          <el-tag size="small" class="file-type-tag">{{ file.type }}</el-tag>
        </div>
      </div>
      <el-empty v-else-if="!loading" :description="$t('filePicker.noFiles')" />
    </div>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { Headset, VideoPlay, Document } from '@element-plus/icons-vue'
import { fileRepoApi } from '../api/index.js'

const props = defineProps({
  modelValue: Boolean,
  type: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue', 'select'])

const loading = ref(false)
const files = ref([])
const filterType = ref(props.type || '')

watch(() => props.modelValue, (v) => {
  if (v) {
    filterType.value = props.type || ''
    loadFiles()
  }
})

async function loadFiles() {
  loading.value = true
  try {
    const res = await fileRepoApi.list(filterType.value || undefined)
    files.value = res.data.data || []
  } finally {
    loading.value = false
  }
}

function selectFile(file) {
  emit('select', file.url)
  emit('update:modelValue', false)
}
</script>

<style scoped>
.filter-bar {
  margin-bottom: 16px;
}
.file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
}
.file-item {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 10px;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.file-item:hover {
  border-color: #409EFF;
  box-shadow: 0 0 0 2px #409EFF20;
}
.file-preview {
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 4px;
  background: #f5f7fa;
  margin-bottom: 8px;
}
.file-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
}
.file-name {
  font-size: 12px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
}
.file-type-tag {
  font-size: 10px;
}
</style>
