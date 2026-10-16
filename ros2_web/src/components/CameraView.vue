<template>
  <div class="card camera-card">
    <div class="card-header camera-header">
      <span>摄像头</span>
      <button class="tracking-toggle" type="button" :aria-pressed="trackingEnabled" @click="toggleTracking">颜色跟随</button>
      <span class="camera-source-badge" :class="sourceState">
        {{ sourceStatusText }}
      </span>
    </div>

    <div class="card-body camera-body">
      <div class="camera-frame" :class="{ 'is-webrtc': activeMode === 'webrtc' }">
        <video
          v-if="activeMode === 'webrtc' && activeUrl"
          ref="videoElement"
          :key="streamKey"
          class="camera-stream camera-webrtc"
          title="WebRTC 摄像头画面"
          autoplay muted playsinline controls
          @playing="onVideoPlaying"
          @waiting="onVideoWaiting"
        ></video>

        <img
          v-else-if="activeMode === 'image' && activeUrl"
          ref="imageElement"
          :key="streamKey"
          class="camera-stream camera-image"
          :src="imageDisplayUrl"
          :crossorigin="trackingEnabled ? 'anonymous' : undefined"
          alt="摄像头画面"
          @load="onImageLoaded"
          @error="onImageError"
        >

        <canvas v-show="trackingEnabled" ref="overlayElement" class="tracking-overlay" aria-label="识别目标红框和画面中心"></canvas>

        <div v-if="showPlaceholder" class="camera-placeholder">
          {{ cameraMessage }}
        </div>
      </div>

      <section v-if="trackingEnabled" class="tracking-panel">
        <strong>纯色方块识别与居中</strong>
        <div class="color-options" role="group" aria-label="需要识别的颜色">
          <button v-for="color in CUBE_COLORS" :key="color.value" type="button"
            :class="{ selected: selectedColor === color.value }" :aria-pressed="selectedColor === color.value"
            @click="selectColor(color.value)">
            <i :style="{ background: color.swatch }"></i>{{ color.label }}
          </button>
        </div>
        <div class="tracking-joints">
          <label>左右通道<strong>1：角度增大向左</strong></label>
          <label>上下通道<strong>4：角度增大向下</strong></label>
        </div>
        <div class="tracking-actions">
          <button type="button" :disabled="!canFollow || following" @click="startFollowing">开始跟随</button>
          <button type="button" :disabled="!following" @click="stopFollowing('跟随已停止，识别仍在运行')">停止跟随</button>
        </div>
        <div class="tracking-status" role="status">{{ trackingStatus }}</div>
        <div class="tracking-hint">每步 10°，同向大偏差时约 0.8 秒更新一次，换向或近中心时约 1.2 秒等待反馈；实际节奏随视频采样变化。</div>
        <div class="tracking-hint">先手动向通道 1、4 发送合适的角度。目标位置经过轻量滤波，减少抖动和频繁切换关节；限位处只移动到边界。</div>
        <div class="tracking-hint">固定 10° 步长跨过中心时保留较近位置，避免来回摆动；方块再次移动后继续调整。</div>
        <div class="tracking-hint">找不到目标时保持识别、暂停发令，目标重现后自动继续；摄像头画面丢失时关闭识别。红框按颜色及紧凑轮廓筛选。</div>
      </section>
      <div v-if="recognitionNotice && !trackingEnabled" class="tracking-status" role="status">{{ recognitionNotice }}</div>

      <div class="camera-source-info">
        <span>{{ activeSourceText }}</span>
        <span>{{ autoMode ? '自动检测' : '手动选择' }}</span>
      </div>

      <div class="camera-controls">
        <input
          v-model.trim="draftUrl"
          class="url-input camera-url-input"
          type="text"
          placeholder="HTTP/MJPEG 或 WebRTC 地址"
          @input="onUrlInput"
          @keyup.enter="applyUrl"
        >
        <button class="btn camera-btn" type="button" @click="applyUrl">应用</button>
        <button class="btn camera-btn camera-btn-secondary" type="button" @click="enableAutoDetect">自动</button>
        <button class="btn camera-btn camera-btn-secondary" type="button" @click="reloadStream">刷新</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { openCameraVideo } from '../composables/useCameraVideo.js'
