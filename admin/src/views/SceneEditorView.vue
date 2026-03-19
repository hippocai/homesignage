<template>
  <div
    class="scene-editor"
    @mousemove.prevent="onGlobalMouseMove"
    @mouseup="onGlobalMouseUp"
    @mouseleave="onGlobalMouseUp"
  >
    <!-- Top bar -->
    <div class="editor-topbar">
      <div class="topbar-left">
        <el-button :icon="ArrowLeft" @click="$router.push('/scenes')">返回</el-button>
        <el-input v-model="sceneName" placeholder="画面名称" class="title-input" size="large" />
      </div>
      <div class="topbar-right">
        <el-select v-model="resolutionKey" style="width: 190px" @change="onResolutionChange">
          <el-option
            v-for="r in RESOLUTION_PRESETS"
            :key="r.key"
            :label="r.label"
            :value="r.key"
          />
          <el-option label="自定义..." value="custom" />
        </el-select>
        <template v-if="resolutionKey === 'custom'">
          <el-input-number
            v-model="customWidth"
            :min="100" :max="7680"
            controls-position="right"
            style="width: 90px"
            placeholder="宽"
            @change="applyCustomResolution"
          />
          <span style="color:#aaa;font-size:13px">×</span>
          <el-input-number
            v-model="customHeight"
            :min="100" :max="4320"
            controls-position="right"
            style="width: 90px"
            placeholder="高"
            @change="applyCustomResolution"
          />
        </template>
        <div class="bg-picker-wrap">
          <span class="bg-label">背景</span>
          <el-color-picker v-model="sceneBackground" show-alpha size="small" />
        </div>
        <el-button :icon="View" @click="openPreview">预览</el-button>
        <el-button :icon="Plus" type="primary" @click="openAddComponent">添加组件</el-button>
        <el-button type="success" :icon="Check" :loading="saving" @click="saveScene">
          保存画面
        </el-button>
      </div>
    </div>

    <div class="editor-body">
      <!-- Left: Component list -->
      <div class="left-panel">
        <div class="panel-header">组件列表</div>
        <div class="component-list" v-loading="loading">
          <div
            v-for="comp in components"
            :key="comp.id"
            class="component-item"
            :class="{ active: selectedComponent?.id === comp.id }"
            @click="selectComponent(comp)"
          >
            <div class="comp-icon">
              <el-icon><component :is="getComponentIcon(comp.type)" /></el-icon>
            </div>
            <div class="comp-info">
              <div class="comp-type">{{ getComponentLabel(comp.type) }}</div>
              <div class="comp-name">{{ getComponentSummary(comp) }}</div>
            </div>
            <div class="comp-actions">
              <el-button
                :icon="Delete"
                size="small"
                type="danger"
                circle
                @click.stop="deleteComponent(comp)"
              />
            </div>
          </div>
          <el-empty v-if="components.length === 0" description="暂无组件" :image-size="60" />
        </div>
      </div>

      <!-- Center: Canvas -->
      <div class="center-panel" ref="centerPanelRef">
        <div class="panel-header canvas-header">
          <span>{{ canvasWidth }}×{{ canvasHeight }}</span>
          <span class="canvas-hint">· 拖拽组件移动位置，拖拽边角调整大小</span>
        </div>
        <div class="preview-wrapper">
          <div
            class="preview-canvas"
            ref="previewCanvasRef"
            :style="canvasStyle"
            @click.self="selectedComponent = null"
          >
            <div
              v-for="comp in components"
              :key="comp.id"
              class="preview-component"
              :class="{ 'is-selected': selectedComponent?.id === comp.id }"
              :style="getComponentStyle(comp)"
              @mousedown.prevent.stop="startDrag($event, comp)"
              @click.stop="selectComponent(comp)"
            >
              <div class="comp-preview-content">
                <template v-if="comp.type === 'text'">
                  <div :style="getTextStyle(comp)" class="text-preview">
                    {{ comp.config?.content || '文字' }}
                  </div>
                </template>
                <template v-else-if="comp.type === 'image'">
                  <img
                    v-if="comp.config?.url"
                    :src="comp.config.url"
                    :style="{ objectFit: comp.config.objectFit || 'cover', width: '100%', height: '100%' }"
                  />
                  <div v-else class="comp-placeholder">
                    <el-icon :size="18"><Picture /></el-icon>
                    <span>图片</span>
                  </div>
                </template>
                <template v-else-if="comp.type === 'clock'">
                  <div class="clock-preview">{{ getClockDisplay(comp) }}</div>
                </template>
                <template v-else>
                  <div class="comp-placeholder">
                    <el-icon :size="18"><component :is="getComponentIcon(comp.type)" /></el-icon>
                    <span>{{ getComponentLabel(comp.type) }}</span>
                  </div>
                </template>
              </div>
              <!-- Resize handles for selected -->
              <template v-if="selectedComponent?.id === comp.id">
                <div
                  v-for="handle in RESIZE_HANDLES"
                  :key="handle"
                  :class="['resize-handle', `handle-${handle}`]"
                  @mousedown.prevent.stop="startResize($event, comp, handle)"
                />
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Properties -->
      <div class="right-panel">
        <div class="panel-header">属性设置</div>
        <div class="property-editor" v-if="selectedComponent">
          <div class="prop-section">
            <div class="prop-section-title">位置与大小（百分比）</div>
            <el-form label-width="50px" size="small">
              <el-row :gutter="8">
                <el-col :span="12">
                  <el-form-item label="X">
                    <el-input-number
                      v-model="editForm.x"
                      :min="0" :max="99" :precision="1"
                      controls-position="right"
                      class="full-width"
                      @change="syncEditFormToComp"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="Y">
                    <el-input-number
                      v-model="editForm.y"
                      :min="0" :max="99" :precision="1"
                      controls-position="right"
                      class="full-width"
                      @change="syncEditFormToComp"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="宽">
                    <el-input-number
                      v-model="editForm.width"
                      :min="1" :max="100" :precision="1"
                      controls-position="right"
                      class="full-width"
                      @change="syncEditFormToComp"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="高">
                    <el-input-number
                      v-model="editForm.height"
                      :min="1" :max="100" :precision="1"
                      controls-position="right"
                      class="full-width"
                      @change="syncEditFormToComp"
                    />
                  </el-form-item>
                </el-col>
              </el-row>
            </el-form>
          </div>

          <div class="prop-section">
            <div class="prop-section-title">组件配置</div>

            <el-form v-if="selectedComponent.type === 'clock'" label-width="80px" size="small">
              <el-form-item label="时间格式">
                <el-select v-model="editForm.config.format">
                  <el-option label="HH:mm" value="HH:mm" />
                  <el-option label="HH:mm:ss" value="HH:mm:ss" />
                </el-select>
              </el-form-item>
              <el-form-item label="显示日期">
                <el-switch v-model="editForm.config.showDate" />
              </el-form-item>
              <el-form-item label="时区">
                <el-input v-model="editForm.config.timezone" placeholder="Asia/Shanghai" />
              </el-form-item>
            </el-form>

            <el-form v-else-if="selectedComponent.type === 'weather'" label-width="80px" size="small">
              <el-form-item label="城市">
                <el-input v-model="editForm.config.city" placeholder="例如：Beijing" />
              </el-form-item>
              <el-form-item label="温度单位">
                <el-select v-model="editForm.config.unit">
                  <el-option label="摄氏度 (°C)" value="C" />
                  <el-option label="华氏度 (°F)" value="F" />
                </el-select>
              </el-form-item>
            </el-form>

            <el-form v-else-if="selectedComponent.type === 'text'" label-width="80px" size="small">
              <el-form-item label="文字内容">
                <el-input
                  v-model="editForm.config.content"
                  type="textarea"
                  :rows="3"
                  placeholder="输入文字内容"
                />
              </el-form-item>
              <el-form-item label="字体大小">
                <el-input-number
                  v-model="editForm.config.fontSize"
                  :min="8" :max="200"
                  controls-position="right"
                />
              </el-form-item>
              <el-form-item label="文字颜色">
                <el-color-picker v-model="editForm.config.color" />
              </el-form-item>
              <el-form-item label="背景颜色">
                <el-color-picker v-model="editForm.config.backgroundColor" show-alpha />
              </el-form-item>
              <el-form-item label="对齐方式">
                <el-select v-model="editForm.config.textAlign">
                  <el-option label="左对齐" value="left" />
                  <el-option label="居中" value="center" />
                  <el-option label="右对齐" value="right" />
                </el-select>
              </el-form-item>
            </el-form>

            <el-form v-else-if="selectedComponent.type === 'image'" label-width="80px" size="small">
              <el-form-item label="图片URL">
                <el-input v-model="editForm.config.url" placeholder="输入图片地址" />
              </el-form-item>
              <el-form-item label="填充方式">
                <el-select v-model="editForm.config.objectFit">
                  <el-option label="覆盖 (cover)" value="cover" />
                  <el-option label="包含 (contain)" value="contain" />
                  <el-option label="填充 (fill)" value="fill" />
                  <el-option label="原始大小 (none)" value="none" />
                </el-select>
              </el-form-item>
            </el-form>

            <el-form v-else-if="selectedComponent.type === 'iframe'" label-width="80px" size="small">
              <el-form-item label="网页URL">
                <el-input v-model="editForm.config.url" placeholder="https://..." />
              </el-form-item>
            </el-form>
          </div>

          <div class="prop-actions">
            <el-button type="primary" size="small" @click="applyComponentEdit">应用更改</el-button>
          </div>
        </div>
        <el-empty v-else description="请选择一个组件" :image-size="60" />
      </div>
    </div>

    <!-- Preview Dialog -->
    <el-dialog
      v-model="previewVisible"
      title="画面预览"
      width="92vw"
      top="2vh"
      destroy-on-close
    >
      <div class="preview-dialog-body" ref="previewDialogBodyRef">
        <div class="preview-dialog-wrapper">
          <div
            class="preview-dialog-canvas"
            :style="dialogCanvasStyle"
          >
            <div
              v-for="comp in components"
              :key="comp.id"
              class="preview-dialog-comp"
              :style="getComponentStyle(comp)"
            >
              <template v-if="comp.type === 'text'">
                <div :style="getTextStyle(comp)" class="text-preview">
                  {{ comp.config?.content || '' }}
                </div>
              </template>
              <template v-else-if="comp.type === 'image'">
                <img
                  v-if="comp.config?.url"
                  :src="comp.config.url"
                  :style="{ objectFit: comp.config.objectFit || 'cover', width: '100%', height: '100%' }"
                />
              </template>
              <template v-else-if="comp.type === 'clock'">
                <div class="clock-preview dialog-clock">{{ getClockDisplay(comp) }}</div>
              </template>
              <template v-else-if="comp.type === 'weather'">
                <div class="dialog-weather">🌤 {{ comp.config?.city || '' }}</div>
              </template>
              <template v-else-if="comp.type === 'iframe'">
                <div class="dialog-iframe">🌐 {{ comp.config?.url || '' }}</div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- Add Component Dialog -->
    <el-dialog v-model="addCompDialogVisible" title="添加组件" width="400px">
      <div class="comp-type-grid">
        <div
          v-for="type in componentTypes"
          :key="type.value"
          class="comp-type-item"
          @click="addComponent(type.value)"
        >
          <el-icon size="32" :color="type.color">
            <component :is="type.icon" />
          </el-icon>
          <span>{{ type.label }}</span>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Plus, Check, Delete, View, Clock, Cloudy, Document, Picture, Link } from '@element-plus/icons-vue'
