<template>
  <div class="card" v-if="connected">
    <div class="card-header">
      导航控制
    </div>
    <div class="card-body">
      <!-- 地图选择 -->
      <div class="nav-section">
        <label class="nav-label">选择地图</label>
        <div class="map-select-group">
          <select
            class="map-select"
            v-model="selectedMap"
            :disabled="isNavigating || isLoading"
          >
            <option value="" disabled>— 请选择地图 —</option>
            <option v-for="m in maps" :key="m.path" :value="m.path">
              {{ m.name }}
            </option>
          </select>
          <button class="btn-icon" @click="loadMaps" :disabled="isLoading" title="刷新列表">
            <span :class="['refresh-icon', { spinning: isLoading }]">↻</span>
          </button>
        </div>
        <div v-if="maps.length === 0 && !isLoading" class="nav-hint">
          暂无地图，请先完成建图并保存
        </div>
      </div>

      <!-- 启动/停止按钮 -->
      <div class="nav-section">
        <button
          v-if="!isNavigating"
          class="btn btn-connect nav-btn"
          @click="openDriveTypeDialog"
          :disabled="isLoading || !selectedMap"
        >
          {{ isLoading ? '正在启动...' : '开始导航' }}
        </button>
        <div v-else class="nav-action-row">
          <button
            class="btn btn-disconnect nav-btn"
            @click="shutdownNavigation"
            :disabled="isLoading"
          >
            {{ isLoading ? '处理中...' : '关闭导航' }}
          </button>
        </div>
      </div>

      <!-- 导航状态 -->
      <div class="nav-status">
        <span v-if="isNavigating" class="status-nav-active">● 导航节点运行中</span>
        <span v-else class="status-nav-idle">○ 导航节点未运行</span>
      </div>

      <!-- 初始位置设置 (仅导航运行中显示) -->
      <div v-if="isNavigating" class="nav-section mt-2">
        <button
          class="nav-btn"
          :class="isSettingPose ? 'btn-pose-active' : 'btn-pose'"
          @click="togglePoseMode"
        >
          {{ isSettingPose ? '正在设置... (按住拖动)' : '设置初始位置' }}
        </button>
      </div>

      <!-- 多点导航 -->
      <div v-if="isNavigating && !isSettingPose" class="nav-section mt-2">
        <button
          class="nav-btn"
          :class="multiPointMode ? 'btn-waypoint-active' : 'btn-waypoint'"
          @click="toggleMultiPointMode"
        >
          {{ multiPointMode ? '多点导航: 已开启' : '多点导航: 已关闭' }}
        </button>
        <div v-if="multiPointMode" class="waypoint-row">
          <span class="waypoint-count">队列点位: {{ waypointCount }}</span>
          <button class="btn-clear-waypoints" @click="clearWaypoints" :disabled="waypointCount === 0">
            清空
          </button>
        </div>
      </div>

      <!-- 操作提示 -->
      <div v-if="isNavigating && !isSettingPose" class="nav-hint goal-hint" style="margin-top:4px">
        {{ multiPointMode ? '双击地图连续添加航点，系统将自动依次执行' : '双击地图设定导航目标点' }}
      </div>
      <div v-if="isSettingPose" class="nav-hint pose-hint">
        🟡 按住地图拖动以设定位置和朝向
      </div>

      <!-- 错误信息 -->
      <div v-if="errorMsg" class="error-message mt-2">
        {{ errorMsg }}
      </div>
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="showDriveTypeDialog"
      class="drive-dialog-backdrop"
      role="presentation"
      @click.self="showDriveTypeDialog = false"
    >
      <div class="drive-dialog" role="dialog" aria-modal="true" aria-labelledby="drive-dialog-title">
        <div id="drive-dialog-title" class="drive-dialog-title">选择导航底盘</div>
        <div class="drive-dialog-hint">本次导航将加载对应的速度和轨迹规划参数</div>
        <div class="drive-options">
          <button class="drive-option drive-option-diff" @click="startNavigation('diff')">
            <span class="drive-option-title">差速轮</span>
            <span class="drive-option-description">vx + wz，横向速度 vy 始终为 0</span>
          </button>
          <button class="drive-option drive-option-omni" @click="startNavigation('omni')">
            <span class="drive-option-title">麦克纳姆轮（全向轮）</span>
            <span class="drive-option-description">vx + vy + wz，支持横向移动</span>
          </button>
        </div>
        <button class="drive-dialog-cancel" @click="showDriveTypeDialog = false">取消</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  connected: Boolean,
  multiPointMode: {
    type: Boolean,
    default: false
  },
  waypointCount: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits([
  'update:isNavigating',
  'update:isSettingPose',
  'update:multiPointMode',
  'navigationStarted',
  'clear-waypoints'
])