import { ColorCubeDetector, CUBE_COLORS } from '../vision/colorTracker.js'
import { ArmColorFollower } from '../vision/armFollower.js'
import { getServoCommandError } from '../config/servoLimits.js'

const props = defineProps({
  defaultUrl: { type: String, default: '' },
  discoveryUrl: { type: String, default: '' },
  servoReady: Boolean,
  motionBlocked: Boolean,
  lastSentAngles: { type: Object, default: () => ({}) },
  stopToken: { type: Number, default: 0 }
})
const emit = defineEmits(['servo-command', 'following-change'])

const draftUrl = ref(props.defaultUrl)
const activeUrl = ref('')
const activeMode = ref('')
const activePath = ref('')
const autoMode = ref(true)
const streamKey = ref(0)
const streamLoaded = ref(false)
const sourceState = ref('detecting')
const cameraMessage = ref('正在检测摄像头通道...')
let discoveryTimer = null
const videoElement = ref(null), imageElement = ref(null), overlayElement = ref(null)
const trackingEnabled = ref(false), following = ref(false), selectedColor = ref('red')
const horizontalChannel = ref(1), verticalChannel = ref(4)
const trackingStatus = ref('请选择方块颜色')
const stopReason = ref('')
const recognitionNotice = ref('')
const detector = new ColorCubeDetector(), follower = new ArmColorFollower()
let videoSession = null, videoGeneration = 0, trackingTimer = null, resizeObserver = null
let sampleCanvas = null, sampleContext = null, target = null, lastFrame = -1, lastFreshAt = 0, lastVideoTime = -1
const canFollow = computed(() => props.servoReady && !props.motionBlocked && streamLoaded.value && activeMode.value === 'webrtc' &&
  horizontalChannel.value !== verticalChannel.value &&
  !getServoCommandError(horizontalChannel.value, props.lastSentAngles[horizontalChannel.value]) &&
  !getServoCommandError(verticalChannel.value, props.lastSentAngles[verticalChannel.value]))

const showPlaceholder = computed(() => {
  if (!activeUrl.value) return true
  return !streamLoaded.value
})

const activeSourceText = computed(() => {
  if (activeMode.value === 'webrtc') return `WebRTC${activePath.value ? ` · ${activePath.value}` : ''}`
  if (activeMode.value === 'image') return 'HTTP / MJPEG'
  return '尚未选择通道'
})

const sourceStatusText = computed(() => {
  if (sourceState.value === 'online') return '在线'
  if (sourceState.value === 'fallback') return 'HTTP'
  if (sourceState.value === 'error') return '异常'
  return '检测中'
})

const imageDisplayUrl = computed(() => {
  if (!activeUrl.value) return ''
  const separator = activeUrl.value.includes('?') ? '&' : '?'
  return `${activeUrl.value}${separator}_=${streamKey.value}`
})

async function connectVideo() {
  const generation = ++videoGeneration
  videoSession?.close(); videoSession = null
  stopFollowing('视频正在重新连接')
  if (activeMode.value !== 'webrtc' || !activeUrl.value) return
  await nextTick()
  const video = videoElement.value
  if (!video) return
  try {
    const session = await openCameraVideo(video, activeUrl.value, error => {
      if (generation !== videoGeneration) return
      streamLoaded.value = false; sourceState.value = 'error'; cameraMessage.value = error
      stopRecognition('摄像头视频不可用，颜色识别已停止')
    })
    if (generation !== videoGeneration) session.close()
    else videoSession = session
  } catch (error) {
    if (generation !== videoGeneration) return
    sourceState.value = 'error'; cameraMessage.value = error.message
    stopRecognition('摄像头视频不可用，颜色识别已停止')
  }
}

