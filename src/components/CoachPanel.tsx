import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Bot, ChevronDown, RefreshCw, Send, Sparkles } from 'lucide-react'
import { CLASSIFICATION_META, sanToPortuguese } from '../lib/analysis'
import type { GameAnalysis, MoveEvaluation } from '../lib/analysis'
import { buildDiagnosisContext, buildMoveCoachContext, coachStatus, replyMatchesSelection, requestCoach } from '../lib/coach'
import type { CoachRequest } from '../lib/coach'
import type { GameSummary } from '../lib/games'
import CoachMarkdown from './CoachMarkdown'

type Message = { id: number; ply: number; role: 'user' | 'assistant'; text: string }
type Mode = CoachRequest['mode']
const quickQuestions = ['Por que foi um erro?', 'Qual era a melhor jogada?', 'O que eu não percebi?', 'Explique de forma simples.']

export default function CoachPanel({ game, analysis, move, ply, onJump }: {
  game: GameSummary; analysis: GameAnalysis | null; move: MoveEvaluation | null; ply: number; onJump: (ply: number) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [status, setStatus] = useState<{ ready: boolean; model?: string; reason?: string } | null>(null)
  const [statusError, setStatusError] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [diagnosis, setDiagnosis] = useState('')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState<Mode | null>(null)
  const [errorInfo, setErrorInfo] = useState<{ text: string; ply: number; mode: Mode } | null>(null)
  const requestRef = useRef<{ id: number; mode: Mode; ply: number; controller: AbortController } | null>(null)
  const questionRef = useRef<HTMLTextAreaElement>(null)
  const activePlyRef = useRef(ply)
  const serial = useRef(0)
  const [lastAttempt, setLastAttempt] = useState<{ mode: Mode; question?: string; ply: number } | null>(null)
  const currentMessages = messages.filter((item) => item.ply === ply)
  const visited = useMemo(() => [...new Set(messages.map((item) => item.ply))].sort((a, b) => a - b), [messages])

  function refreshStatus() {
    const controller = new AbortController()
    coachStatus(controller.signal).then(setStatus).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setStatus(null); setStatusError(cause instanceof Error ? cause.message : 'Servidor do treinador indisponível.') }
    })
    return controller
  }

  useEffect(() => {
    const controller = refreshStatus()
    return () => { controller.abort(); requestRef.current?.controller.abort(); requestRef.current = null }
  }, [])

  useLayoutEffect(() => {
    activePlyRef.current = ply
    const request = requestRef.current
    if (request && request.mode !== 'diagnosis' && request.ply !== ply) request.controller.abort()
  }, [ply])

  useLayoutEffect(() => {
    const field = questionRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  }, [question])

  async function send(mode: Mode, asked?: string) {
    if (!analysis || !status?.ready || requestRef.current) return
    if (mode !== 'diagnosis' && !move) return
    const clean = asked?.trim()
    if (mode === 'chat' && !clean) return
    const targetPly = ply
    const payload: CoachRequest = mode === 'diagnosis'
      ? { mode, context: buildDiagnosisContext(game, analysis) }
      : { mode, context: buildMoveCoachContext(game, move!, analysis.depth),
          question: mode === 'chat' ? clean : undefined,
          history: mode === 'chat' ? currentMessages.slice(-6).map(({ role, text }) => ({ role, text: text.slice(0, 800) })) : undefined }
    const controller = new AbortController()
    const id = ++serial.current
    requestRef.current = { id, mode, ply: targetPly, controller }
    setLastAttempt({ mode, question: clean, ply: targetPly })
    setErrorInfo(null); setBusy(mode); setExpanded(true)
    if (mode !== 'diagnosis') {
      const label = mode === 'explain' ? 'Explique esta jogada.' : clean!
      setMessages((items) => [...items, { id: id * 2, ply: targetPly, role: 'user' as const, text: label }].slice(-100))
      if (mode === 'chat') setQuestion('')
    }
    try {
      const text = await requestCoach(payload, controller.signal)
      if (!replyMatchesSelection({ id, ply: targetPly, mode }, requestRef.current, activePlyRef.current, controller.signal.aborted)) return
      if (mode === 'diagnosis') setDiagnosis(text)
      else setMessages((items) => [...items, { id: id * 2 + 1, ply: targetPly, role: 'assistant' as const, text }].slice(-100))
    } catch (cause) {
      if (requestRef.current?.id === id && !controller.signal.aborted) {
        if (mode !== 'diagnosis') setMessages((items) => items.filter((item) => item.id !== id * 2))
        setErrorInfo({ text: cause instanceof Error ? cause.message : 'O treinador não respondeu. Tente novamente.', ply: targetPly, mode })
      }
    } finally {
      if (requestRef.current?.id === id) { requestRef.current = null; setBusy(null) }
    }
  }

  const ready = !!status?.ready && !!analysis
  return <section className="coach-panel" aria-label="Nemesis AI Coach">
    <button className="coach-header" type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <span className="coach-emblem"><Bot size={20} /></span><span className="coach-heading"><strong>Nemesis <em>AI Coach</em></strong><small>{status?.ready ? `Gemini · ${status.model}` : 'Treinador de xadrez em português'}</small></span><ChevronDown size={18} className={expanded ? 'open' : ''} />
    </button>
    {expanded && <div className="coach-body">
      {statusError && <div className="coach-setup" role="status">{statusError} <button type="button" onClick={() => { setStatusError(''); refreshStatus() }}><RefreshCw size={13} /> Verificar novamente</button></div>}
      {status && !status.ready && <div className="coach-setup" role="status">{status.reason} <button type="button" onClick={() => { setStatusError(''); refreshStatus() }}><RefreshCw size={13} /> Verificar novamente</button></div>}
      {!analysis && <p className="coach-muted">Analise a partida com Stockfish para conversar sobre uma jogada ou receber um diagnóstico.</p>}
      {analysis && <>
        <div className="coach-position"><span>POSIÇÃO EM FOCO</span><strong>{move ? `${Math.ceil(ply / 2)}${move.color === 'w' ? '.' : '...'} ${sanToPortuguese(move.san)}` : 'Selecione uma jogada'}</strong><small>{move ? `· ${move.classification === 'unclassified' ? 'Indeterminada' : CLASSIFICATION_META[move.classification].label}` : ''}</small></div>
        <button className="coach-primary" type="button" disabled={!ready || !move || !!busy} onClick={() => send('explain')}><Sparkles size={16} /> Explicar com IA <ArrowRight size={15} /></button>
        <div className="coach-quick"><span>PERGUNTAS RÁPIDAS</span><div>{quickQuestions.map((prompt) => <button key={prompt} type="button" disabled={!ready || !move || !!busy} onClick={() => send('chat', prompt)}>{prompt}</button>)}</div></div>
        <div className="coach-conversation" aria-live="polite">
          {visited.length > 0 && <div className="coach-thread-list"><span>CONVERSAS DA SESSÃO</span>{visited.map((item) => <button key={item} type="button" className={item === ply ? 'current' : ''} onClick={() => onJump(item)}>Jogada {Math.ceil(item / 2)}{item % 2 ? '.' : '...'}</button>)}</div>}
          {currentMessages.length ? currentMessages.map((item) => <div key={item.id} className={`coach-message ${item.role}`}><span>{item.role === 'user' ? 'VOCÊ' : 'NEMESIS · JOGADA ' + Math.ceil(item.ply / 2)}</span>{item.role === 'assistant' ? <CoachMarkdown text={item.text} /> : <p>{item.text}</p>}</div>) : <p className="coach-muted">Escolha uma jogada e peça uma explicação. O treinador usa a posição e as variantes que o Stockfish realmente analisou.</p>}
          {busy && busy !== 'diagnosis' && <div className="coach-thinking"><span className="coach-pulse" /> Preparando explicação da jogada {Math.ceil(ply / 2)}...</div>}
        </div>
        <form className="coach-chat-form" onSubmit={(event) => { event.preventDefault(); void send('chat', question) }}><textarea ref={questionRef} rows={4} aria-label="Pergunta ao treinador" value={question} onChange={(event) => setQuestion(event.target.value.slice(0, 400))} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder="Pergunte sobre esta posição..." maxLength={400} disabled={!ready || !move || !!busy} /><button type="submit" aria-label="Enviar pergunta" disabled={!ready || !move || !!busy || !question.trim()}><Send size={17} /></button></form>
        <div className="coach-diagnosis"><div><span>REVISÃO DO TREINADOR</span><p>Uma leitura educativa da sua partida, baseada em até dez posições críticas.</p></div><button type="button" disabled={!ready || !!busy} onClick={() => send('diagnosis')}>{diagnosis ? 'Ver novamente' : 'Receber diagnóstico do treinador'}</button></div>
        {busy === 'diagnosis' && <div className="coach-thinking"><span className="coach-pulse" /> Preparando diagnóstico da partida...</div>}
        {diagnosis && <div className="coach-diagnosis-text"><span>DIAGNÓSTICO · ESTA PARTIDA</span><CoachMarkdown text={diagnosis} /></div>}
      </>}
      {errorInfo && (errorInfo.mode === 'diagnosis' || errorInfo.ply === ply) && <div className="coach-error" role="alert"><span>{errorInfo.text}</span>{lastAttempt && <button type="button" onClick={() => send(lastAttempt.mode, lastAttempt.question)}>Tentar novamente</button>}</div>}
      <p className="coach-footnote">O Stockfish avalia. A IA explica. Confira as variantes no tabuleiro antes de aplicar a lição.</p>
    </div>}
  </section>
}
