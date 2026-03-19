<template>
  <div class="scene-config" v-loading="loading">
    <p class="config-hint">选择要在此设备上显示的画面，并设置每个画面的显示时长（秒）</p>

    <div class="available-scenes">
      <div
        v-for="scene in allScenes"
        :key="scene.id"
        class="scene-item"
        :class="{ selected: isSelected(scene.id) }"
      >
        <div class="scene-item-left">
          <el-checkbox
            :model-value="isSelected(scene.id)"
            @change="(val) => toggleScene(scene.id, val)"
          />
          <span class="scene-name">{{ scene.name }}</span>
        </div>
        <div class="scene-item-right" v-if="isSelected(scene.id)">
          <span class="duration-label">时长：</span>
          <el-input-number
            v-model="getSelectedItem(scene.id).duration"
            :min="5"
            :max="3600"
            :step="5"
            controls-position="right"
            size="small"
            style="width: 120px"
          />
          <span class="duration-unit">秒</span>
        </div>
      </div>

      <el-empty v-if="allScenes.length === 0" description="暂无画面，请先创建画面" />
    </div>

    <!-- Selected scenes order -->
    <div v-if="selectedScenes.length > 0" class="selected-order">
      <el-divider content-position="left">显示顺序</el-divider>
      <div class="order-list">
        <div
          v-for="(item, index) in selectedScenes"
          :key="item.scene_id"
          class="order-item"
        >
          <span class="order-num">{{ index + 1 }}</span>
          <span class="order-name">{{ getSceneName(item.scene_id) }}</span>
          <span class="order-duration">{{ item.duration }}秒</span>
          <div class="order-actions">
            <el-button
              :icon="ArrowUp"
              size="small"
              circle
              :disabled="index === 0"
              @click="moveUp(index)"
            />
            <el-button
              :icon="ArrowDown"
              size="small"
              circle
              :disabled="index === selectedScenes.length - 1"
              @click="moveDown(index)"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="config-footer">
      <el-button @click="$emit('saved')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveConfig">
        保存配置
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import { devicesApi, scenesApi } from '../api/index.js'

const props = defineProps({
  deviceId: {
    type: [String, Number],
    required: true
  }
})

const emit = defineEmits(['saved'])

const loading = ref(false)
const saving = ref(false)
const allScenes = ref([])
const selectedScenes = ref([]) // Array of { scene_id, duration }

function isSelected(sceneId) {
  return selectedScenes.value.some(s => s.scene_id === sceneId)
}

function getSelectedItem(sceneId) {
  return selectedScenes.value.find(s => s.scene_id === sceneId)
}

function getSceneName(sceneId) {
  const scene = allScenes.value.find(s => s.id === sceneId)
  return scene ? scene.name : `画面 #${sceneId}`
}

function toggleScene(sceneId, selected) {
  if (selected) {
    selectedScenes.value.push({ scene_id: sceneId, duration: 30 })
  } else {
    const idx = selectedScenes.value.findIndex(s => s.scene_id === sceneId)
    if (idx !== -1) selectedScenes.value.splice(idx, 1)
  }
}

function moveUp(index) {
  if (index === 0) return
  const arr = selectedScenes.value
  ;[arr[index - 1], arr[index]] = [arr[index], arr[index - 1]]
}

function moveDown(index) {
  const arr = selectedScenes.value
  if (index === arr.length - 1) return
  ;[arr[index], arr[index + 1]] = [arr[index + 1], arr[index]]
}

async function saveConfig() {
  const scenes = selectedScenes.value.map(item => ({
    sceneId: item.scene_id,
    duration: item.duration || 30
  }))

  saving.value = true
  try {
    await devicesApi.setScenes(props.deviceId, scenes)
    ElMessage.success('画面配置已保存')
    emit('saved')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  loading.value = true
  try {
    const [scenesRes, deviceScenesRes] = await Promise.allSettled([
      scenesApi.list(),
      devicesApi.getScenes(props.deviceId)
    ])

    if (scenesRes.status === 'fulfilled') {
      allScenes.value = scenesRes.value.data.data || []
    }

    if (deviceScenesRes.status === 'fulfilled') {
      const existingScenes = deviceScenesRes.value.data.data || []
      existingScenes.forEach(s => {
        selectedScenes.value.push({ scene_id: s.scene_id, duration: s.duration || 30 })
      })
    }
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.scene-config {
  min-height: 200px;
}

.config-hint {
  color: #909399;
  font-size: 13px;
  margin-bottom: 16px;
}

.available-scenes {
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  overflow: hidden;
  max-height: 300px;
  overflow-y: auto;
}

.scene-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid #f2f6fc;
  transition: background-color 0.2s;
}

.scene-item:last-child {
  border-bottom: none;
}

.scene-item.selected {
  background-color: #f0f9ff;
}

.scene-item-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.scene-name {
  font-size: 14px;
  color: #303133;
}

.scene-item-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.duration-label {
  font-size: 13px;
  color: #606266;
}

.duration-unit {
  font-size: 13px;
  color: #606266;
}

.selected-order {
  margin-top: 4px;
}

.order-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.order-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background-color: #f5f7fa;
  border-radius: 6px;
}

.order-num {
  width: 24px;
  height: 24px;
  background-color: #409EFF;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.order-name {
  flex: 1;
  font-size: 14px;
  color: #303133;
}

.order-duration {
  font-size: 13px;
  color: #909399;
}

.order-actions {
  display: flex;
  gap: 4px;
}

.config-footer {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