function onVideoPlaying() {
  streamLoaded.value = true; sourceState.value = 'online'
  lastFreshAt = performance.now(); lastFrame = -1; lastVideoTime = -1
}
function onVideoWaiting() {
  streamLoaded.value = false; cameraMessage.value = '视频正在缓冲'
  stopRecognition('摄像头画面中断，颜色识别已停止')
}
function stopFollowing(message = '跟随已停止') {
  if (following.value && message) stopReason.value = message
  follower.stop(); following.value = false
  emit('following-change', false)
  if (message) trackingStatus.value = message
}
function stopRecognition(message) {
  if (trackingEnabled.value || following.value) recognitionNotice.value = message
  stopFollowing(message)
  trackingEnabled.value = false
  if (trackingTimer) clearInterval(trackingTimer)
  trackingTimer = null; target = null; detector.reset()
  nextTick(drawOverlay)
}
function selectColor(color) {
  stopFollowing('识别中，等待所选颜色方块')
  stopReason.value = ''
  selectedColor.value = color; detector.reset(); target = null; drawOverlay()
}
function toggleTracking() {
  trackingEnabled.value = !trackingEnabled.value
  recognitionNotice.value = ''
  stopFollowing(trackingEnabled.value ? '识别中，等待所选颜色方块' : '颜色识别已关闭')
  stopReason.value = ''
  target = null; detector.reset()
  if (activeMode.value === 'image') streamKey.value++
  if (trackingTimer) clearInterval(trackingTimer)
  trackingTimer = trackingEnabled.value ? setInterval(processFrame, 125) : null
  nextTick(drawOverlay)
}
function startFollowing() {
  if (!canFollow.value || performance.now() - lastFreshAt > 600) {
    trackingStatus.value = '请确认摄像头画面正常，并先向通道 1、4 手动发送角度'
    return
  }
  if (!follower.start(horizontalChannel.value, verticalChannel.value)) return
  stopReason.value = ''
  following.value = true; emit('following-change', true)
  trackingStatus.value = target ? '正在确认目标，按实物方向以 10° 连续平滑跟随' : '保持识别，等待所选颜色目标出现'
}
function drawOverlay() {
  const canvas = overlayElement.value
  if (!canvas) return
  const width = canvas.clientWidth, height = canvas.clientHeight
  const dpr = window.devicePixelRatio || 1
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr)
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height)
  if (!trackingEnabled.value) return
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(width / 2 - 10, height / 2); ctx.lineTo(width / 2 + 10, height / 2)
  ctx.moveTo(width / 2, height / 2 - 10); ctx.lineTo(width / 2, height / 2 + 10); ctx.stroke()
  if (!target) return
  const source = activeMode.value === 'webrtc' ? videoElement.value : imageElement.value
  const sourceWidth = source?.videoWidth || source?.naturalWidth || 320
  const sourceHeight = source?.videoHeight || source?.naturalHeight || 240
  const scale = Math.min(width / sourceWidth, height / sourceHeight)
  const viewWidth = sourceWidth * scale, viewHeight = sourceHeight * scale
  const left = (width - viewWidth) / 2 + target.x * viewWidth
  const top = (height - viewHeight) / 2 + target.y * viewHeight
  ctx.strokeStyle = '#ff2222'; ctx.lineWidth = 2
  ctx.strokeRect(left, top, target.width * viewWidth, target.height * viewHeight)
  ctx.fillStyle = '#ff2222'; ctx.font = '12px sans-serif'
  ctx.fillText(CUBE_COLORS.find(color => color.value === selectedColor.value).label, left, Math.max(12, top - 4))
}
function processFrame() {
  if (!trackingEnabled.value || document.hidden) return
  const source = activeMode.value === 'webrtc' ? videoElement.value : imageElement.value
  const width = source?.videoWidth || source?.naturalWidth, height = source?.videoHeight || source?.naturalHeight
  if (!width || !height || (activeMode.value === 'webrtc' && source.readyState < 2)) {
    streamLoaded.value = false
    stopRecognition('没有可读取的摄像头画面，颜色识别已停止'); return
  }
  const now = performance.now()
  if (activeMode.value === 'webrtc') {
    const frames = source.getVideoPlaybackQuality?.().totalVideoFrames
    if ((Number.isFinite(frames) && frames !== lastFrame) || (!Number.isFinite(frames) && source.currentTime !== lastVideoTime)) {
      lastFreshAt = now; lastFrame = frames; lastVideoTime = source.currentTime
      streamLoaded.value = true; sourceState.value = 'online'
    }
    if (now - lastFreshAt > 600) {
      streamLoaded.value = false; sourceState.value = 'error'; cameraMessage.value = '摄像头画面已停止更新'
      stopRecognition('摄像头画面停滞，颜色识别已停止'); return
    }
  }
  try {
    if (!sampleCanvas) { sampleCanvas = document.createElement('canvas'); sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true }) }
    const sampleWidth = 320, sampleHeight = Math.min(240, Math.max(1, Math.round(320 * height / width)))
    if (sampleCanvas.width !== sampleWidth || sampleCanvas.height !== sampleHeight) { sampleCanvas.width = sampleWidth; sampleCanvas.height = sampleHeight }
    sampleContext.drawImage(source, 0, 0, sampleWidth, sampleHeight)
    target = detector.detect(sampleContext.getImageData(0, 0, sampleWidth, sampleHeight), selectedColor.value)
    drawOverlay()
    if (!target) {
      if (following.value) follower.lost()
      trackingStatus.value = '未检测到所选颜色目标，保持识别并等待重新出现'
      return
    }
    if (following.value) {
      trackingStatus.value = follower.update(target, props.lastSentAngles, now, (channel, angle) => {
        let sent = false
        emit('servo-command', { channel, angle, source: 'tracking', onResult: success => { sent = success === true } })
        return sent
      })
      if (!follower.active) { stopReason.value = trackingStatus.value; following.value = false; emit('following-change', false) }
    } else trackingStatus.value = `${stopReason.value ? stopReason.value + '。' : ''}已识别目标，红框标注；可开始跟随`
  } catch (error) {
    target = null; drawOverlay()
    stopRecognition('无法读取摄像头像素，颜色识别已停止；请使用 WebRTC 或支持跨域的 HTTP 画面')
  }
}

