"use client";

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { toPng } from 'html-to-image'
import { getCard } from '@/lib/firebase/api'

import {
  type CardData,
  type AchievementIcon,
  formatTokens,
  formatCost,
  getTotalTokens,


  getTier,
  getLevel,
  getPersonality,
  mapPersonality,
  getCodexPersonality,
  getCacheSaved,
  getModelColors,
  normalizeHours,
  getHourBarColor,
  getAchievements,
} from './card-utils'
import './card.css'
import './holo.css'

/* ── Icons ── */
const FlameIcon = ({ size = 14, color = '#ff9f43' }: { size?: number; color?: string }) => (
  <svg style={{ width: size, height: size, color }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
)
const WrenchIcon = ({ color }: { color: string }) => (
  <svg style={{ width: 14, height: 14, color }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
)
const RocketIcon = ({ color }: { color: string }) => (
  <svg style={{ width: 14, height: 14, color }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
)
const MonitorIcon = ({ color }: { color: string }) => (
  <svg style={{ width: 14, height: 14, color }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
)
const ChevronLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
)
const ChevronRight = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
)
const DownloadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
)
const ShareIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>
)
const CopyIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
)


function AchievementSvg({ icon, color }: { icon: AchievementIcon; color: string }) {
  switch (icon) {
    case 'flame': return <FlameIcon size={14} color={color} />
    case 'wrench': return <WrenchIcon color={color} />
    case 'rocket': return <RocketIcon color={color} />
    case 'monitor': return <MonitorIcon color={color} />
  }
}

const TOTAL_PAGES = 8

// Section header with title + subtitle
const SectionHead = ({ title, sub }: { title: string; sub?: string }) => (
  <div className="sec-head">
    <div className="sec-title">{title}</div>
    {sub && <div className="sec-sub">{sub}</div>}
  </div>
)

function shortModelName(name: string): string {
  if (name.includes('opus-4-6')) return 'Opus 4.6'
  if (name.includes('opus-4-5')) return 'Opus 4.5'
  if (name.includes('opus')) return 'Opus'
  if (name.includes('sonnet-4-6')) return 'Sonnet 4.6'
  if (name.includes('sonnet-4-2')) return 'Sonnet 4'
  if (name.includes('sonnet')) return 'Sonnet'
  if (name.includes('haiku')) return 'Haiku 3.5'
  if (name.includes('gpt-5.4')) return 'GPT-5.4'
  if (name.includes('codex-spark')) return 'Codex Spark'
  if (name.includes('codex-mini')) return 'Codex Mini'
  if (name.includes('gpt-5.3-codex')) return 'Codex 5.3'
  if (name.includes('gpt-5.2-codex')) return 'Codex 5.2'
  if (name.includes('gpt-5.1-codex')) return 'Codex 5.1'
  if (name === 'unknown') return 'Unknown'
  return name
}

const toolDisplayNames: Record<string, { name: string; desc: string }> = {
  // Claude Code tools
  'Bash': { name: 'Bash', desc: 'Terminal commands' },
  'Read': { name: 'Read', desc: 'Reading files' },
  'Edit': { name: 'Edit', desc: 'Editing code' },
  'Write': { name: 'Write', desc: 'Creating files' },
  'Grep': { name: 'Grep', desc: 'Searching code' },
  'Glob': { name: 'Glob', desc: 'Finding files' },
  'Agent': { name: 'Agent', desc: 'Sub-agents' },
  'WebSearch': { name: 'Web Search', desc: 'Searching the web' },
  'WebFetch': { name: 'Web Fetch', desc: 'Fetching URLs' },
  'Skill': { name: 'Skill', desc: 'Skill invocations' },
  'TodoWrite': { name: 'Todo', desc: 'Task tracking' },
  'TaskCreate': { name: 'Tasks', desc: 'Creating tasks' },
  'TaskUpdate': { name: 'Tasks', desc: 'Updating tasks' },
  'ToolSearch': { name: 'Tool Search', desc: 'Finding tools' },
  // Codex tools
  'exec_command': { name: 'Run Command', desc: 'Terminal execution' },
  'apply_patch': { name: 'Apply Patch', desc: 'Code changes' },
  'write_stdin': { name: 'Write Input', desc: 'Interactive input' },
  'shell_command': { name: 'Shell', desc: 'Shell commands' },
  'shell': { name: 'Shell', desc: 'Shell execution' },
  'read_file': { name: 'Read File', desc: 'Reading files' },
  'write_file': { name: 'Write File', desc: 'Creating files' },
  'list_directory': { name: 'List Dir', desc: 'Browsing folders' },
  'search_files': { name: 'Search', desc: 'Searching code' },
  'web_search': { name: 'Web Search', desc: 'Searching the web' },
}

function getToolDisplay(rawName: string): { name: string; desc: string } {
  // Check exact match
  if (toolDisplayNames[rawName]) return toolDisplayNames[rawName]
  // Check MCP tools: mcp__ServerName__tool_name
  const mcpMatch = rawName.match(/^mcp__([^_]+)__(.+)$/)
  if (mcpMatch) {
    const tool = mcpMatch[2].replace(/_/g, ' ')
    return { name: tool.charAt(0).toUpperCase() + tool.slice(1), desc: `${mcpMatch[1]} MCP` }
  }
  // Fallback: clean up snake_case/camelCase
  const cleaned = rawName.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')
  return { name: cleaned.charAt(0).toUpperCase() + cleaned.slice(1), desc: '' }
}

function cleanProjectName(name: string): string {
  const parts = name.split('-').filter(Boolean)
  return parts[parts.length - 1] || name
}

function getDailyColor(intensity: number, _hasClaude: boolean, _hasCodex: boolean, isCream = false): string {
  if (intensity === 0) return isCream ? 'rgba(0,0,0,.03)' : 'rgba(255,255,255,.02)'
  if (intensity > 0.75) return '#7dd3fc'
  if (intensity > 0.5) return '#38bdf8'
  if (intensity > 0.25) return '#0ea5e9'
  if (intensity > 0.1) return '#0284c7'
  return '#0369a1'
}

