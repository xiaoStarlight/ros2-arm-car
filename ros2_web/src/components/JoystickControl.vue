<template>
  <div class="card">
    <div class="card-header motion-control-header">
      <span>摇杆 / 键盘控制</span>
      <button
        type="button"
        class="speed-settings-toggle"
        :aria-expanded="showSettings"
        @click="toggleSettings"
      >
        设置
      </button>
    </div>
    <div class="card-body joystick-container">
      <form v-if="showSettings" class="speed-settings-panel" @submit.prevent="applySpeedSettings">
        <label class="speed-setting-field">
          <span>线速度</span>
          <span class="speed-setting-input">
            <input
              v-model.number="linearSpeedDraft"
              type="number"
              min="0.01"
              max="3"
              step="0.01"
              required
            >
            <span>m/s</span>
          </span>
        </label>
        <label class="speed-setting-field">
          <span>角速度</span>
          <span class="speed-setting-input">
            <input
              v-model.number="angularSpeedDraft"
              type="number"
              min="0.01"
              max="6"
              step="0.1"
              required
            >
            <span>rad/s</span>
          </span>
        </label>
        <button type="submit" class="speed-settings-apply">应用</button>
      </form>

      <div class="joystick-canvas-wrapper">
        <canvas
          ref="canvasRef"
          :width="canvasSize"
          :height="canvasSize"
          @mousedown="onStart"
          @touchstart.prevent="onTouchStart"
        />
      </div>

      <div class="velocity-display">
        <div class="velocity-item">
          <span class="label">线速度 m/s</span>
          <span class="value">{{ linearDisplay }}</span>
        </div>
        <div class="velocity-item">
          <span class="label">角速度 rad/s</span>
          <span class="value">{{ angularDisplay }}</span>
        </div>
      </div>

      <div class="keyboard-hint" aria-label="键盘控制说明">
        <div><kbd>Q</kbd><span>左移</span></div>
        <div><kbd>W</kbd><span>前进</span></div>
        <div><kbd>E</kbd><span>右移</span></div>
        <div><kbd>A</kbd><span>左转</span></div>
        <div><kbd>S</kbd><span>后退</span></div>
        <div><kbd>D</kbd><span>右转</span></div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  connected: Boolean,
  maxLinearSpeed: {
    type: Number,
    default: 0.15
  },
  maxAngularSpeed: {
    type: Number,
    default: 0.8
  }
})

const emit = defineEmits(['velocity-change', 'speed-settings-change'])

// ---- 配置 ----
const canvasSize = 220
const baseRadius = 90
const knobRadius = 30
const sendRate = 100         // ms (10 Hz)

// ---- 状态 ----
const canvasRef = ref(null)
const knobX = ref(0) // 相对于中心的偏移 (-1 ~ 1)
const knobY = ref(0)
const showSettings = ref(false)
const linearSpeedDraft = ref(props.maxLinearSpeed)
const angularSpeedDraft = ref(props.maxAngularSpeed)
let isDragging = false
let animationId = null
let sendTimer = null

const linearDisplay = computed(() => (knobY.value * -props.maxLinearSpeed).toFixed(2))
const angularDisplay = computed(() => (knobX.value * -props.maxAngularSpeed).toFixed(2))

function toggleSettings() {
  linearSpeedDraft.value = props.maxLinearSpeed
  angularSpeedDraft.value = props.maxAngularSpeed
  showSettings.value = !showSettings.value
}

function applySpeedSettings() {
  emit('speed-settings-change', {
    linear: linearSpeedDraft.value,
    angular: angularSpeedDraft.value
  })
  showSettings.value = false
}

// ---- 绘制 ----
function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const cx = canvasSize / 2
  const cy = canvasSize / 2

  ctx.clearRect(0, 0, canvasSize, canvasSize)

  // 底座外圈
  const outerGrad = ctx.createRadialGradient(cx, cy, baseRadius - 20, cx, cy, baseRadius)
  outerGrad.addColorStop(0, 'rgba(99, 102, 241, 0.08)')
  outerGrad.addColorStop(1, 'rgba(99, 102, 241, 0.02)')
  ctx.beginPath()
  ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2)
  ctx.fillStyle = outerGrad
  ctx.fill()
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)'
  ctx.lineWidth = 2
  ctx.stroke()

  // 十字参考线
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.1)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx, cy - baseRadius + 10)
  ctx.lineTo(cx, cy + baseRadius - 10)
  ctx.moveTo(cx - baseRadius + 10, cy)
  ctx.lineTo(cx + baseRadius - 10, cy)
  ctx.stroke()

  // 摇杆手柄
  const handleX = cx + knobX.value * (baseRadius - knobRadius)
  const handleY = cy + knobY.value * (baseRadius - knobRadius)

  // 手柄主体
  const knobGrad = ctx.createRadialGradient(
    handleX - 5, handleY - 5, 2,
    handleX, handleY, knobRadius
  )
  knobGrad.addColorStop(0, '#818cf8')
  knobGrad.addColorStop(0.7, '#6366f1')
  knobGrad.addColorStop(1, '#4f46e5')
  ctx.beginPath()
  ctx.arc(handleX, handleY, knobRadius, 0, Math.PI * 2)
  ctx.fillStyle = knobGrad
  ctx.fill()

  // 手柄高光
  ctx.beginPath()
  ctx.arc(handleX - 6, handleY - 6, knobRadius * 0.35, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)'
  ctx.fill()

  // 活动时的发光效果
  if (isDragging) {
    ctx.beginPath()
    ctx.arc(handleX, handleY, knobRadius + 6, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)'
    ctx.lineWidth = 3
    ctx.stroke()
  }
}