function setSource(mode, url, path = '', ready = false) {
  const changed = activeMode.value !== mode || activeUrl.value !== url || activePath.value !== path
  activeMode.value = mode
  activeUrl.value = url
  activePath.value = path
  sourceState.value = mode === 'webrtc' ? (ready ? 'online' : 'detecting') : 'fallback'
  cameraMessage.value = mode === 'webrtc' ? '正在连接 WebRTC 通道...' : '等待摄像头画面...'
  if (changed) {
    streamLoaded.value = false
    streamKey.value += 1
  }
}

function isWebRtcUrl(url) {
  if (!url) return false
  if (!url.includes('://')) return true
  try {
    const parsed = new URL(url)
    return parsed.port === '8889' || /\/whep\/?$/.test(parsed.pathname)
  } catch {
    return false
  }
}

function normalizeManualUrl(url) {
  if (url.includes('://')) return url
  const path = url.replace(/^\/+/, '')
  return `http://${window.location.hostname}:8889/${path}`
}

function applyUrl() {
  if (!draftUrl.value) {
    enableAutoDetect()
    return
  }
  autoMode.value = false
  const mode = isWebRtcUrl(draftUrl.value) ? 'webrtc' : 'image'
  setSource(mode, normalizeManualUrl(draftUrl.value), '', mode !== 'webrtc')
}

function onUrlInput() {
  autoMode.value = false
}

function reloadStream() {
  streamLoaded.value = false
  streamKey.value += 1
  if (autoMode.value) detectStreams()
}

function enableAutoDetect() {
  autoMode.value = true
  sourceState.value = 'detecting'
  cameraMessage.value = '正在检测 WebRTC 通道...'
  detectStreams()
}

function onImageLoaded() {
  streamLoaded.value = true
  sourceState.value = 'fallback'
}

function onImageError() {
  streamLoaded.value = false
  sourceState.value = 'error'
  cameraMessage.value = 'HTTP 摄像头画面暂不可用'
  stopRecognition('HTTP 摄像头画面丢失，颜色识别已停止')
}