const isNavigating = ref(false)
const isLoading = ref(false)
const errorMsg = ref('')
const maps = ref([])
const selectedMap = ref('')
const isSettingPose = ref(false)
const multiPointMode = ref(props.multiPointMode)
const showDriveTypeDialog = ref(false)

const API_BASE = `http://${window.location.hostname}:3000/api`
let statusTimer = null

async function loadMaps() {
  isLoading.value = true
  try {
    const res = await fetch(`${API_BASE}/list_maps`)
    const data = await res.json()
    maps.value = data.maps || []
    if (maps.value.length > 0 && !selectedMap.value) {
      // 自动选择最新的地图（最后一个，按字母排序，时间戳格式会是最新的）
      selectedMap.value = maps.value[maps.value.length - 1].path
    }
  } catch (err) {
    console.error('加载地图列表失败:', err)
    errorMsg.value = '无法加载地图列表'
  } finally {
    isLoading.value = false
  }
}

async function checkStatus() {
  try {
    const res = await fetch(`${API_BASE}/navigation_status`)
    const data = await res.json()
    isNavigating.value = data.isRunning
    emit('update:isNavigating', data.isRunning)
    if (!data.isRunning) errorMsg.value = ''
  } catch (err) {
    console.error('获取导航状态失败:', err)
  }
}

function openDriveTypeDialog() {
  if (!selectedMap.value) {
    errorMsg.value = '请先选择一张地图'
    return
  }
  errorMsg.value = ''
  showDriveTypeDialog.value = true
}