// ---- 触摸/鼠标事件 ----
function getCanvasPos(event) {
  const canvas = canvasRef.value
  if (!canvas) return { dx: 0, dy: 0 }
  const rect = canvas.getBoundingClientRect()
  const cx = canvasSize / 2
  const cy = canvasSize / 2
  const scaleX = canvasSize / rect.width
  const scaleY = canvasSize / rect.height

  // 兼容鼠标和触摸事件
  const clientX = event.clientX || (event.touches ? event.touches[0].clientX : 0)
  const clientY = event.clientY || (event.touches ? event.touches[0].clientY : 0)

  const x = (clientX - rect.left) * scaleX
  const y = (clientY - rect.top) * scaleY

  // 归一化到 -1 ~ 1
  let dx = (x - cx) / (baseRadius - knobRadius)
  let dy = (y - cy) / (baseRadius - knobRadius)

  // 限制在圆内
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist > 1) {
    dx /= dist
    dy /= dist
  }

  return { dx, dy }
}

function onStart(event) {
  beginControl(event)
  if (!isDragging) return
  
  // 注册全局监听，保证移出 Canvas 也能继续控制
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onEnd)
}

function onMove(event) {
  if (!isDragging) return
  const { dx, dy } = getCanvasPos(event)
  knobX.value = dx
  knobY.value = dy
  draw()
}

function onEnd() {
  const wasDragging = isDragging
  isDragging = false
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', onEnd)
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onEnd)
  stopSendLoop()
  if (wasDragging && props.connected) emitStop()
  // 弹簧回中动画
  animateReturn()
}

function onTouchStart(event) {
  beginControl(event.touches[0])
  if (!isDragging) return
  
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('touchend', onEnd)
}

function onTouchMove(event) {
  if (!isDragging) return
  const { dx, dy } = getCanvasPos(event.touches[0])
  knobX.value = dx
  knobY.value = dy
  draw()
}

// ---- 回中动画 ----
function animateReturn() {
  const decay = 0.85
  function step() {
    knobX.value *= decay
    knobY.value *= decay

    if (Math.abs(knobX.value) < 0.01 && Math.abs(knobY.value) < 0.01) {
      knobX.value = 0
      knobY.value = 0
      draw()
      return
    }

    draw()
    animationId = requestAnimationFrame(step)
  }
  if (animationId) cancelAnimationFrame(animationId)
  step()
}

function emitCurrentVelocity() {
  const linearX = knobY.value * -props.maxLinearSpeed
  const angularZ = knobX.value * -props.maxAngularSpeed
  emit('velocity-change', { linearX, linearY: 0, angularZ })
}

function emitStop() {
  emit('velocity-change', { linearX: 0, linearY: 0, angularZ: 0 })
}

// ---- 拖动摇杆时定时发送速度指令 (10 Hz) ----
function startSendLoop() {
  if (sendTimer || !props.connected) return
  emitCurrentVelocity()
  sendTimer = setInterval(() => {
    if (!isDragging || !props.connected) {
      stopSendLoop()
      return
    }
    emitCurrentVelocity()
  }, sendRate)
}

function stopSendLoop() {
  if (sendTimer) {
    clearInterval(sendTimer)
    sendTimer = null
  }
}

function beginControl(event) {
  if (!props.connected) return
  if (animationId) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
  isDragging = true
  const { dx, dy } = getCanvasPos(event)
  knobX.value = dx
  knobY.value = dy
  draw()
  startSendLoop()
}

// 连接断开时停止发送，避免空闲状态持续占用 /cmd_vel
watch(() => props.connected, (val) => {
  if (!val) {
    stopSendLoop()
    isDragging = false
    knobX.value = 0
    knobY.value = 0
    draw()
  }
})

onMounted(() => {
  draw()
})

onUnmounted(() => {
  stopSendLoop()
  if (animationId) cancelAnimationFrame(animationId)
})
</script>
