import { fitServoAngle, getServoCommandError } from '../config/servoLimits.js'

export const FOLLOW_STEP_DEG = 10
export const FOLLOW_INTERVAL_MS = 800
export const FOLLOW_SETTLE_MS = 1200
export const FOLLOW_FILTER_MS = 160
// Confirmed on the actual arm: channel 1 increases to the left; channel 4
// increases downwards. The camera is mounted above the gripper, facing forward.
export const FOLLOW_AXES = Object.freeze({
  x: Object.freeze({ channel: 1, correctionSign: -1 }),
  y: Object.freeze({ channel: 4, correctionSign: 1 })
})

// Only continue an unfinished trajectory when the next command uses the same
// joint and direction, far from center. The firmware restarts a one-second
// global interpolation on each message, so axis switches must wait to settle.
export class ArmColorFollower {
  constructor() { this.stop() }
  stop() {
    this.active = false; this.pending = null; this.rollback = null; this.heldAxes = {}
    this.stable = 0; this.lastMove = -Infinity; this.divergence = 0; this.unresponsive = 0
    this.filteredErrors = null; this.lastSample = null; this.lastAxis = null
    this.waitingForTarget = false
  }
  start(horizontal, vertical) {
    this.stop()
    // Only these two channels have a confirmed physical direction for this car.
    if (horizontal !== FOLLOW_AXES.x.channel || vertical !== FOLLOW_AXES.y.channel) return false
    this.channels = { x: horizontal, y: vertical }; this.active = true
    return true
  }
  lost() {
    if (!this.active) return
    // Keep the user's following intent, but discard stale target feedback.
    // Preserve lastMove so a quickly returning target cannot interrupt the
    // previous trajectory before its settling interval has elapsed.
    this.pending = null; this.rollback = null; this.heldAxes = {}
    this.stable = 0; this.divergence = 0; this.unresponsive = 0
    this.filteredErrors = null; this.lastSample = null; this.lastAxis = null
    this.waitingForTarget = true
  }
  smoothErrors(target, now) {
    const raw = { x: target.cx - 0.5, y: target.cy - 0.5 }
    if (!this.filteredErrors) this.filteredErrors = raw
    else {
      const dt = Math.max(0, now - this.lastSample)
      const alpha = 1 - Math.exp(-dt / FOLLOW_FILTER_MS)
      for (const axis of ['x','y']) this.filteredErrors[axis] += alpha * (raw[axis] - this.filteredErrors[axis])
    }
    this.lastSample = now
    return this.filteredErrors
  }
  chooseAxis(errors, tolerance) {
    const axes = ['x','y'].filter(axis => {
      const hold = this.heldAxes[axis]
      return !(hold && Math.abs(errors[axis] - hold.error) <= hold.release) && Math.abs(errors[axis]) > tolerance[axis]
    })
    if (!axes.length) return null
    axes.sort((a,b) => Math.abs(errors[b]) - Math.abs(errors[a]))
    // Similar horizontal/vertical errors should not switch joints every frame.
    if (axes.includes(this.lastAxis) && Math.abs(errors[this.lastAxis]) >= Math.abs(errors[axes[0]]) * 0.8) return this.lastAxis
    return axes[0]
  }
  move(axis, desiredAngle, errors, angles, now, send, settleBand = 0) {
    const channel = this.channels[axis], current = angles[channel]
    if (getServoCommandError(channel, current)) { this.stop(); return `请先向通道 ${channel} 手动发送当前目标角度，再启动跟随` }
    const angle = Math.round(fitServoAngle(channel, desiredAngle) * 1e6) / 1e6
    if (Math.abs(angle - current) < 0.05) { this.stop(); return `通道 ${channel} 已到限位，跟随已停止` }
    if (!send(channel, angle)) { this.stop(); return '关节命令未发送，跟随已停止' }
    this.pending = { axis, before: errors[axis], from: current, settleBand }
    this.lastMove = now; this.lastAxis = axis
    return `通道 ${channel} 调整 ${Math.abs(angle - current).toFixed(1)}°，平滑跟随中`
  }
  update(target, angles, now, send) {
    if (!this.active) return '跟随已停止'
    if (!target || !Number.isFinite(target.cx) || !Number.isFinite(target.cy)) {
      this.lost(); return '未检测到目标，保持识别并等待重新出现'
    }
    const errors = this.smoothErrors(target, now)
    const tolerance = { x: Math.min(0.025, (target.width || 0.1) * 0.3), y: Math.min(0.025, (target.height || 0.1) * 0.3) }
    if (this.waitingForTarget) {
      if (now - this.lastMove < FOLLOW_SETTLE_MS) return '目标已重新出现，等待上一动作完成'
      this.waitingForTarget = false
    }
    if (now - this.lastMove < FOLLOW_INTERVAL_MS) return '等待关节动作完成'
    if (this.pending) {
      const { axis, before, from, settleBand } = this.pending
      const nextAxis = this.chooseAxis(errors, tolerance)
      const continuous = !settleBand && !this.divergence && !this.unresponsive && nextAxis === axis &&
        before * errors[axis] > 0 && Math.abs(errors[axis]) >= 0.12
      if (now - this.lastMove < (continuous ? FOLLOW_INTERVAL_MS : FOLLOW_SETTLE_MS)) {
        return '接近中心或准备换向，等待反馈稳定'
      }
      const change = errors[axis] - before
      if (settleBand) {
        this.heldAxes[axis] = { error: errors[axis], release: settleBand }
      } else if (before * errors[axis] < 0) {
        // A fixed step may straddle the image center. Keep the nearer
        // position (return once if necessary), then wait for target movement
        // rather than alternating between the same two joint angles forever.
        const release = Math.max(tolerance[axis], Math.abs(change) / 2 + 0.005)
        if (Math.abs(errors[axis]) > Math.abs(before) + 0.005) {
          this.rollback = { axis, angle: from, release }
        } else {
          this.heldAxes[axis] = { error: errors[axis], release }
        }
        this.divergence = 0; this.unresponsive = 0
      } else if (Math.abs(errors[axis]) > Math.abs(before) + 0.025) {
        if (++this.divergence >= 2) { this.stop(); return '偏差持续增大，跟随已停止，请重新确认关节方向' }
      } else if (Math.abs(change) < 0.005) {
        if (++this.unresponsive >= 2) { this.stop(); return '连续动作未测到视角变化，跟随已停止' }
      } else {
        this.divergence = 0; this.unresponsive = 0
      }
      this.pending = null
    }
    if (this.rollback) {
      const { axis, angle, release } = this.rollback
      this.rollback = null
      return this.move(axis, angle, errors, angles, now, send, release)
    }
    if (++this.stable < 3) return '确认目标稳定'
    for (const axis of ['x','y']) {
      const hold = this.heldAxes[axis]
      if (hold && Math.abs(errors[axis] - hold.error) > hold.release) delete this.heldAxes[axis]
    }
    const axis = this.chooseAxis(errors, tolerance)
    if (!axis) return Object.keys(this.heldAxes).length ? `已保持在 ${FOLLOW_STEP_DEG}° 步长可达到的近中心位置，等待目标移动` : '目标已在画面中心'
    const channel = this.channels[axis], current = angles[channel]
    if (getServoCommandError(channel, current)) { this.stop(); return `请先向通道 ${channel} 手动发送当前目标角度，再启动跟随` }
    const delta = Math.sign(errors[axis]) * FOLLOW_AXES[axis].correctionSign * FOLLOW_STEP_DEG
    return this.move(axis, current + delta, errors, angles, now, send)
  }
}