import { scenesApi } from '../api/index.js'

const route = useRoute()
const sceneId = computed(() => route.params.id)

const RESOLUTION_PRESETS = [
  { key: '1920x1080', label: '1920×1080 横屏FHD', width: 1920, height: 1080 },
  { key: '1280x720',  label: '1280×720 横屏HD',   width: 1280, height: 720 },
  { key: '1080x1920', label: '1080×1920 竖屏FHD', width: 1080, height: 1920 },
  { key: '768x1024',  label: '768×1024 iPad',     width: 768,  height: 1024 },
  { key: '390x844',   label: '390×844 手机',       width: 390,  height: 844 },
]
const RESIZE_HANDLES = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']

// State
const loading = ref(false)
const saving = ref(false)
const sceneName = ref('')
const sceneDescription = ref('')
const components = ref([])
const selectedComponent = ref(null)
const addCompDialogVisible = ref(false)
const previewVisible = ref(false)
const clockNow = ref(new Date())
const resolutionKey = ref('1280x720')
const canvasWidth = ref(1280)
const canvasHeight = ref(720)
const customWidth = ref(1280)
const customHeight = ref(720)
const sceneBackground = ref('#1a1a2e')
const previewScale = ref(0.5)
const dialogScale = ref(0.5)

// Refs
const centerPanelRef = ref(null)
const previewCanvasRef = ref(null)
const previewDialogBodyRef = ref(null)

