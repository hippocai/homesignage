<template>
  <div class="scenes-page">
    <div class="page-header">
      <h2 class="page-title">画面管理</h2>
      <el-button type="primary" :icon="Plus" @click="openCreateDialog">新建画面</el-button>
    </div>

    <div v-loading="loading">
      <el-row :gutter="20" v-if="scenes.length > 0">
        <el-col
          v-for="scene in scenes"
          :key="scene.id"
          :xs="24"
          :sm="12"
          :md="8"
          :lg="6"
          style="margin-bottom: 20px"
        >
          <el-card shadow="hover" class="scene-card">
            <div class="scene-preview" @click="editScene(scene)">
              <el-icon size="40" color="#c0c4cc"><Picture /></el-icon>
            </div>
            <div class="scene-info">
              <h3 class="scene-name" :title="scene.name">{{ scene.name }}</h3>
              <p class="scene-desc" v-if="scene.description">{{ scene.description }}</p>
              <div class="scene-meta">
                <span class="meta-item">
                  <el-icon><Grid /></el-icon>
                  {{ scene.component_count || 0 }} 个组件
                </span>
                <span class="meta-item">
                  <el-icon><Calendar /></el-icon>
                  {{ formatDate(scene.created_at) }}
                </span>
              </div>
            </div>
            <div class="scene-actions">
              <el-button
                size="small"
                type="primary"
                :icon="Edit"
                @click="editScene(scene)"
              >
                编辑
              </el-button>
              <el-button
                size="small"
                type="danger"
                :icon="Delete"
                @click="deleteScene(scene)"
              >
                删除
              </el-button>
            </div>
          </el-card>
        </el-col>
      </el-row>

      <el-empty v-else description="暂无画面，点击「新建画面」开始创建" />
    </div>

    <!-- Create Scene Dialog -->
    <el-dialog
      v-model="createDialogVisible"
      title="新建画面"
      width="480px"
      @closed="resetForm"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="80px"
      >
        <el-form-item label="画面名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入画面名称" />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            placeholder="可选描述"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="createScene">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, Grid, Calendar } from '@element-plus/icons-vue'
import { scenesApi } from '../api/index.js'

const router = useRouter()

const loading = ref(false)
const saving = ref(false)
const scenes = ref([])
const createDialogVisible = ref(false)
const formRef = ref(null)

const form = reactive({
  name: '',
  description: ''
})

const rules = {
  name: [{ required: true, message: '请输入画面名称', trigger: 'blur' }]
}

function formatDate(date) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('zh-CN')
}

function openCreateDialog() {
  createDialogVisible.value = true
}

function resetForm() {
  form.name = ''
  form.description = ''
  if (formRef.value) formRef.value.clearValidate()
}

function editScene(scene) {
  router.push(`/scenes/${scene.id}/edit`)
}

async function createScene() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const res = await scenesApi.create({
      name: form.name,
      description: form.description || undefined
    })
    const newScene = res.data.data
    createDialogVisible.value = false
    ElMessage.success('画面已创建')
    router.push(`/scenes/${newScene.id}/edit`)
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '创建失败')
  } finally {
    saving.value = false
  }
}

async function deleteScene(scene) {
  try {
    await ElMessageBox.confirm(
      `确定要删除画面 "${scene.name}" 吗？此操作不可恢复。`,
      '确认删除',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    await scenesApi.delete(scene.id)
    ElMessage.success('画面已删除')
    await loadScenes()
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.response?.data?.message || '删除失败')
    }
  }
}

async function loadScenes() {
  loading.value = true
  try {
    const res = await scenesApi.list()
    scenes.value = res.data.data || []
  } finally {
    loading.value = false
  }
}

onMounted(loadScenes)
</script>

<style scoped>
.scenes-page {
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

.scene-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  transition: transform 0.2s;
}

.scene-card:hover {
  transform: translateY(-2px);
}

.scene-preview {
  height: 120px;
  background: linear-gradient(135deg, #f5f7fa 0%, #e4e9f2 100%);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  margin-bottom: 14px;
  transition: background-color 0.2s;
}

.scene-preview:hover {
  background: linear-gradient(135deg, #e8edf5 0%, #d4dae8 100%);
}

.scene-info {
  flex: 1;
}

.scene-name {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.scene-desc {
  font-size: 12px;
  color: #909399;
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.scene-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #909399;
}

.scene-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #f2f6fc;
}
</style>