async function detectStreams() {
  if (!autoMode.value || !props.discoveryUrl) return
  try {
    const response = await fetch(props.discoveryUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (!autoMode.value) return
    const streams = Array.isArray(data.streams) ? data.streams : []
    const selected = streams.find((stream) => stream.ready) || streams[0]

    if (selected) {
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
      const port = Number(data.webrtcPort) || 8889
      const encodedPath = selected.name.split('/').map(encodeURIComponent).join('/')
      const url = `${protocol}//${window.location.hostname}:${port}/${encodedPath}`
      setSource('webrtc', url, selected.name, Boolean(selected.ready))
      draftUrl.value = url
      return
    }

    const fallbackUrl = data.fallbackUrl || props.defaultUrl
    if (fallbackUrl) {
      setSource('image', fallbackUrl, '', true)
      draftUrl.value = fallbackUrl
    } else {
      activeUrl.value = ''
      sourceState.value = 'error'
      cameraMessage.value = '未发现可用的摄像头通道'
    }
  } catch (error) {
    if (props.defaultUrl) {
      setSource('image', props.defaultUrl, '', true)
      draftUrl.value = props.defaultUrl
    } else {
      activeUrl.value = ''
      sourceState.value = 'error'
      cameraMessage.value = `通道检测失败：${error.message}`
    }
  }
}

watch(() => props.defaultUrl, (url) => {
  if (!url || autoMode.value || activeMode.value !== 'image') return
  draftUrl.value = url
  setSource('image', url, '', true)
})

onMounted(() => {
  detectStreams()
  discoveryTimer = window.setInterval(detectStreams, 4000)
  resizeObserver = new ResizeObserver(drawOverlay)
  if (overlayElement.value) resizeObserver.observe(overlayElement.value)
  document.addEventListener('visibilitychange', handleVisibility)
})

function handleVisibility() { if (document.hidden) stopFollowing('页面已隐藏，跟随已停止') }
watch([activeUrl, activeMode, streamKey], connectVideo, { flush: 'post' })
watch(() => props.servoReady, ready => { if (!ready) stopFollowing('ROS 连接不可用，跟随已停止') })
watch(() => props.stopToken, () => stopFollowing('其他控制操作已停止颜色跟随'), { flush: 'sync' })
watch(() => props.motionBlocked, blocked => { if (blocked) stopFollowing('手动机械臂或导航正在运行，跟随已停止') }, { flush: 'sync' })

onUnmounted(() => {
  if (discoveryTimer) window.clearInterval(discoveryTimer)
  if (trackingTimer) clearInterval(trackingTimer)
  resizeObserver?.disconnect(); videoGeneration++; videoSession?.close()
  document.removeEventListener('visibilitychange', handleVisibility)
  stopFollowing()
})
</script>

<style scoped>
.tracking-toggle { padding: 5px 8px; border: 1px solid #2563eb; border-radius: 4px; color: #1d4ed8; background: #eff6ff; cursor: pointer; font-size: .7rem; }
.tracking-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.tracking-panel { display: grid; gap: 8px; padding: 10px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: .75rem; }
.color-options { display: flex; flex-wrap: wrap; gap: 4px; }
.color-options button { display: flex; align-items: center; gap: 4px; padding: 5px; border: 1px solid #cbd5e1; border-radius: 4px; background: white; cursor: pointer; }
.color-options button.selected { border-color: #2563eb; background: #eff6ff; }
.color-options i { width: 10px; height: 10px; border-radius: 50%; }
.tracking-joints, .tracking-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tracking-joints label { display: grid; gap: 4px; }
.tracking-joints strong { padding: 5px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: .68rem; }
.tracking-actions button { padding: 8px 4px; border: 1px solid #2563eb; background: #2563eb; color: white; border-radius: 4px; cursor: pointer; }
.tracking-actions button:last-child { border-color: #dc2626; background: #dc2626; }
.tracking-actions button:disabled { opacity: .45; cursor: not-allowed; }
.tracking-status { color: #1d4ed8; line-height: 1.5; }
.tracking-hint { color: #64748b; font-size: .66rem; line-height: 1.5; }
</style>