// Drag/Resize state
const dragState = ref(null)
const resizeState = ref(null)

const editForm = reactive({ x: 0, y: 0, width: 30, height: 20, config: {} })

const componentTypes = [
  { value: 'clock',   label: '时钟', icon: 'Clock',    color: '#409EFF' },
  { value: 'weather', label: '天气', icon: 'Cloudy',   color: '#67C23A' },
  { value: 'text',    label: '文字', icon: 'Document', color: '#E6A23C' },
  { value: 'image',   label: '图片', icon: 'Picture',  color: '#F56C6C' },
  { value: 'iframe',  label: '网页', icon: 'Link',     color: '#909399' },
]
const defaultConfigs = {
  clock:   { format: 'HH:mm', showDate: true, timezone: 'Asia/Shanghai' },
  weather: { city: 'Beijing', unit: 'C' },
  text:    { content: '文字内容', fontSize: 24, color: '#ffffff', backgroundColor: 'transparent', textAlign: 'center' },
  image:   { url: '', objectFit: 'cover' },
  iframe:  { url: 'https://example.com' },
}

// Computed styles
const canvasStyle = computed(() => ({
  width: canvasWidth.value + 'px',
  height: canvasHeight.value + 'px',
  transform: `scale(${previewScale.value})`,
  transformOrigin: 'top left',
  background: sceneBackground.value,
}))

