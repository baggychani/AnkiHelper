/** Injected into the preview iframe after each card document is rendered. */
const previewContentSecurityPolicy = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "navigate-to 'none'",
  "object-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' data:",
  "img-src http://127.0.0.1:8765 data: blob:",
  "media-src http://127.0.0.1:8765 data: blob:",
  "font-src http://127.0.0.1:8765 data:",
  "connect-src http://127.0.0.1:8765",
].join('; ')

export function buildPreviewAudioScript(): string {
  return `<script>(()=>{let currentAudio=null,currentButton=null,currentBlobUrl=null,finishCurrent=null,loadGeneration=0;const mark=(button,active)=>{button.classList.toggle("playing",active);button.setAttribute("aria-pressed",String(active))};const cleanupBlob=()=>{if(currentBlobUrl){URL.revokeObjectURL(currentBlobUrl);currentBlobUrl=null}};const stopCurrent=()=>{if(currentAudio){currentAudio.pause();currentAudio.currentTime=0;currentAudio=null}if(currentButton){mark(currentButton,false);currentButton=null}cleanupBlob();if(finishCurrent){const finish=finishCurrent;finishCurrent=null;finish()}};const playButton=async(button,cancelToken)=>{const url=button.dataset.audio;if(!url||cancelToken.cancelled)return;const requestId=++loadGeneration;stopCurrent();try{const response=await fetch(url,{cache:"no-store"});if(cancelToken.cancelled||requestId!==loadGeneration)return;if(!response.ok)throw new Error(String(response.status));const bytes=await response.arrayBuffer();if(cancelToken.cancelled||requestId!==loadGeneration)return;const blobUrl=URL.createObjectURL(new Blob([bytes],{type:response.headers.get("content-type")||"application/octet-stream"}));if(cancelToken.cancelled||requestId!==loadGeneration){URL.revokeObjectURL(blobUrl);return}const audio=new Audio(blobUrl);audio.preload="auto";currentAudio=audio;currentButton=button;currentBlobUrl=blobUrl;await new Promise((resolve)=>{let settled=false;const finish=()=>{if(settled)return;settled=true;if(finishCurrent===finish)finishCurrent=null;mark(button,false);if(currentAudio===audio){currentAudio=null;currentButton=null;cleanupBlob()}resolve()};finishCurrent=finish;audio.onended=finish;audio.onerror=finish;audio.play().then(()=>mark(button,true)).catch(finish)})}catch{if(currentButton===button)stopCurrent();else mark(button,false)}};const buttons=[...document.querySelectorAll(".anki-audio")];const autoplayButtons=buttons.filter(button=>button.dataset.autoplay!=="false");let autoplayToken={cancelled:false};const startAutoplay=async()=>{const token={cancelled:false};autoplayToken=token;for(const button of autoplayButtons){if(token.cancelled)break;await playButton(button,token)}};buttons.forEach((button)=>{button.addEventListener("click",()=>{autoplayToken.cancelled=true;loadGeneration+=1;if(currentButton===button&&currentAudio&&!currentAudio.paused){stopCurrent();return}const token={cancelled:false};autoplayToken=token;void playButton(button,token)})});window.addEventListener("pagehide",()=>{autoplayToken.cancelled=true;loadGeneration+=1;stopCurrent()},{once:true});void startAutoplay()})()</script>`
}

export type PreviewPlatform = 'desktop' | 'ankidroid'

export const PREVIEW_SCREEN: Record<PreviewPlatform, { width: number; height: number }> = {
  desktop: { width: 1280, height: 720 },
  ankidroid: { width: 360, height: 800 },
}

export type PreviewDocumentOptions = {
  templateIndex?: number
  platform?: PreviewPlatform
  nightMode?: boolean
}

/** css_browser_selector classes Anki's webview puts on <html>. */
const DOCUMENT_CLASSES: Record<PreviewPlatform, string[]> = {
  desktop: ['js', 'webkit', 'chrome', 'win'],
  ankidroid: ['js', 'webkit', 'chrome', 'mobile', 'android', 'linux'],
}

/** What Anki's body_classes_for_card_ord() adds next to `card cardN`. */
const BODY_CLASSES: Record<PreviewPlatform, string[]> = {
  desktop: ['isWin'],
  ankidroid: [],
}

const NIGHT_CLASSES: Record<PreviewPlatform, string[]> = {
  desktop: ['nightMode', 'night_mode'],
  ankidroid: ['night_mode', 'nightMode', 'ankidroid_dark_mode'],
}

/** Anki desktop defines this before card scripts run; AnkiDroid leaves it unset. */
const ANKI_PLATFORM: Record<PreviewPlatform, string | null> = {
  desktop: 'desktop',
  ankidroid: null,
}

