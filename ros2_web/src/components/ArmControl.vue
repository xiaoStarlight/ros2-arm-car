<template>
  <div class="card" v-if="connected">
    <div class="card-header arm-header">
      <span>机械臂控制</span>
      <span class="arm-badge">通道 1–5 + 末端位姿</span>
    </div>

    <div class="card-body arm-body">
      <section class="home-panel">
        <div>
          <div class="home-title">机械臂回正</div>
          <div class="home-values">1: 90° · 2: 0° · 3–5: 180° · 约 5 秒</div>
        </div>
        <button class="home-button" :disabled="!servoReady || homing || automaticActive" @click="homeArm">
          {{ homing ? '回正中…' : '一键回正' }}
        </button>
      </section>

      <section class="arm-section">
        <div class="section-title">单舵机</div>
        <div class="servo-row">
          <label class="field compact-field">
            <span>通道</span>
            <select v-model.number="servo.channel" :disabled="sendingServo || homing || automaticActive">
              <option v-for="channel in 5" :key="channel" :value="channel">
                {{ channel }}{{ channel === 5 ? ' · 夹爪' : '' }} · {{ getServoRangeLabel(channel) }}
              </option>
            </select>
          </label>
          <label class="field angle-field">
            <span>角度</span>
            <div class="number-with-unit">
              <input
                v-model.number="servo.angle"
                type="number"
                :min="servoLimits.min"
                :max="servoLimits.max"
                step="1"
                inputmode="decimal"
                :disabled="sendingServo || homing || automaticActive"
                :aria-invalid="Boolean(servoError)"
                aria-describedby="servo-range-description"
              >
              <b>°</b>
            </div>
          </label>
        </div>
        <div id="servo-range-description" class="range-description" aria-live="polite">
          <strong>通道 {{ servo.channel }}：{{ getServoRangeLabel(servo.channel) }}</strong>
          <span>切换通道或调整选项后，点击发送才会动作。</span>
          <span v-if="isGripper">120° 为完全张开，180° 为闭合；低于 120° 不可发送。</span>
        </div>
        <div class="last-sent-angle" aria-live="polite">
          {{ hasLastSentAngle ? `本页上次发送：${lastSentAngle}°（目标角度）` : '本页尚无发送记录，当前值为待发送参考。' }}
        </div>
        <div class="angle-controls">
          <div class="angle-range" role="img" :aria-label="`允许 ${getServoRangeLabel(servo.channel)}，其余角度不可发送`">
            <div class="angle-range-track">
              <span class="allowed-range" :style="{ left: `${servoLimits.min / 180 * 100}%`, width: `${(servoLimits.max - servoLimits.min) / 180 * 100}%` }"></span>
              <span v-if="!servoError" class="angle-marker" :style="{ left: `${servo.angle / 180 * 100}%` }"></span>
            </div>
            <div class="range-ticks"><span>0°</span><span>180°</span></div>
            <div class="range-legend"><span>绿色：允许范围</span><span>浅红：不可发送</span></div>
          </div>
          <input
            :key="servo.channel"
            v-model.number="servo.angle"
            class="angle-slider"
            type="range"
            :min="servoLimits.min"
            :max="servoLimits.max"
            step="1"
            :aria-label="`通道 ${servo.channel} 舵机角度，允许 ${getServoRangeLabel(servo.channel)}`"
            :disabled="sendingServo || homing || automaticActive"
          >
          <div class="slider-endpoints"><span>{{ servoLimits.min }}°</span><span>{{ servoLimits.max }}°</span></div>
        </div>
        <div v-if="servoError" class="servo-error" role="alert">{{ servoError }}，未发送命令。</div>
        <button class="arm-submit" :disabled="!servoReady || sendingServo || homing || automaticActive || Boolean(servoError)" @click="sendServo">
          {{ sendingServo ? '发送中…' : (isGripper ? '发送夹爪动作' : '发送舵机角度') }}
        </button>
      </section>

      <section class="arm-section pose-section">
        <div class="section-title">末端位姿</div>
        <div class="pose-grid">
          <label v-for="field in poseFields" :key="field.key" class="field">
            <span>{{ field.label }}</span>
            <div class="number-with-unit">
              <input
                v-model.number="pose[field.key]"
                type="number"
                :step="field.step"
                inputmode="decimal"
                :disabled="sendingPose || homing || automaticActive"
              >
              <b>{{ field.unit }}</b>
            </div>
          </label>
        </div>
        <button class="arm-submit pose-submit" :disabled="sendingPose || homing || automaticActive" @click="sendPose">
          {{ sendingPose ? '正在提交…' : '提交末端位姿' }}
        </button>
        <div class="accept-hint">{{ automaticActive ? '颜色跟随中，请先停止跟随再使用手动机械臂控制。' : 'success 表示目标已接受，不代表动作已完成。' }}</div>
      </section>

      <div v-if="status.text" class="arm-status" :class="status.type" role="status">
        {{ status.text }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { SERVO_LIMITS, HOME_ANGLES, getServoLimits, getServoRangeLabel, getServoCommandError, getServoDraftAngle } from '../config/servoLimits.js'

const props = defineProps({
  connected: Boolean,
  servoReady: Boolean,
  automaticActive: Boolean,
  lastSentAngles: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['servo-command', 'home-command', 'busy-change'])
const API_BASE = `http://${window.location.hostname}:3000/api`

const servo = reactive({ channel: 1, angle: getServoDraftAngle(1, props.lastSentAngles) })
const pose = reactive({ x: 0.16, y: 0.0, z: 0.12, pitch_deg: 0.0 })
const poseFields = [
  { key: 'x', label: 'X', unit: 'm', step: 0.01 },
  { key: 'y', label: 'Y', unit: 'm', step: 0.01 },
  { key: 'z', label: 'Z', unit: 'm', step: 0.01 },
  { key: 'pitch_deg', label: '俯仰', unit: '°', step: 1 }
]
const sendingServo = ref(false)
const sendingPose = ref(false)
const homing = ref(false)
watch(() => sendingServo.value || sendingPose.value || homing.value, busy => emit('busy-change', busy), { flush: 'sync' })
const status = reactive({ type: '', text: '' })
const servoLimits = computed(() => getServoLimits(servo.channel) || SERVO_LIMITS[1])
const isGripper = computed(() => servo.channel === 5)
const servoError = computed(() => getServoCommandError(servo.channel, servo.angle))
const lastSentAngle = computed(() => props.lastSentAngles[servo.channel])
const hasLastSentAngle = computed(() => !getServoCommandError(servo.channel, lastSentAngle.value))

watch(() => servo.channel, (channel) => {
  servo.angle = getServoDraftAngle(channel, props.lastSentAngles)
  setStatus('', '')
}, { flush: 'sync' })

// The parent updates this only after the WebSocket publisher accepts a send,
// including each individual command of the home sequence.
watch(lastSentAngle, () => {
  servo.angle = getServoDraftAngle(servo.channel, props.lastSentAngles)
}, { flush: 'sync' })

function setStatus(type, text) {
  status.type = type
  status.text = text
}

function sendServo() {
  if (!props.servoReady || sendingServo.value || homing.value || props.automaticActive) return
  const { channel, angle } = servo
  const error = getServoCommandError(channel, angle)
  if (error) return setStatus('error', error)

  sendingServo.value = true
  let sent = false
  emit('servo-command', { channel, angle, onResult: (success) => { sent = success === true } })
  if (!sent) {
    sendingServo.value = false
    return setStatus('error', '命令未发送，请确认连接状态后重试')
  }
  setStatus('success', `已向 ${channel} 号舵机发送 ${angle}°`)
  window.setTimeout(() => { sendingServo.value = false }, 250)
}

function homeArm() {
  if (!props.servoReady || homing.value || props.automaticActive) return
  homing.value = true
  setStatus('pending', '正在按顺序发送 5 个舵机回正角度，请等待约 5 秒…')
  emit('home-command', [...HOME_ANGLES])
  window.setTimeout(() => {
    homing.value = false
    setStatus('success', '回正命令已全部发送')
  }, 5600)
}

async function sendPose() {
  if (props.automaticActive) return
  const payload = Object.fromEntries(Object.keys(pose).map((key) => [key, Number(pose[key])]))
  if (Object.values(payload).some((value) => !Number.isFinite(value))) {
    return setStatus('error', '末端位姿参数必须全部为有效数字')
  }

  sendingPose.value = true
  setStatus('pending', '正在等待机械臂控制器响应…')
  try {
    const response = await fetch(`${API_BASE}/arm/pose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await response.json()
    if (!response.ok || !data.success) {
      throw new Error(data.error || data.message || '目标未被接受')
    }
    setStatus('success', '末端位姿目标已提交')
  } catch (error) {
    setStatus('error', error.message || '机械臂服务调用失败')
  } finally {
    sendingPose.value = false
  }
}
</script>

<style scoped>
.arm-header {
  justify-content: space-between;
}

.arm-badge {
  padding: 2px 6px;
  border-radius: 999px;
  background: #eef2ff;
  color: #4f46e5;
  font-size: 0.62rem;
  font-weight: 600;
}

.arm-body,
.arm-section {
  display: grid;
  gap: 10px;
}

.home-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px solid #bfdbfe;
  border-radius: var(--radius-sm);
  background: #eff6ff;
}

.home-title {
  color: #1e3a8a;
  font-size: 0.76rem;
  font-weight: 700;
}

.home-values {
  margin-top: 3px;
  color: #64748b;
  font-family: var(--font-mono);
  font-size: 0.61rem;
  white-space: nowrap;
}

.home-button {
  padding: 8px 10px;
  border: 1px solid #2563eb;
  border-radius: var(--radius-sm);
  background: #fff;
  color: #1d4ed8;
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  transition: var(--transition);
  white-space: nowrap;
}

.home-button:hover:not(:disabled) {
  background: #dbeafe;
}

.home-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.pose-section {
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.section-title {
  color: var(--text-secondary);
  font-size: 0.76rem;
  font-weight: 700;
}

.servo-row,
.pose-grid {
  display: grid;
  gap: 8px;
}

.servo-row {
  grid-template-columns: 0.9fr 1.1fr;
}

.pose-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.field {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.field > span {
  color: var(--text-muted);
  font-size: 0.68rem;
}

.field input,
.field select {
  width: 100%;
  min-width: 0;
  height: 34px;
  padding: 7px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  outline: none;
}

.field input:focus,
.field select:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.number-with-unit {
  position: relative;
}

.number-with-unit input {
  padding-right: 26px;
}

.number-with-unit b {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  font-size: 0.66rem;
  pointer-events: none;
}

.angle-slider {
  width: 100%;
  accent-color: var(--accent-primary);
}

.range-description {
  display: grid;
  gap: 4px;
  padding: 8px;
  border-radius: var(--radius-sm);
  background: #f0fdf4;
  color: #166534;
  font-size: 0.72rem;
  line-height: 1.5;
}

.range-description span {
  color: var(--text-secondary);
  font-size: 0.65rem;
}

.angle-range-track {
  position: relative;
  height: 10px;
  margin-top: 4px;
  border-radius: 5px;
  background: #fee2e2;
}

.allowed-range {
  position: absolute;
  height: 100%;
  border-radius: 5px;
  background: #22c55e;
}

.angle-marker {
  position: absolute;
  top: -3px;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: #0f172a;
  transform: translateX(-50%);
}

.range-ticks,
.range-legend,
.slider-endpoints {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 0.64rem;
}

.range-legend span:first-child {
  color: #166534;
}

.range-legend span:last-child,
.servo-error {
  color: #b91c1c;
}

.servo-error {
  font-size: 0.7rem;
  line-height: 1.5;
}

.last-sent-angle {
  color: var(--text-secondary);
  font-size: 0.68rem;
  line-height: 1.5;
}

.angle-controls {
  display: grid;
  gap: 6px;
}

.arm-submit {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid #2563eb;
  border-radius: var(--radius-sm);
  background: #2563eb;
  color: #fff;
  font-size: 0.78rem;
  font-weight: 650;
  cursor: pointer;
  transition: var(--transition);
}

.arm-submit:hover:not(:disabled) {
  background: #1d4ed8;
}

.arm-submit:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.pose-submit {
  background: #0f766e;
  border-color: #0f766e;
}

.pose-submit:hover:not(:disabled) {
  background: #115e59;
}

.accept-hint {
  color: var(--text-muted);
  font-size: 0.66rem;
  line-height: 1.45;
}

.arm-status {
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: 0.72rem;
  line-height: 1.35;
}

.arm-status.success {
  color: #047857;
  background: #ecfdf5;
  border-color: #a7f3d0;
}

.arm-status.pending {
  color: #1d4ed8;
  background: #eff6ff;
  border-color: #bfdbfe;
}

.arm-status.error {
  color: #b91c1c;
  background: #fef2f2;
  border-color: #fecaca;
}
</style>