const dialogCanvasStyle = computed(() => ({
  width: canvasWidth.value + 'px',
  height: canvasHeight.value + 'px',
  transform: `scale(${dialogScale.value})`,
  transformOrigin: 'top left',
  background: sceneBackground.value,
  position: 'relative',
  flexShrink: 0,
}))

// Scale computation
function updatePreviewScale() {
  if (!centerPanelRef.value) return
  const rect = centerPanelRef.value.getBoundingClientRect()
  const headerH = 38
  const padding = 32
  const availW = rect.width - padding
  const availH = rect.height - headerH - padding
  previewScale.value = Math.min(availW / canvasWidth.value, availH / canvasHeight.value, 1)
}

function updateDialogScale() {
  const availW = window.innerWidth * 0.88
  const availH = window.innerHeight * 0.72
  dialogScale.value = Math.min(availW / canvasWidth.value, availH / canvasHeight.value, 1)
}

function openPreview() {
  updateDialogScale()
  previewVisible.value = true
}

// Resolution
function onResolutionChange(key) {
  if (key === 'custom') {
    customWidth.value = canvasWidth.value
    customHeight.value = canvasHeight.value
    return
  }
  const preset = RESOLUTION_PRESETS.find(r => r.key === key)
  if (preset) {
    canvasWidth.value = preset.width
    canvasHeight.value = preset.height
    updatePreviewScale()
  }
}