/** Anki's reviewer.scss, which cascades before the note type styling. */
const REVIEWER_CSS = [
  'html{height:100%;background:#fff}',
  'html.nightMode{background:#2f2f31}',
  'html.ankidroid_dark_mode{background:#303030}',
  'body{margin:20px;min-height:calc(100% - 40px);box-sizing:border-box;overflow-wrap:break-word;',
  'background-size:cover;background-repeat:no-repeat;background-position:top;background-attachment:fixed}',
  'body.nightMode{background-color:#2f2f31;color:#f5f5f5}',
  'body.ankidroid_dark_mode{background-color:#303030}',
  'hr{background-color:#a0a0a0;margin:1em 0;border:none;height:1px}',
  'img{max-width:100%;max-height:95vh}',
  'li{text-align:start}',
  'pre{text-align:left}',
  'button{margin:1em 0.5em}',
  '#typeans{width:100%;box-sizing:border-box;line-height:1.75}',
  'code#typeans{white-space:pre-wrap;font-variant-ligatures:none}',
  '.typeGood{background:#afa;color:black}',
  '.typeBad{color:black;background:#faa}',
  '.typeMissed{color:black;background:#ccc}',
  '.nightMode .latex{filter:invert(100%)}',
  '.drawing{zoom:50%}',
  '.nightMode img.drawing{filter:invert(1) hue-rotate(180deg)}',
].join('')

/**
 * Listens for appearance updates from the parent window so switching PC/AnkiDroid
 * or night mode can restyle the already-loaded document instead of forcing a full
 * iframe reload (which flashes blank white and interrupts autoplaying audio).
 */
function buildAppearanceScript(): string {
  const documentJson = JSON.stringify(DOCUMENT_CLASSES)
  const bodyJson = JSON.stringify(BODY_CLASSES)
  const nightJson = JSON.stringify(NIGHT_CLASSES)
  const platformJson = JSON.stringify(ANKI_PLATFORM)
  const screenJson = JSON.stringify(PREVIEW_SCREEN)
  return `<script>(()=>{const DOC=${documentJson};const BODY=${bodyJson};const NIGHT=${nightJson};const PLATFORM=${platformJson};const SCREEN=${screenJson};const union=(map)=>[...new Set(Object.values(map).flat())];const allDoc=union(DOC);const allBody=union(BODY);const allNight=union(NIGHT);const apply=(platform,nightMode)=>{const doc=DOC[platform]||DOC.desktop;const body=BODY[platform]||BODY.desktop;const night=nightMode?(NIGHT[platform]||NIGHT.desktop):[];const html=document.documentElement;html.classList.remove(...allDoc,...allNight);html.classList.add(...doc,...night);document.body.classList.remove(...allBody,...allNight);document.body.classList.add(...body,...night);try{const value=PLATFORM[platform];if(value)globalThis.ankiPlatform=value;else delete globalThis.ankiPlatform}catch(_error){}const screen=SCREEN[platform]||SCREEN.desktop;const meta=document.querySelector('meta[name="viewport"]');if(meta)meta.setAttribute("content","width="+screen.width+",initial-scale=1")};window.addEventListener("message",(event)=>{const data=event.data;if(!data||data.type!=="ankihelper:appearance")return;apply(data.platform,data.nightMode)})})()</script>`
}

export function buildPreviewDocument(previewHtml: string, options: PreviewDocumentOptions = {}): string {
  const templateIndex = Math.max(0, options.templateIndex ?? 0)
  const platform = options.platform ?? 'desktop'
  const nightMode = options.nightMode ?? false
  const nightClasses = nightMode ? NIGHT_CLASSES[platform] : []
  const documentClasses = [...DOCUMENT_CLASSES[platform], ...nightClasses].join(' ')
  const bodyClasses = ['card', `card${templateIndex + 1}`, ...BODY_CLASSES[platform], ...nightClasses].join(' ')
  const screen = PREVIEW_SCREEN[platform]
  const ankiPlatform = ANKI_PLATFORM[platform]
  // Anki defines ankiPlatform before the card HTML, so template scripts can read it.
  const platformScript = ankiPlatform ? `<script>globalThis.ankiPlatform="${ankiPlatform}"</script>` : ''
  return `<!doctype html><html class="${documentClasses}"><head><meta name="viewport" content="width=${screen.width},initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${previewContentSecurityPolicy}"><style>${REVIEWER_CSS}</style>${platformScript}</head><body class="${bodyClasses}"><div id="qa">${previewHtml}</div>${buildPreviewAudioScript()}${buildAppearanceScript()}</body></html>`
}
