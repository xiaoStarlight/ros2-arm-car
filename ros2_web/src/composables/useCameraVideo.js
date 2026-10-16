// Use the MediaMTX reader already shipped on the robot; no second video stream,
// inference service, or video transcoding process is needed on the S905L3A.
let readerScriptPromise = null
let readerScriptUrl = ''
function loadReader(url) {
  if (window.MediaMTXWebRTCReader) return Promise.resolve(window.MediaMTXWebRTCReader)
  if (readerScriptPromise && readerScriptUrl === url) return readerScriptPromise
  readerScriptUrl = url
  readerScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.onload = () => window.MediaMTXWebRTCReader ? resolve(window.MediaMTXWebRTCReader) : reject(new Error('视频读取组件不可用'))
    script.onerror = () => { script.remove(); readerScriptPromise = null; reject(new Error('无法加载 MediaMTX 视频读取组件')) }
    document.head.appendChild(script)
  })
  return readerScriptPromise
}

export async function openCameraVideo(video, sourceUrl, onError) {
  const url = new URL(sourceUrl, window.location.href)
  url.search = ''
  url.pathname = url.pathname.replace(/\/whep\/?$/, '').replace(/\/$/, '')
  const Reader = await loadReader(new URL(`${url.pathname}/reader.js`, url.origin).toString())
  const stream = new MediaStream()
  const reader = new Reader({ url: `${url.origin}${url.pathname}/whep`, onError,
    onTrack: event => {
      if (event.track.kind !== 'video') return
      for (const old of stream.getVideoTracks()) stream.removeTrack(old)
      stream.addTrack(event.track)
      video.srcObject = stream
      video.play().catch(() => onError('请点击画面播放后再开始识别'))
    }
  })
  return { close() {
    reader.close()
    for (const track of stream.getTracks()) track.stop()
    if (video.srcObject === stream) video.srcObject = null
  } }
}