function applyCustomResolution() {
  if (customWidth.value >= 100 && customHeight.value >= 100) {
    canvasWidth.value = customWidth.value
    canvasHeight.value = customHeight.value
    updatePreviewScale()
  }
}

// Component helpers
function getComponentIcon(type) {
  return { clock: 'Clock', weather: 'Cloudy', text: 'Document', image: 'Picture', iframe: 'Link' }[type] || 'Grid'
}
function getComponentLabel(type) {
  return { clock: '时钟', weather: '天气', text: '文字', image: '图片', iframe: '网页' }[type] || type
}
function getComponentSummary(comp) {
  const cfg = comp.config || {}
  if (comp.type === 'clock')   return cfg.format || 'HH:mm'
  if (comp.type === 'weather') return cfg.city || '未设置城市'
  if (comp.type === 'text')    return (cfg.content || '').slice(0, 20) || '空文字'
  if (comp.type === 'image')   return cfg.url ? cfg.url.split('/').pop() : '未设置URL'
  if (comp.type === 'iframe')  return cfg.url || '未设置URL'
  return ''
}

function getComponentStyle(comp) {
  const pos = comp.position || {}
  return {
    left:   `${pos.x      ?? 0}%`,
    top:    `${pos.y      ?? 0}%`,
    width:  `${pos.width  ?? 30}%`,
    height: `${pos.height ?? 20}%`,
  }
}