async function startNavigation(driveType) {
  if (!['diff', 'omni'].includes(driveType)) return
  showDriveTypeDialog.value = false
  isLoading.value = true
  errorMsg.value = ''
  try {
    const res = await fetch(`${API_BASE}/start_navigation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapPath: selectedMap.value, driveType })
    })
    const data = await res.json()
    if (data.success) {
      isNavigating.value = true
      emit('update:isNavigating', true)
      emit('navigationStarted')
    } else {
      errorMsg.value = data.error || '启动失败'
    }
  } catch (err) {
    errorMsg.value = '无法连接到本地控制服务'
  } finally {
    isLoading.value = false
  }
}

function exitNavigationModes() {
  if (isSettingPose.value) {
    isSettingPose.value = false
    emit('update:isSettingPose', false)
  }
  if (multiPointMode.value) {
    multiPointMode.value = false
    emit('update:multiPointMode', false)
  }
  emit('clear-waypoints')
}

async function shutdownNavigation() {
  isLoading.value = true
  errorMsg.value = ''
  exitNavigationModes()
  try {
    const res = await fetch(`${API_BASE}/stop_navigation`, { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      isNavigating.value = false
      emit('update:isNavigating', false)
    } else {
      errorMsg.value = data.error || '关闭失败'
    }
  } catch (err) {
    errorMsg.value = '无法连接到本地控制服务'
  } finally {
    isLoading.value = false
  }
}

function togglePoseMode() {
  isSettingPose.value = !isSettingPose.value
  emit('update:isSettingPose', isSettingPose.value)
}

function toggleMultiPointMode() {
  multiPointMode.value = !multiPointMode.value
  emit('update:multiPointMode', multiPointMode.value)
  if (!multiPointMode.value) {
    emit('clear-waypoints')
  }
}

function clearWaypoints() {
  emit('clear-waypoints')
}

watch(() => props.multiPointMode, (value) => {
  multiPointMode.value = value
})

onMounted(async () => {
  await loadMaps()
  await checkStatus()
  statusTimer = setInterval(checkStatus, 3000)
})

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer)
})
</script>

<style scoped>
.nav-section {
  margin-bottom: 12px;
}

.nav-label {
  display: block;
  font-size: 0.78rem;
  color: var(--text-muted);
  text-transform: uppercase;
    margin-bottom: 6px;
}

.map-select-group {
  display: flex;
  gap: 6px;
  align-items: center;
}

.map-select {
  flex: 1;
  padding: 8px 10px;
  background: #ffffff;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  outline: none;
  cursor: pointer;
  transition: var(--transition);
}

.map-select:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
}

.map-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.map-select option {
  background: #ffffff;
  color: #0f172a;
}

.btn-icon {
  width: 34px;
  height: 34px;
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: var(--transition);
  flex-shrink: 0;
}

.btn-icon:hover {
  background: rgba(99, 102, 241, 0.2);
  color: var(--text-primary);
}

.refresh-icon {
  display: inline-block;
  transition: transform 0.5s ease;
}

.refresh-icon.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.nav-btn {
  width: 100%;
  font-weight: 600;
  padding: 12px;
}

.nav-status {
  margin-top: 4px;
  font-size: 0.82rem;
}

.status-nav-active {
  color: #15803d;
}

.status-nav-idle {
  color: #64748b;
}

.nav-hint {
  margin-top: 6px;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.goal-hint {
  color: #2563eb;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.2);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
}

.pose-hint {
  color: #b45309;
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.25);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
}

.btn-pose {
  width: 100%;
  padding: 10px;
  font-weight: 600;
  font-size: 0.82rem;
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.3);
  color: #b45309;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition);
}

.btn-pose:hover {
  background: rgba(251, 191, 36, 0.2);
}

.btn-pose-active {
  width: 100%;
  padding: 10px;
  font-weight: 600;
  font-size: 0.82rem;
  background: rgba(251, 191, 36, 0.25);
  border: 1px solid #d97706;
  color: #b45309;
  border-radius: var(--radius-sm);
  cursor: pointer;
  animation: pose-pulse 1.2s ease-in-out infinite;
}

.btn-waypoint {
  width: 100%;
  padding: 10px;
  font-weight: 600;
  font-size: 0.82rem;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.35);
  color: #15803d;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: var(--transition);
}

.btn-waypoint:hover {
  background: rgba(34, 197, 94, 0.2);
}

.btn-waypoint-active {
  width: 100%;
  padding: 10px;
  font-weight: 600;
  font-size: 0.82rem;
  background: rgba(34, 197, 94, 0.25);
  border: 1px solid #16a34a;
  color: #15803d;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.waypoint-row {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.waypoint-count {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.btn-clear-waypoints {
  padding: 4px 10px;
  font-size: 0.75rem;
  border-radius: 6px;
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: rgba(239, 68, 68, 0.15);
  color: #dc2626;
  cursor: pointer;
}

.btn-clear-waypoints:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

@keyframes pose-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.4); }
  50% { box-shadow: 0 0 0 6px rgba(251, 191, 36, 0); }
}

.mt-2 { margin-top: 8px; }

.drive-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.58);
  backdrop-filter: blur(4px);
}

.nav-action-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}


.drive-dialog {
  width: min(440px, 100%);
  padding: 22px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.28);
}

.drive-dialog-title {
  color: #0f172a;
  font-size: 1.12rem;
  font-weight: 700;
}

.drive-dialog-hint {
  margin-top: 6px;
  color: #64748b;
  font-size: 0.82rem;
  line-height: 1.5;
}

.drive-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 18px;
}

.drive-option {
  display: flex;
  min-height: 108px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 7px;
  padding: 16px;
  border: 1px solid transparent;
  border-radius: 12px;
  text-align: left;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.drive-option:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
}

.drive-option-diff {
  color: #9a3412;
  border-color: rgba(249, 115, 22, 0.3);
  background: rgba(255, 237, 213, 0.72);
}

.drive-option-omni {
  color: #1d4ed8;
  border-color: rgba(59, 130, 246, 0.3);
  background: rgba(219, 234, 254, 0.72);
}

.drive-option-title {
  font-size: 1rem;
  font-weight: 700;
}

.drive-option-description {
  color: #475569;
  font-size: 0.78rem;
  line-height: 1.45;
}

.drive-dialog-cancel {
  width: 100%;
  margin-top: 14px;
  padding: 9px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 9px;
  color: #475569;
  background: #f8fafc;
  cursor: pointer;
}

@media (max-width: 480px) {
  .drive-options {
    grid-template-columns: 1fr;
  }

  .drive-option {
    min-height: 86px;
  }
}
</style>
