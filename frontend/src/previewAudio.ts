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

const PLATFORM_CLASSES: Record<PreviewPlatform, string[]> = {
  desktop: ['win'],
  ankidroid: ['mobile', 'android', 'linux', 'chrome'],
}

function nightClassesFor(platform: PreviewPlatform): string[] {
  return platform === 'ankidroid' ? ['nightMode', 'night_mode', 'ankidroid_dark_mode'] : ['nightMode']
}

/**
 * Listens for appearance updates from the parent window so switching PC/AnkiDroid
 * or night mode can restyle the already-loaded document instead of forcing a full
 * iframe reload (which flashes blank white and interrupts autoplaying audio).
 */
function buildAppearanceScript(): string {
  const platformClassesJson = JSON.stringify(PLATFORM_CLASSES)
  const screenJson = JSON.stringify(PREVIEW_SCREEN)
  return `<script>(()=>{const PLATFORM_CLASSES=${platformClassesJson};const SCREEN=${screenJson};const nightClassesFor=(platform)=>platform==="ankidroid"?["nightMode","night_mode","ankidroid_dark_mode"]:["nightMode"];const allPlatformClasses=Object.values(PLATFORM_CLASSES).flat();const allNightClasses=["nightMode","night_mode","ankidroid_dark_mode"];const apply=(platform,nightMode)=>{const targets=[document.documentElement,document.body];for(const target of targets){target.classList.remove(...allPlatformClasses,...allNightClasses);target.classList.add(...(PLATFORM_CLASSES[platform]||PLATFORM_CLASSES.desktop));if(nightMode)target.classList.add(...nightClassesFor(platform))}const screen=SCREEN[platform]||SCREEN.desktop;const meta=document.querySelector('meta[name="viewport"]');if(meta)meta.setAttribute("content","width="+screen.width+",initial-scale=1")};window.addEventListener("message",(event)=>{const data=event.data;if(!data||data.type!=="ankihelper:appearance")return;apply(data.platform,data.nightMode)})})()</script>`
}

export function buildPreviewDocument(previewHtml: string, options: PreviewDocumentOptions = {}): string {
  const templateIndex = Math.max(0, options.templateIndex ?? 0)
  const platform = options.platform ?? 'desktop'
  const nightMode = options.nightMode ?? false
  const platformClasses = PLATFORM_CLASSES[platform]
  const nightClasses = nightMode ? nightClassesFor(platform) : []
  const documentClasses = [...platformClasses, ...nightClasses].join(' ')
  const bodyClasses = ['card', `card${templateIndex + 1}`, ...platformClasses, ...nightClasses].join(' ')
  const screen = PREVIEW_SCREEN[platform]
  const defaults = 'html,body{width:100%;height:100%;margin:0}body{box-sizing:border-box;background:#fff;overflow-wrap:break-word}video{max-width:100%}body.nightMode{background:#2f2f31;color:#f5f5f5}body.ankidroid_dark_mode{background:#303030}'
  return `<!doctype html><html class="${documentClasses}"><head><meta name="viewport" content="width=${screen.width},initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${previewContentSecurityPolicy}"><style>${defaults}</style></head><body class="${bodyClasses}">${previewHtml}${buildPreviewAudioScript()}${buildAppearanceScript()}</body></html>`
}