function getClockDisplay(comp) {
  const cfg = comp.config || {}
  const format = cfg.format || 'HH:mm'
  const timezone = cfg.timezone || 'Asia/Shanghai'
  const showSeconds = format.includes('ss')
  // Reference clockNow to trigger reactivity every second
  const now = clockNow.value
  const timeOpts = { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }
  if (showSeconds) timeOpts.second = '2-digit'
  const timeStr = now.toLocaleTimeString('zh-CN', timeOpts)
  if (cfg.showDate) {
    const dateStr = now.toLocaleDateString('zh-CN', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    return `${dateStr}\n${timeStr}`
  }
  return timeStr
}

function getTextStyle(comp) {
  const cfg = comp.config || {}
  return {
    fontSize:        `${cfg.fontSize || 24}px`,
    color:           cfg.color || '#ffffff',
    backgroundColor: cfg.backgroundColor || 'transparent',
    textAlign:       cfg.textAlign || 'center',
    width: '100%', height: '100%',
    display: 'flex', alignItems: 'center',
    justifyContent: cfg.textAlign === 'left' ? 'flex-start' : cfg.textAlign === 'right' ? 'flex-end' : 'center',
    padding: '4px', boxSizing: 'border-box',
    wordBreak: 'break-word', whiteSpace: 'pre-wrap',
  }
}

// Selection
function selectComponent(comp) {
  selectedComponent.value = comp
  const pos = comp.position || {}
  editForm.x      = pos.x      ?? 0
  editForm.y      = pos.y      ?? 0
  editForm.width  = pos.width  ?? 30
  editForm.height = pos.height ?? 20
  editForm.config = { ...(comp.config || {}) }
}

// Real-time sync from number inputs to canvas
function syncEditFormToComp() {
  if (!selectedComponent.value) return
  const comp = components.value.find(c => c.id === selectedComponent.value.id)
  if (comp) {
    comp.position = {
      x: editForm.x, y: editForm.y,
      width: editForm.width, height: editForm.height
    }
  }
}

// Drag to move
function startDrag(e, comp) {
  selectComponent(comp)
  dragState.value = {
    compId: comp.id,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startX: comp.position?.x ?? 0,
    startY: comp.position?.y ?? 0,
    canvasRect: previewCanvasRef.value.getBoundingClientRect(),
  }
}

// Resize
function startResize(e, comp, handle) {
  resizeState.value = {
    compId: comp.id,
    handle,
    startClientX: e.clientX,
    startClientY: e.clientY,
    startX:      comp.position?.x      ?? 0,
    startY:      comp.position?.y      ?? 0,
    startWidth:  comp.position?.width  ?? 30,
    startHeight: comp.position?.height ?? 20,
    canvasRect: previewCanvasRef.value.getBoundingClientRect(),
  }
}

function onGlobalMouseMove(e) {
  if (dragState.value) {
    const s = dragState.value
    const dx = (e.clientX - s.startClientX) / s.canvasRect.width  * 100
    const dy = (e.clientY - s.startClientY) / s.canvasRect.height * 100
    const comp = components.value.find(c => c.id === s.compId)
    if (comp) {
      comp.position = {
        ...comp.position,
        x: Math.max(0, Math.min(98, s.startX + dx)),
        y: Math.max(0, Math.min(98, s.startY + dy)),
      }
      if (selectedComponent.value?.id === comp.id) {
        editForm.x = comp.position.x
        editForm.y = comp.position.y
      }
    }
  }

  if (resizeState.value) {
    const s = resizeState.value
    const dx = (e.clientX - s.startClientX) / s.canvasRect.width  * 100
    const dy = (e.clientY - s.startClientY) / s.canvasRect.height * 100
    const comp = components.value.find(c => c.id === s.compId)
    if (comp) {
      let x = s.startX, y = s.startY, w = s.startWidth, h = s.startHeight
      const handle = s.handle
      if (handle.includes('e')) w = Math.max(2, s.startWidth  + dx)
      if (handle.includes('s')) h = Math.max(2, s.startHeight + dy)
      if (handle.includes('w')) { x = s.startX + dx; w = Math.max(2, s.startWidth  - dx) }
      if (handle.includes('n')) { y = s.startY + dy; h = Math.max(2, s.startHeight - dy) }
      comp.position = {
        x: Math.max(0, x),
        y: Math.max(0, y),
        width:  Math.min(100, w),
        height: Math.min(100, h),
      }
      if (selectedComponent.value?.id === comp.id) {
        editForm.x      = comp.position.x
        editForm.y      = comp.position.y
        editForm.width  = comp.position.width
        editForm.height = comp.position.height
      }
    }
  }
}

async function onGlobalMouseUp() {
  if (!dragState.value && !resizeState.value) return
  const compId = dragState.value?.compId || resizeState.value?.compId
  dragState.value = null
  resizeState.value = null
  if (compId) {
    const comp = components.value.find(c => c.id === compId)
    if (comp) {
      try {
        const res = await scenesApi.updateComponent(sceneId.value, comp.id, {
          position: comp.position,
          config: comp.config,
        })
        const updated = res.data.data
        const idx = components.value.findIndex(c => c.id === comp.id)
        if (idx !== -1) {
          components.value[idx] = updated
          if (selectedComponent.value?.id === updated.id) {
            selectedComponent.value = updated
          }
        }
      } catch {
        ElMessage.error('保存位置失败')
      }
    }
  }
}

// Component CRUD
function openAddComponent() { addCompDialogVisible.value = true }

async function addComponent(type) {
  addCompDialogVisible.value = false
  try {
    const res = await scenesApi.createComponent(sceneId.value, {
      type,
      position: { x: 10, y: 10, width: 30, height: 20 },
      config: { ...defaultConfigs[type] },
      style: {},
    })
    const comp = res.data.data
    components.value.push(comp)
    selectComponent(comp)
    ElMessage.success('组件已添加')
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '添加失败')
  }
}