export function CardPage({ demoData }: { demoData?: CardData } = {}) {
  const params = useParams<{ id?: string }>()
  const id = params?.id
  const [data, setData] = useState<CardData | null>(demoData ?? null)
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [exitingPage] = useState<{ page: number; direction: 'left' | 'right' } | null>(null)
  const [enteringFrom, setEnteringFrom] = useState<'left' | 'right' | null>(null)
  const [statView, setStatView] = useState<'combined' | 'claude' | 'codex'>('combined')
  const [cardTheme] = useState<'cream' | 'dark'>('dark')
  const [phase, setPhase] = useState(0)
  const [showShare, setShowShare] = useState(false)
  const [, setShowHint] = useState(false)
  const [nudging, setNudging] = useState(false)
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flipperRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<{ tiltX: number; tiltY: number; mx: number; my: number; hover: number; scale: number }>({
    tiltX: 0, tiltY: 0, mx: 0, my: 0, hover: 0, scale: 1,
  })

  useEffect(() => {
    if (demoData) return
    if (!id) return
    getCard(id).then(setData).catch(() => setError('Card not found'))
  }, [id, demoData])

  // Card-relative pointer: drives both tilt (mx/my) and holo vars (pointer-x/y, background-x/y)
  useEffect(() => {
    const flipper = flipperRef.current
    if (!flipper) return
    const onMove = (e: PointerEvent) => {
      const rect = flipper.getBoundingClientRect()
      const px = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
      const py = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
      // target .pharos-holo directly; setting on .card-flipper loses to .pharos-holo's declared rule
      const holo = flipper.querySelector<HTMLElement>('.pharos-holo')
      const el = holo ?? flipper
      el.style.setProperty('--pointer-x', px + '%')
      el.style.setProperty('--pointer-y', py + '%')
      el.style.setProperty('--background-x', (37 + (px / 100) * 26) + '%')
      el.style.setProperty('--background-y', (33 + (py / 100) * 34) + '%')
      // card-relative -1..1 for tilt
      animRef.current.mx = (px / 50) - 1
      animRef.current.my = (py / 50) - 1
      animRef.current.hover = 1
    }
    // Drive glow via JS class so it works on Windows/touch devices that don't reliably fire :hover
    const onEnter = () => flipper.classList.add('is-hovering')
    const onLeave = () => {
      animRef.current.mx = 0
      animRef.current.my = 0
      animRef.current.hover = 0
      flipper.classList.remove('is-hovering')
    }
    flipper.addEventListener('pointerenter', onEnter)
    flipper.addEventListener('pointermove', onMove)
    flipper.addEventListener('pointerleave', onLeave)
    return () => {
      flipper.removeEventListener('pointerenter', onEnter)
      flipper.removeEventListener('pointermove', onMove)
      flipper.removeEventListener('pointerleave', onLeave)
    }
  }, [data])

  useEffect(() => {
    if (!data) return
    const start = performance.now()
    const T = { cardStart: 800, cardLand: 2800, content: 3200 }
    let localPhase = 0
    let animId: number

    function eOutBack(t: number) { const c = 2.5; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2) }
    function ease(t: number) { return t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2 }

    function animate() {
      animId = requestAnimationFrame(animate)
      const elapsed = performance.now() - start
      const flipper = flipperRef.current
      if (!flipper) return
      const a = animRef.current

      if (elapsed >= T.cardStart && elapsed <= T.cardLand + 300) {
        const dur = T.cardLand - T.cardStart
        const p = Math.min((elapsed - T.cardStart) / dur, 1)
        const eLand = eOutBack(p)
        const eRot = ease(p)
        const tz = -600 * (1 - eLand)
        const ry = eRot * 360
        const rz = 15 * (1 - eRot)
        const sc = .2 + eLand * .8
        flipper.style.transform = `translateZ(${tz}px) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${sc})`
        flipper.style.opacity = String(Math.min(p * 4, 1))
      }

      if (elapsed > T.cardLand + 400 && localPhase < 2) {
        localPhase = 2; setPhase(2)
        flipper.style.opacity = '1'
      }

      if (localPhase >= 2) {
        // tilt now driven by CARD-relative pointer; ±14° range like simey's preview
        const targetX = a.hover ? a.my * -14 : 0
        const targetY = a.hover ? a.mx * 14 : 0
        const targetScale = a.hover ? 1.05 : 1
        a.tiltX += (targetX - a.tiltX) * 0.4
        a.tiltY += (targetY - a.tiltY) * 0.4
        a.scale += (targetScale - a.scale) * 0.18
        flipper.style.transform = `rotateX(${a.tiltX}deg) rotateY(${a.tiltY}deg) scale(${a.scale})`
        const mxPct = ((a.mx + 1) / 2) * 100 + '%'
        const myPct = ((a.my + 1) / 2) * 100 + '%'
        flipper.style.setProperty('--mx', mxPct)
        flipper.style.setProperty('--my', myPct)
      }

      if (elapsed >= T.content && localPhase < 3) {
        localPhase = 3; setPhase(3)
        setTimeout(() => setShowShare(true), 2000)
        setTimeout(() => setShowHint(true), 2500)
      }
    }
    animate()
    return () => cancelAnimationFrame(animId)
  }, [data])

  // Navigate: next card slides in from the right
  const handleNextPage = useCallback(() => {
    if (phase < 2 || exitingPage || enteringFrom || currentPage >= TOTAL_PAGES - 1) return
    setCurrentPage(p => p + 1)
    setEnteringFrom('right')
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setEnteringFrom(null)
      })
    })
  }, [phase, exitingPage, enteringFrom, currentPage])

  const handlePrevPage = useCallback(() => {
    if (phase < 2 || exitingPage || enteringFrom || currentPage <= 0) return
    // Slide previous card in from the left on top
    setCurrentPage(p => p - 1)
    setEnteringFrom('left')
    // Let the CSS transition play, then clear
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setEnteringFrom(null)
      })
    })
  }, [phase, exitingPage, enteringFrom, currentPage])

  // Nudge hint: wiggle the top card after idle
  const resetNudgeTimer = useCallback(() => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current)
    setNudging(false)
    nudgeTimerRef.current = setTimeout(function runNudge() {
      setNudging(true)
      setTimeout(() => setNudging(false), 800)
      nudgeTimerRef.current = setTimeout(runNudge, 5000)
    }, 3000)
  }, [])

  useEffect(() => {
    if (phase >= 3) resetNudgeTimer()
    return () => { if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current) }
  }, [phase, resetNudgeTimer])

  // Reset nudge timer on page change
  useEffect(() => { if (phase >= 3) resetNudgeTimer() }, [currentPage, phase, resetNudgeTimer])

  // Keyboard support
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') handleNextPage()
      else if (e.key === 'ArrowLeft') handlePrevPage()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleNextPage, handlePrevPage])

  // Touch swipe support
  const touchRef = useRef<{ startX: number; startY: number } | null>(null)
  useEffect(() => {
    const el = flipperRef.current?.parentElement
    if (!el) return
    const onStart = (e: TouchEvent) => {
      touchRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY }
    }
    const onEnd = (e: TouchEvent) => {
      if (!touchRef.current) return
      const dx = e.changedTouches[0].clientX - touchRef.current.startX
      const dy = e.changedTouches[0].clientY - touchRef.current.startY
      touchRef.current = null
      if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return
      if (dx < 0) handleNextPage()
      else handlePrevPage()
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchend', onEnd) }
  }, [handleNextPage, handlePrevPage])

  const shareOnTwitter = () => {
    const text = encodeURIComponent(`Check out my AI coding stats on Bematist! \u{1F680}\n\n`)
    const url = encodeURIComponent(window.location.href)
    window.open(`https://x.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'width=550,height=420')
  }

  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  // Shared: capture the visible card face as a blob
  const captureCard = async (): Promise<Blob | null> => {
    const flipper = flipperRef.current
    if (!flipper) return null
    const face = flipper.querySelector('.card-stack-item.top') as HTMLElement || flipper.querySelector('.card-front') as HTMLElement
    if (!face) return null

    const origFlipper = flipper.style.transform
    const origFace = face.style.transform
    flipper.style.transform = 'none'
    face.style.transform = 'none'

    try {
      const dataUrl = await toPng(face, { pixelRatio: 2, backgroundColor: '#0d1117' })
      flipper.style.transform = origFlipper
      face.style.transform = origFace
      const res = await fetch(dataUrl)
      return await res.blob()
    } catch {
      flipper.style.transform = origFlipper
      face.style.transform = origFace
      return null
    }
  }

  const [downloading, setDownloading] = useState(false)
  const handleDownload = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      const blob = await captureCard()
      if (!blob) { showToast('Failed to capture card'); return }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = `bematist-card-${currentPage + 1}.png`
      link.href = url
      link.click()
      URL.revokeObjectURL(url)
      showToast('Card saved!')
    } catch {
      showToast('Download failed')
    } finally {
      setDownloading(false)
    }
  }

  const copyImage = async () => {
    try {
      const blob = await captureCard()
      if (!blob) { showToast('Failed to capture card'); return }
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ])
      showToast('Image copied to clipboard!')
    } catch {
      // Fallback: copy URL if image clipboard not supported
      try { await navigator.clipboard.writeText(window.location.href); showToast('Link copied!') }
      catch { showToast('Copy failed') }
    }
  }

  if (error) return <div className="min-h-screen flex items-center justify-center" style={{ background: '#8FA6BB' }}><p className="text-black/40 text-lg">{error}</p></div>
  if (!data) return <div className="min-h-screen flex items-center justify-center" style={{ background: '#8FA6BB' }}><div className="w-8 h-8 border-4 border-[#5A7B9B] border-t-transparent rounded-full animate-spin" /></div>

  const s = data.stats
  const hl = s.highlights
  const userName = data.user?.displayName || 'Developer'
  const totalTokens = getTotalTokens(s)
  const tier = getTier(statView === 'claude' ? s.claude.sessions : statView === 'codex' ? s.codex.sessions : s.combined.totalSessions)
  const lvl = getLevel(statView === 'claude' ? s.claude.sessions : statView === 'codex' ? s.codex.sessions : s.combined.totalSessions)
  const personalityCombined = hl ? mapPersonality(hl.personality) : getPersonality(s.claude.hourDistribution)
  const personalityClaude = getPersonality(s.claude.hourDistribution)
  const personalityCodex = getCodexPersonality(s)
  const personality = statView === 'codex' ? personalityCodex : statView === 'claude' ? personalityClaude : personalityCombined
  const hourBars = normalizeHours(s.claude.hourDistribution)
  const topTools = s.claude.topTools.slice(0, 5)

  const cacheSaved = getCacheSaved(s)
  const achievements = getAchievements(s, statView)
  
  const activeDays = s.combined.totalActiveDays ?? s.claude.activeDays
  const allModels = Object.entries({ ...s.claude.models, ...s.codex.models })
    .map(([name, d]) => ({ name, cost: d.cost, sessions: d.sessions }))
    .filter(m => m.cost > 0 && m.name !== 'unknown')
    .sort((a, b) => b.cost - a.cost).slice(0, 5)

  // Merge projects
  const projectMap = new Map<string, { sessions: number; cost: number; source: string }>()
  for (const p of s.claude.projects ?? []) {
    const n = cleanProjectName(p.name)
    projectMap.set(n, { sessions: p.sessions, cost: p.cost, source: 'claude' })
  }
  for (const p of s.codex?.projects ?? []) {
    const n = cleanProjectName(p.name)
    const ex = projectMap.get(n)
    if (ex) { ex.sessions += p.sessions; ex.cost += p.cost; ex.source = 'both' }
    else projectMap.set(n, { sessions: p.sessions, cost: p.cost, source: 'codex' })
  }
  const topProjects = Array.from(projectMap.entries()).map(([name, d]) => ({ name, ...d })).sort((a, b) => b.cost - a.cost).slice(0, 8)
  const mostExpensive = hl?.mostExpensiveSession
  const activityCategories = (hl?.activityCategories ?? []).slice(0, 5)
  const actCatColors = ['#7a6299', '#5a80a8', '#c47a20', '#3a9a7a', '#d97706']

  // Daily distribution for 30-day heatmap
  const dailyDist = s.combined.dailyDistribution ?? []

  // View-specific stats for Claude/Codex toggle
  const viewTokens = statView === 'claude' ? s.claude.inputTokens + s.claude.outputTokens
    : statView === 'codex' ? s.codex.inputTokens + s.codex.outputTokens : totalTokens
  const viewCost = statView === 'claude' ? s.claude.cost
    : statView === 'codex' ? s.codex.cost : s.combined.totalCost
  const viewCacheSaved = statView === 'codex'
    ? (s.codex.cachedInputTokens ? formatTokens(s.codex.cachedInputTokens) + ' cached' : '$0')
    : cacheSaved
  const viewActiveDays = statView === 'claude' ? s.claude.activeDays
    : statView === 'codex' ? (s.codex.activeDays ?? 0) : activeDays
  const viewStreak = statView === 'codex' ? (s.codex.activeDays ?? 0) : (hl?.longestStreak ?? s.claude.activeDays)

  // View-specific models
  const viewModels = statView === 'combined' ? allModels
    : Object.entries(statView === 'claude' ? s.claude.models : s.codex.models)
        .map(([name, d]) => ({ name, cost: d.cost, sessions: d.sessions }))
        .filter(m => m.cost > 0 && m.name !== 'unknown')
        .sort((a, b) => b.cost - a.cost).slice(0, 5)

  // View-specific projects
  const viewProjects = statView === 'combined' ? topProjects
    : (statView === 'claude' ? s.claude.projects ?? [] : s.codex.projects ?? [])
        .map(p => ({ name: cleanProjectName(p.name), sessions: p.sessions, cost: p.cost, source: statView }))
        .sort((a, b) => b.cost - a.cost).slice(0, 8)

  const show = phase >= 3

  // Page footer with dots
  const renderPage = (page: number) => {
    switch (page) {
      case 0: return (
        <div className="card-content">
          <div className={`top-row reveal ${show ? 'show' : ''}`}>
            <div className="brand">BEMATIST</div>
            <div className="tier">{tier}</div>
          </div>
          <div className={`reveal ${show ? 'show' : ''}`} style={{ transitionDelay: '130ms' }}>
            <div className="user-name">{userName}</div>
            <div className="user-sub">{data.user?.githubUsername ? `@${data.user.githubUsername}` : ''}</div>
          </div>
          <div className={`hero reveal ${show ? 'show' : ''}`} style={{ transitionDelay: '260ms' }}>
            <div className="hero-label">Tokens Generated</div>
            <div className="hero-num">
              <span>{formatTokens(viewTokens)}</span>
              <span className="hero-unit">tokens</span>
            </div>
          </div>
          <div className={`reveal ${show ? 'show' : ''}`} style={{ transitionDelay: '390ms' }}>
            <div className="streak-level">
              <div className="streak"><FlameIcon /> {viewStreak} day streak</div>
              <div className="sep" />
              <div className="lvl-t">Lvl {lvl.level} {'\u00B7'} {lvl.title}</div>
            </div>
            <div className="lvl-track">
              <div className={`lvl-fill ${show ? 'go' : ''}`} style={{ '--lvl-pct': `${lvl.pct}%` } as React.CSSProperties} />
            </div>
          </div>
          {/* GitHub contribution graph */}
          <div className={`reveal ${show ? 'show' : ''}`} style={{ transitionDelay: '520ms', marginTop: 'auto' }}>
            <div className="gh-heatmap">
              {(() => {
                // Always render a fixed 7 × 22 grid (last ~22 weeks), regardless of how sparse the data is.
                const WEEKS = 22
                const endDate = new Date()
                endDate.setHours(12, 0, 0, 0)
                // Grid ends on Saturday of current week; walk back to find the Sunday that starts the 22nd-prev week.
                const gridEnd = new Date(endDate)
                gridEnd.setDate(endDate.getDate() + (6 - endDate.getDay()))
                const gridStart = new Date(gridEnd)
                gridStart.setDate(gridEnd.getDate() - (WEEKS * 7 - 1))
                const rangeStartKey = gridStart.toISOString().split('T')[0]
                const rangeEndKey = endDate.toISOString().split('T')[0]
                const dayMap = new Map(dailyDist.map(d => [d.date, d]))
                const cells: Array<{ date: string; sessions: number; claude: number; codex: number; inRange: boolean }> = []
                const cursor = new Date(gridStart)
                for (let i = 0; i < WEEKS * 7; i++) {
                  const key = cursor.toISOString().split('T')[0]
                  const d = dayMap.get(key)
                  const ss = d ? (statView === 'claude' ? d.claudeSessions : statView === 'codex' ? d.codexSessions : d.sessions) : 0
                  cells.push({
                    date: key,
                    sessions: ss,
                    claude: d?.claudeSessions ?? 0,
                    codex: d?.codexSessions ?? 0,
                    inRange: key >= rangeStartKey && key <= rangeEndKey,
                  })
                  cursor.setDate(cursor.getDate() + 1)
                }
                const maxS = Math.max(...cells.map(c => c.sessions), 1)
                return (
                  <div className="gh-grid-wrap">
                    <div className="gh-day-labels">
                      {['', 'M', '', 'W', '', 'F', ''].map((l, i) => <span key={i}>{l}</span>)}
                    </div>
                    <div className="gh-grid" style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)` }}>
                      {Array.from({ length: WEEKS }, (_, col) =>
                        Array.from({ length: 7 }, (_, row) => {
                          const cell = cells[col * 7 + row]
                          const intensity = cell.sessions / maxS
                          const hasClaude = statView !== 'codex' && cell.claude > 0
                          const hasCodex = statView !== 'claude' && cell.codex > 0
                          const label = new Date(cell.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          return (
                            <div key={`${col}-${row}`} className="gh-cell"
                              title={cell.inRange ? `${label}: ${cell.sessions} sessions` : ''}
                              style={{
                                background: cell.sessions === 0 ? undefined : getDailyColor(intensity, hasClaude, hasCodex, cardTheme === 'cream'),
                                gridRow: row + 1, gridColumn: col + 1,
                              }}
                            />
                          )
                        })
                      )}
                    </div>
                  </div>
                )
              })()}
            </div>
            <div className="gh-legend"><span>{viewActiveDays} active days</span></div>
          </div>
        </div>
      )

      case 1: return (
        <div className="card-content">
          <div className="top-row"><div className="brand">BEMATIST</div><div className="page-title">Identity</div></div>
          <div className="wrap-insight">
            <div className="wrap-emoji">
              {personality.name.includes('Midnight') ? '\u{1F319}' : personality.name.includes('Dawn') ? '\u{1F305}' : personality.name.includes('Twilight') ? '\u{1F307}' : personality.name.includes('Relentless') ? '\u{26A1}' : personality.name.includes('Weekend') ? '\u{1F3D6}' : '\u{2600}\u{FE0F}'}
            </div>
            <div className="wrap-lead">You are a</div>
            <div className="wrap-hero">{personality.name}</div>
            {personality.desc && <div className="wrap-sub" style={{ color: '#64748b', fontSize: 12 }}>{personality.desc}</div>}
          </div>
          <div className="p2-stats">
            <div className="p2-stat">
              <span className="p2-stat-val purple">{formatTokens(viewTokens)}</span>
              <span className="p2-stat-lbl">tokens</span>
            </div>
            <div className="p2-stat-sep" />
            <div className="p2-stat">
              <span className="p2-stat-val blue">{formatCost(viewCost)}</span>
              <span className="p2-stat-lbl">spent</span>
            </div>
            <div className="p2-stat-sep" />
            <div className="p2-stat">
              <span className="p2-stat-val green">{viewActiveDays}d</span>
              <span className="p2-stat-lbl">active</span>
            </div>
          </div>
          {achievements.length > 0 && (
            <div className="p2-badges">
              <div className="p2-badges-title">Badges Earned</div>
              <div className="p2-badge-row">
                {achievements.slice(0, 4).map(a => (
                  <div className="p2-pill" key={a.name}>
                    <AchievementSvg icon={a.icon} color={a.color} />
                    <span>{a.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )

      case 2: return (
        <div className="card-content">
          <div className="top-row" style={{ marginBottom: 20 }}><div className="brand">BEMATIST</div><div className="page-title">Activity</div></div>
          {statView !== 'codex' ? (<>
            <SectionHead title="Activity by Hour" sub="When you code the most throughout the day" />
            <div className="hour-chart" style={{ height: 100, marginBottom: 4 }}>
              {hourBars.map((val, i) => (
                <div key={i} className="hour-bar pop" style={{ height: `${Math.max(val * 100, 5)}%`, background: getHourBarColor(val) }} />
              ))}
            </div>
            <div className="hour-labels"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
          </>) : (<>
            <div className="hm-ti" style={{ marginBottom: 8 }}>Codex Insights</div>
            <div className="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 8 }}>
              <div className="sc"><div className="sc-l">Tool Calls</div><div className="sc-v purple">{(s.codex.totalToolCalls ?? 0).toLocaleString()}</div></div>
              <div className="sc"><div className="sc-l">Reasoning</div><div className="sc-v blue">{(s.codex.totalReasoningBlocks ?? 0).toLocaleString()}</div></div>
              <div className="sc"><div className="sc-l">Web Searches</div><div className="sc-v green">{(s.codex.totalWebSearches ?? 0).toLocaleString()}</div></div>
            </div>
          </>)}
          <div className="cost-hero" style={{ marginTop: 20 }}>
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 32, fontWeight: 700, color: cardTheme === 'cream' ? '#1a1a2e' : '#e2e8f0', lineHeight: 1 }}>{formatCost(viewCost)}</div>
              <div className="sc-l" style={{ fontSize: 10, marginTop: 6 }}>total spend</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 32, fontWeight: 700, color: cardTheme === 'cream' ? '#3a9a7a' : '#34d399', lineHeight: 1 }}>{viewCacheSaved}</div>
              <div className="sc-l" style={{ fontSize: 10, marginTop: 6 }}>saved by caching</div>
            </div>
          </div>
          {activityCategories.length > 0 && (<>
            <SectionHead title="How You Use AI" sub="What type of work your AI agent does" />
            <div className="tb go" style={{ height: 10 }}>
              {activityCategories.map((cat, i) => (
                <div key={cat.category} style={{ flex: cat.sessionPct, background: actCatColors[i % actCatColors.length], borderRadius: 3 }} />
              ))}
            </div>
            <div className="tb-leg" style={{ marginTop: 20 }}>
              {activityCategories.map((cat, i) => (
                <span key={cat.category} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: actCatColors[i % actCatColors.length], display: 'inline-block' }} />
                  {cat.category} {cat.sessionPct}%
                </span>
              ))}
            </div>
          </>)}
        </div>
      )

      case 3: return (
        <div className="card-content">
          <div className="top-row"><div className="brand">BEMATIST</div><div className="page-title">Tools</div></div>
          {(() => {
            const viewTools = statView === 'codex'
              ? (s.codex.topTools ?? []).slice(0, 5)
              : statView === 'claude' ? topTools : topTools
            if (viewTools.length === 0) return <div style={{ padding: '20px 0', textAlign: 'center', color: cardTheme === 'cream' ? 'rgba(26,26,46,.25)' : 'rgba(255,255,255,.25)', fontSize: 11 }}>No tool data available</div>
            const top = viewTools[0]
            const topDisplay = getToolDisplay(top.name)
            const rest = viewTools.slice(1)
            return (<>
              <SectionHead title="Top Tools" sub="Most used capabilities by your AI agent" />
              {/* Hero: #1 tool */}
              <div className="tool-hero">
                <div className="tool-hero-rank">#1</div>
                <div className="tool-hero-name">{topDisplay.name}</div>
                <div className="tool-hero-count">{formatTokens(top.count)}</div>
                <div className="tool-hero-desc">{topDisplay.desc || 'calls'}</div>
              </div>
              {/* Rest as grid */}
              <div className="tool-grid">
                {rest.map((t, i) => {
                  const display = getToolDisplay(t.name)
                  return (
                    <div className="tool-card" key={t.name}>
                      <div className="tool-card-rank">#{i + 2}</div>
                      <div className="tool-card-name">{display.name}</div>
                      <div className="tool-card-count">{formatTokens(t.count)}</div>
                      {display.desc && <div className="tool-card-desc">{display.desc}</div>}
                    </div>
                  )
                })}
              </div>
            </>)
          })()}
        </div>
      )

      case 4: {
        // Determine which agent logo to show based on top model
        const topModelName = viewModels[0]?.name?.toLowerCase() ?? ''
        const isClaude = topModelName.includes('opus') || topModelName.includes('sonnet') || topModelName.includes('haiku')
        const isCodex = topModelName.includes('codex') || topModelName.includes('gpt')
        const agentLogo = isClaude ? '/claudecode-color.svg' : isCodex ? '/codex-color.svg' : null

        return (
        <div className="card-content" style={{ position: 'relative', overflow: 'hidden' }}>
          {/* Agent logo overlay — big, centered, transparent */}
          {agentLogo && (
            <img
              src={agentLogo}
              alt=""
              style={{
                position: 'absolute',
                top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '65%', height: 'auto',
                opacity: cardTheme === 'cream' ? 0.06 : 0.08,
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />
          )}
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="top-row"><div className="brand">BEMATIST</div><div className="page-title">Models</div></div>
            <SectionHead title="Your Favorite Model" sub="The AI model you used the most" />
            {/* Hero model */}
            <div className="wrap-insight">
              <div className="wrap-emoji">
                {isClaude ? (
                  <img src="/claudecode-color.svg" alt="Claude" style={{ width: 32, height: 32 }} />
                ) : isCodex ? (
                  <img src="/codex-color.svg" alt="Codex" style={{ width: 32, height: 32 }} />
                ) : (
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={cardTheme === 'cream' ? '#7a6299' : '#a78bfa'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                )}
              </div>
              <div className="wrap-lead">You love to work with</div>
              <div className="wrap-hero">{viewModels[0] ? shortModelName(viewModels[0].name) : 'Unknown'}</div>
              <div className="wrap-sub">{viewModels[0]?.sessions.toLocaleString() ?? 0} sessions {'\u00B7'} {viewModels[0] ? formatCost(viewModels[0].cost) : '$0'} spent</div>
            </div>
            {/* Other models */}
            {/* <SectionHead title="Also powered by" sub={`${viewModels.length} models used in total`} /> */}
            <div className="wrap-others" style={{marginTop: 15}}>
              {viewModels.slice(1).map((m, i) => {
                const mLower = m.name.toLowerCase()
                const mIsClaude = mLower.includes('opus') || mLower.includes('sonnet') || mLower.includes('haiku')
                const mIsCodex = mLower.includes('codex') || mLower.includes('gpt')
                return (
                  <div className="wrap-other" key={m.name}>
                    <div className="wrap-other-rank" style={{ fontSize: 14, color: '#38bdf8', fontWeight: 800 }}>#{i + 2}</div>
                    {mIsClaude ? (
                      <img src="/claudecode-color.svg" alt="" style={{ width: 10, height: 10 }} />
                    ) : mIsCodex ? (
                      <img src="/codex-color.svg" alt="" style={{ width: 10, height: 10 }} />
                    ) : (
                      <div className="mdot" style={{ background: getModelColors(m.name), width: 8, height: 8 }} />
                    )}
                    <span className="wrap-other-name">{shortModelName(m.name)}</span>
                    <span className="wrap-other-val">{formatCost(m.cost)}</span>
                    <span className="wrap-other-sessions">{m.sessions.toLocaleString()}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      case 5: return (
        <div className="card-content">
          <div className="top-row"><div className="brand">BEMATIST</div><div className="page-title">Projects</div></div>
          <SectionHead title="Your Top Project" sub="Where you spent the most time with AI" />
          <div className="wrap-insight" style={{ paddingBottom: 16 }}>
            <div className="wrap-emoji"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={cardTheme === 'cream' ? '#7a6299' : '#a78bfa'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></div>
            <div className="wrap-lead">You built the most in</div>
            <div className="wrap-hero">{viewProjects[0]?.name ?? 'Unknown'}</div>
            <div className="wrap-sub">{viewProjects[0]?.sessions.toLocaleString() ?? 0} sessions {'\u00B7'} {viewProjects[0] ? formatCost(viewProjects[0].cost) : '$0'} spent</div>
          </div>
          {/* <SectionHead title="Also worked on" sub="" /> */}
          <div className="wrap-others">{viewProjects.slice(1, 5).map((p, i) => (
            <div className="wrap-other" key={p.name}>
              <div className="wrap-other-rank" style={{ fontSize: 14, color: '#38bdf8', fontWeight: 800 }}>#{i + 2}</div>
              <div className="mdot" style={{ background: p.source === 'codex' ? '#60a5fa' : '#a78bfa', width: 8, height: 8 }} />
              <span className="wrap-other-name">{p.name}</span>
              <span className="wrap-other-val">{formatCost(p.cost)}</span>
            </div>
          ))}</div>
        </div>
      )

      case 6: {
        // ─── Analytics page ───
        const viewToolCalls = statView === 'claude'
          ? (s.claude.totalToolCalls ?? 0)
          : statView === 'codex' ? (s.codex.totalToolCalls ?? 0)
          : (s.claude.totalToolCalls ?? 0) + (s.codex.totalToolCalls ?? 0)
        const viewSessions = statView === 'claude' ? s.claude.sessions
          : statView === 'codex' ? s.codex.sessions : s.combined.totalSessions
        const daily = dailyDist
          .map(d => ({
            date: d.date,
            cost: statView === 'claude'
              ? (d.claudeSessions / Math.max(d.sessions, 1)) * d.cost
              : statView === 'codex' ? (d.codexSessions / Math.max(d.sessions, 1)) * d.cost
              : d.cost,
          }))
          .filter(d => !Number.isNaN(d.cost))
        const maxCost = Math.max(...daily.map(d => d.cost), 0.001)
        const firstDate = daily[0]?.date ? new Date(daily[0].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
        const lastDate = daily[daily.length - 1]?.date ? new Date(daily[daily.length - 1].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
        const chartW = 324
        const chartH = 84
        const linePath = daily.length > 1
          ? daily.map((d, i) => {
              const x = (i / (daily.length - 1)) * chartW
              const y = chartH - (d.cost / maxCost) * chartH
              return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
            }).join(' ')
          : ''
        const areaPath = linePath ? `${linePath} L${chartW},${chartH} L0,${chartH} Z` : ''
        const projBars = viewProjects.slice(0, 5)
        const projMax = Math.max(...projBars.map(p => p.cost), 0.001)
        const peakCost = Math.max(...daily.map(d => d.cost), 0)
        const peakIdx = daily.findIndex(d => d.cost === peakCost)
        const peakDate = peakIdx >= 0 && daily[peakIdx]?.date
          ? new Date(daily[peakIdx].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : ''
        return (
          <div className="card-content">
            <div className="top-row"><div className="brand">BEMATIST</div><div className="page-title">Analytics</div></div>
            <SectionHead title="Analytics" sub="Session costs and activity patterns" />
            <div className="an-stats">
              <div className="an-stat">
                <span className="an-stat-val">{viewSessions.toLocaleString()}</span>
                <span className="an-stat-lbl">Sessions</span>
              </div>
              <div className="an-stat">
                <span className="an-stat-val blue">{formatCost(viewCost)}</span>
                <span className="an-stat-lbl">Cost</span>
              </div>
              <div className="an-stat">
                <span className="an-stat-val purple">{formatTokens(viewTokens)}</span>
                <span className="an-stat-lbl">Tokens</span>
              </div>
              <div className="an-stat">
                <span className="an-stat-val green">{formatTokens(viewToolCalls)}</span>
                <span className="an-stat-lbl">Tool Calls</span>
              </div>
            </div>
            <div className="an-section">
              <div className="an-section-head">
                <span className="an-section-title">Cost Over Time</span>
                {peakDate && <span className="an-section-meta">peak {formatCost(peakCost)} {'\u00B7'} {peakDate}</span>}
              </div>
              <div className="an-chart-wrap">
                {linePath ? (
                  <svg width="100%" height={chartH} viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="none" className="an-chart">
                    <defs>
                      <linearGradient id="an-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <path d={areaPath} fill="url(#an-fill)" />
                    <path d={linePath} fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <div className="an-chart-empty">Not enough data yet</div>
                )}
                <div className="an-chart-labels">
                  <span>{firstDate}</span>
                  <span>{lastDate}</span>
                </div>
              </div>
            </div>
            <div className="an-section">
              <div className="an-section-head">
                <span className="an-section-title">Cost by Project</span>
                <span className="an-section-meta">{projectMap.size} projects</span>
              </div>
              <div className="an-bars">
                {projBars.map(p => (
                  <div className="an-bar-row" key={p.name}>
                    <span className="an-bar-label">{p.name}</span>
                    <div className="an-bar-track">
                      <div
                        className={`an-bar-fill ${show ? 'go' : ''}`}
                        style={{ '--an-bar-pct': `${(p.cost / projMax) * 100}%` } as React.CSSProperties}
                      />
                    </div>
                    <span className="an-bar-val">{formatCost(p.cost)}</span>
                  </div>
                ))}
                {projBars.length === 0 && <div className="an-chart-empty">No projects yet</div>}
              </div>
            </div>
          </div>
        )
      }

      case 7: return (
        <div className="card-content">
          <div className="top-row"><div className="brand">BEMATIST</div><div className="page-title">Summary</div></div>
          <SectionHead title="Your Coding Journey" sub="Everything at a glance" />
          <div className="sum-grid">
            <div className="sum-card"><div className="sum-val" style={{ color: cardTheme === 'cream' ? '#1a1a2e' : '#e2e8f0' }}>{formatTokens(viewTokens)}</div><div className="sum-label">tokens generated</div></div>
            <div className="sum-card"><div className="sum-val" style={{ color: '#38bdf8' }}>{formatCost(viewCost)}</div><div className="sum-label">total spent</div></div>
            <div className="sum-card"><div className="sum-val" style={{ color: '#34d399' }}>{viewCacheSaved}</div><div className="sum-label">saved by caching</div></div>
            <div className="sum-card"><div className="sum-val" style={{ color: '#f59e0b' }}>{viewActiveDays}d</div><div className="sum-label">active</div></div>
          </div>
          {mostExpensive && (<div className="sum-callout"><div className="sum-callout-label">Biggest single session</div><div className="sum-callout-val">{formatCost(mostExpensive.cost)}</div><div className="sum-callout-project">{cleanProjectName(mostExpensive.project)} {'\u00B7'} {mostExpensive.date}</div></div>)}
          <div className="sum-footer"><div className="sum-tagline">illuminate your code</div></div>
        </div>
      )

      default: return null
    }
  }

  // Card face background
  const CardBg = () => (
    <>
      <div className="card-bg" />
      <div className="aurora-blob ab1" /><div className="aurora-blob ab2" /><div className="aurora-blob ab3" />
      <div className="card__fire" />
      <div className="card__cyan" />
      <div className="sheen" />
    </>
  )

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#8FA6BB', overflow: 'hidden', width: '100vw', height: '100vh', WebkitFontSmoothing: 'antialiased' }}>
      {/* Grid background — same as landing page */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, pointerEvents: 'none', backgroundImage: 'linear-gradient(rgba(90,123,155,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(90,123,155,0.15) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      {/* Top bar: source toggle + theme toggle */}
      <div className={`global-toggle ${showShare ? 'show' : ''}`}>
        {s.codex.sessions > 0 && (
          <div className="source-toggle">
            <button className={`stog ${statView === 'combined' ? 'active' : ''}`} onClick={() => setStatView('combined')}>All</button>
            <button className={`stog ${statView === 'claude' ? 'active' : ''}`} onClick={() => setStatView('claude')}>Claude</button>
            <button className={`stog ${statView === 'codex' ? 'active' : ''}`} onClick={() => setStatView('codex')}>Codex</button>
          </div>
        )}
        {/* theme toggle hidden for now
        <button className="theme-toggle" onClick={() => setCardTheme(t => t === 'cream' ? 'dark' : 'cream')} title={cardTheme === 'cream' ? 'Switch to dark' : 'Switch to cream'}>
          {cardTheme === 'cream' ? <MoonIcon /> : <SunIcon />}
        </button>
        */}
      </div>

      <div className={`card-scene ${cardTheme}`}>
        <div className="card-flipper" ref={flipperRef} style={{ opacity: 0 }}>
          {/* Single card — slides in/out */}
          <div
            className={`card-stack-item top pharos-holo ${nudging ? 'nudge' : ''}`}
            data-rarity="radiant rare"
            style={{
              position: 'absolute', inset: 0,
              zIndex: 5,
              transform: enteringFrom
                ? `translateX(${(enteringFrom === 'left' ? -1 : 1) * 120}%) rotate(${(enteringFrom === 'left' ? -1 : 1) * 12}deg)`
                : undefined,
              opacity: enteringFrom ? 0 : 1,
              transition: enteringFrom ? 'none' : 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease',
              borderRadius: '24px',
              overflow: 'hidden',
            }}
          >
            <CardBg />
            {renderPage(currentPage)}
            <div className="pharos-holo-shine" aria-hidden="true" />
            <div className="pharos-holo-glare" aria-hidden="true" />
            {currentPage === 0 && (
              <div className={`card-splash ${phase >= 3 ? 'hide' : ''}`}>
                <div className="splash-grid" />
                <div className="splash-glow" />
                <div className="splash-content">
                  <div className="splash-icon">
                    <svg width="56" height="56" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
                      <defs>
                        <linearGradient id="splashGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#8b5cf6"/><stop offset="100%" stopColor="#ec4899"/></linearGradient>
                        <linearGradient id="splashBeam" x1="32" y1="20" x2="58" y2="20" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#c084fc" stopOpacity=".8"/><stop offset=".5" stopColor="#a855f7" stopOpacity=".4"/><stop offset="1" stopColor="#8b5cf6" stopOpacity="0"/>
                        </linearGradient>
                        <radialGradient id="splashHalo" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(32 20) rotate(90) scale(7.2)">
                          <stop stopColor="#e9d5ff"/><stop offset=".5" stopColor="#c084fc" stopOpacity=".4"/><stop offset="1" stopColor="#8b5cf6" stopOpacity="0"/>
                        </radialGradient>
                        <filter id="splashBlur" x="24" y="2" width="38" height="36" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="2.7"/></filter>
                        <filter id="splashHaloBlur" x="20" y="8" width="24" height="24" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="3.1"/></filter>
                      </defs>
                      {/* Beam — static */}
                      <g opacity=".5">
                        <path d="M32 20L58 10.5V29.5L32 20Z" fill="url(#splashBeam)" filter="url(#splashBlur)"/>
                      </g>
                      {/* Waves */}
                      <path d="M9 50C13 49 17 51 21 50S29 48 33 50S41 52 45 50S49 48 55 50" fill="none" stroke="#a855f7" strokeLinecap="round" strokeWidth="1.5" opacity=".4"/>
                      <path d="M9 48C13 47 17 49 21 48S29 46 33 48S41 50 45 48S49 46 55 48" fill="none" stroke="#c084fc" strokeLinecap="round" strokeWidth="2" opacity=".6"/>
                      <path d="M9 52C13 51 17 53 21 52S29 50 33 52S41 54 45 52S49 50 55 52" fill="none" stroke="#e9d5ff" strokeLinecap="round" strokeWidth="1.3" opacity=".5"/>
                      {/* Base */}
                      <path d="M22.4 48.3H41.6L39.4 43.6H24.6Z" fill="#7c3aed" opacity=".7"/>
                      <path d="M24.3 43.7H39.7L38.5 41.2H25.5Z" fill="#8b5cf6" opacity=".6"/>
                      {/* Tower */}
                      <path d="M27.6 41.5L29.6 23.8H34.4L36.4 41.5Z" fill="url(#splashGrad)" opacity=".25"/>
                      <path d="M27.6 41.5L29.6 23.8H34.4L36.4 41.5Z" fill="none" stroke="url(#splashGrad)" strokeWidth=".8"/>
                      <rect x="29.55" y="28.25" width="4.9" height=".9" rx=".45" fill="#c084fc" opacity=".4"/>
                      <rect x="29.2" y="31.05" width="5.6" height=".9" rx=".45" fill="#a855f7" opacity=".35"/>
                      <rect x="28.85" y="33.85" width="6.3" height=".9" rx=".45" fill="#8b5cf6" opacity=".3"/>
                      {/* Balcony */}
                      <path d="M25.4 22.8H38.6L37.6 25H26.4Z" fill="#c084fc" opacity=".4"/>
                      <rect x="26.7" y="20.9" width=".55" height="2.05" rx=".2" fill="#a855f7" opacity=".5"/>
                      <rect x="28.35" y="20.55" width=".55" height="2.4" rx=".2" fill="#a855f7" opacity=".5"/>
                      <rect x="30" y="20.3" width=".55" height="2.65" rx=".2" fill="#a855f7" opacity=".5"/>
                      <rect x="31.75" y="20.15" width=".55" height="2.8" rx=".2" fill="#a855f7" opacity=".5"/>
                      <rect x="33.5" y="20.3" width=".55" height="2.65" rx=".2" fill="#a855f7" opacity=".5"/>
                      <rect x="35.15" y="20.55" width=".55" height="2.4" rx=".2" fill="#a855f7" opacity=".5"/>
                      <rect x="36.8" y="20.9" width=".55" height="2.05" rx=".2" fill="#a855f7" opacity=".5"/>
                      {/* Lamp room */}
                      <rect x="29.05" y="16.8" width="5.9" height="5.2" rx=".65" fill="#e9d5ff" opacity=".6"/>
                      <rect x="29.8" y="17.35" width="4.4" height="3.95" rx=".5" fill="#faf5ff" opacity=".8"/>
                      <path d="M28.45 17.1H35.55L34.55 15.1H29.45Z" fill="#7c3aed" opacity=".6"/>
                      <rect x="29.2" y="14.55" width="5.6" height=".85" rx=".42" fill="#6d28d9" opacity=".5"/>
                      <rect x="30.95" y="13.75" width="2.1" height=".9" rx=".45" fill="#8b5cf6" opacity=".5"/>
                      {/* Halo */}
                      <circle cx="32" cy="20" r="5.8" fill="url(#splashHalo)" opacity=".5" filter="url(#splashHaloBlur)"/>
                      <circle cx="32" cy="20" r="1.9" fill="#faf5ff"/>
                      {/* Door */}
                      <path d="M30.3 41.5V37.2C30.3 35.95 31.02 35.1 32 35.1C32.98 35.1 33.7 35.95 33.7 37.2V41.5Z" fill="#6d28d9" opacity=".5"/>
                      {/* Stars */}
                      <g opacity=".5"><path d="M18.4 15.1L18.4 17.7" stroke="#c084fc" strokeWidth="1.1" strokeLinecap="round"/><path d="M17.1 16.4L19.7 16.4" stroke="#c084fc" strokeWidth="1.1" strokeLinecap="round"/></g>
                      <g opacity=".6"><path d="M47.6 11.05L47.6 13.75" stroke="#f0abfc" strokeWidth="1.1" strokeLinecap="round"/><path d="M46.15 12.4L49.05 12.4" stroke="#f0abfc" strokeWidth="1.1" strokeLinecap="round"/></g>
                      <circle cx="44.3" cy="18" r=".85" fill="#c084fc" opacity=".5"/>
                    </svg>
                  </div>
                  <div className="splash-brand">BEMATIST</div>
                  <div className="splash-sub">illuminating your code</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation arrows — sides of card */}
      <button className={`card-nav-side card-nav-left ${showShare ? 'show' : ''}`} onClick={handlePrevPage} title="Previous"><ChevronLeft /></button>
      <button className={`card-nav-side card-nav-right ${showShare ? 'show' : ''}`} onClick={handleNextPage} title="Next"><ChevronRight /></button>

      {/* Page dots — below card */}
      <div className={`card-page-dots ${showShare ? 'show' : ''}`}>
        {Array.from({ length: TOTAL_PAGES }, (_, i) => (
          <div key={i} className={`card-page-dot ${i === currentPage ? 'active' : ''}`} />
        ))}
      </div>

      <div className={`share-bar ${showShare ? 'show' : ''}`}>
        <button className="sb" title="Download PNG" onClick={handleDownload}><DownloadIcon /></button>
        <button className="sb" title="Copy image to clipboard" onClick={copyImage}><CopyIcon /></button>
        <button className="sb" title="Share on X" onClick={shareOnTwitter}>
          <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
        </button>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button className="sb" title="Share" onClick={async () => {
            try {
              await navigator.share({
                title: `${userName}'s Bematist Card`,
                text: 'Check out my AI coding stats on Bematist!',
                url: window.location.href,
              })
            } catch { /* user cancelled */ }
          }}><ShareIcon /></button>
        )}
      </div>

      {/* Toast */}
      {toast && <div className="card-toast">{toast}</div>}
    </div>
  )
}