async function applyComponentEdit() {
  if (!selectedComponent.value) return
  const updates = {
    position: { x: editForm.x, y: editForm.y, width: editForm.width, height: editForm.height },
    config: { ...editForm.config },
  }
  try {
    const res = await scenesApi.updateComponent(sceneId.value, selectedComponent.value.id, updates)
    const updated = res.data.data
    const idx = components.value.findIndex(c => c.id === selectedComponent.value.id)
    if (idx !== -1) {
      components.value[idx] = updated
      selectedComponent.value = updated
    }
    ElMessage.success('已应用更改')
  } catch (error) {
    ElMessage.error(error.response?.data?.error || '更新失败')
  }
}

async function deleteComponent(comp) {
  try {
    await ElMessageBox.confirm('确定要删除此组件吗？', '确认删除', {
      confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning',
    })
    await scenesApi.deleteComponent(sceneId.value, comp.id)
    components.value = components.value.filter(c => c.id !== comp.id)
    if (selectedComponent.value?.id === comp.id) selectedComponent.value = null
    ElMessage.success('组件已删除')
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(error.response?.data?.message || '删除失败')
  }
}

async function saveScene() {
  saving.value = true
  try {
    const preset = RESOLUTION_PRESETS.find(r => r.key === resolutionKey.value)
    await scenesApi.update(sceneId.value, {
      name: sceneName.value,
      description: sceneDescription.value,
      config: { resolution: { width: canvasWidth.value, height: canvasHeight.value }, backgroundColor: sceneBackground.value },
    })
    ElMessage.success('画面已保存')
  } catch (error) {
    ElMessage.error(error.response?.data?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function loadScene() {
  loading.value = true
  try {
    const [sceneRes, compRes] = await Promise.all([
      scenesApi.get(sceneId.value),
      scenesApi.getComponents(sceneId.value),
    ])
    const scene = sceneRes.data.data
    sceneName.value = scene.name || ''
    sceneDescription.value = scene.description || ''

    // Restore background color
    if (scene.config?.backgroundColor) {
      sceneBackground.value = scene.config.backgroundColor
    }

    // Restore resolution
    const resolution = scene.config?.resolution
    if (resolution?.width && resolution?.height) {
      canvasWidth.value = resolution.width
      canvasHeight.value = resolution.height
      const matchKey = RESOLUTION_PRESETS.find(r => r.width === resolution.width && r.height === resolution.height)?.key
      if (matchKey) {
        resolutionKey.value = matchKey
      } else {
        resolutionKey.value = 'custom'
        customWidth.value = resolution.width
        customHeight.value = resolution.height
      }
    }

    components.value = compRes.data.data || []
  } catch (error) {
    ElMessage.error('加载画面失败')
  } finally {
    loading.value = false
    updatePreviewScale()
  }
}

// Lifecycle
let resizeObserver = null
let clockTimer = null

onMounted(() => {
  loadScene()
  resizeObserver = new ResizeObserver(updatePreviewScale)
  if (centerPanelRef.value) resizeObserver.observe(centerPanelRef.value)
  clockTimer = setInterval(() => { clockNow.value = new Date() }, 1000)
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  clearInterval(clockTimer)
})
</script>

<style scoped>
.scene-editor {
  height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  margin: -24px;
  user-select: none;
}

.editor-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #ffffff;
  border-bottom: 1px solid #e8eaec;
  flex-shrink: 0;
  gap: 12px;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.topbar-right {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  align-items: center;
}

.title-input { max-width: 280px; }

.bg-picker-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}
.bg-label {
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
}

.editor-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* Left panel */
.left-panel {
  width: 210px;
  background: #ffffff;
  border-right: 1px solid #e8eaec;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

/* Right panel */
.right-panel {
  width: 280px;
  background: #ffffff;
  border-left: 1px solid #e8eaec;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow-y: auto;
}

/* Center panel */
.center-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #2c2c2c;
  overflow: hidden;
  min-width: 0;
}

.panel-header {
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  background: #f5f7fa;
  border-bottom: 1px solid #e8eaec;
  flex-shrink: 0;
}

.canvas-header {
  background: #363636;
  color: #aaa;
  display: flex;
  align-items: center;
  gap: 8px;
}

.canvas-hint {
  font-weight: 400;
  font-size: 12px;
  color: #666;
}

/* Component list */
.component-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.component-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s;
  margin-bottom: 3px;
}
.component-item:hover { background: #f0f7ff; }
.component-item.active { background: #ecf5ff; border: 1px solid #409EFF40; }

.comp-icon {
  width: 26px; height: 26px;
  background: #f0f2f5;
  border-radius: 5px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.comp-info { flex: 1; min-width: 0; }
.comp-type { font-size: 12px; font-weight: 600; color: #303133; }
.comp-name { font-size: 11px; color: #909399; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.comp-actions { opacity: 0; transition: opacity 0.15s; }
.component-item:hover .comp-actions { opacity: 1; }

/* Canvas */
.preview-wrapper {
  flex: 1;
  overflow: hidden;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 16px;
}

.preview-canvas {
  position: relative;
  flex-shrink: 0;
  border: 1px solid #555;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  cursor: default;
}

.preview-component {
  position: absolute;
  border: 1px dashed rgba(255,255,255,0.25);
  cursor: move;
  overflow: visible;
  box-sizing: border-box;
}
.preview-component:hover { border-color: rgba(64, 158, 255, 0.7); }
.preview-component.is-selected {
  border: 2px solid #409EFF;
  box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.25);
}

.comp-preview-content {
  width: 100%; height: 100%;
  overflow: hidden;
  pointer-events: none;
}

.comp-placeholder {
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 4px;
  color: rgba(255,255,255,0.5);
  font-size: 11px;
  background: rgba(255,255,255,0.05);
}

.text-preview {
  overflow: hidden;
}

.clock-preview {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  flex-direction: column;
  white-space: pre;
  color: #ffffff;
  font-size: 2.5em;
  font-weight: 300;
  font-family: 'Courier New', monospace;
}

/* Resize handles */
.resize-handle {
  position: absolute;
  width: 8px;
  height: 8px;
  background: #409EFF;
  border: 1px solid #fff;
  border-radius: 50%;
  z-index: 20;
}
.handle-nw { top: -4px;           left: -4px;            cursor: nw-resize; }
.handle-n  { top: -4px;           left: calc(50% - 4px); cursor: n-resize; }
.handle-ne { top: -4px;           right: -4px;           cursor: ne-resize; }
.handle-w  { top: calc(50% - 4px); left: -4px;           cursor: w-resize; }
.handle-e  { top: calc(50% - 4px); right: -4px;          cursor: e-resize; }
.handle-sw { bottom: -4px;        left: -4px;            cursor: sw-resize; }
.handle-s  { bottom: -4px;        left: calc(50% - 4px); cursor: s-resize; }
.handle-se { bottom: -4px;        right: -4px;           cursor: se-resize; }

/* Right panel properties */
.property-editor {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prop-section { margin-bottom: 14px; }

.prop-section-title {
  font-size: 11px;
  font-weight: 600;
  color: #909399;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
  padding-bottom: 5px;
  border-bottom: 1px solid #f2f6fc;
}

.full-width { width: 100%; }

.prop-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

/* Add component dialog */
.comp-type-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.comp-type-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 8px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 13px;
  color: #606266;
}
.comp-type-item:hover {
  border-color: #409EFF;
  background-color: #ecf5ff;
  color: #409EFF;
}

/* Preview dialog */
.preview-dialog-body {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  background: #1a1a1a;
  min-height: 300px;
}

.preview-dialog-wrapper {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  width: 100%;
}

.preview-dialog-comp {
  position: absolute;
  overflow: hidden;
  box-sizing: border-box;
}

.dialog-clock {
  font-size: 3em;
  font-weight: 300;
}
.dialog-weather,
.dialog-iframe {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: rgba(255,255,255,0.8);
  font-size: 1.2em;
}
</style>
