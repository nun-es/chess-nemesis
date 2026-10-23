import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Chessboard } from 'react-chessboard'
import { Activity, ArrowLeft, ArrowRight, BarChart3, Bot, ChevronsLeft, ChevronsRight, ExternalLink, ListOrdered, RotateCcw, Swords, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import { ANALYSIS_DEPTH, CLASSIFICATIONS, CLASSIFICATION_META, analyzeReplay, countClassifications, formatScore, nextCategoryPly, sanToPortuguese, whiteAdvantageFraction } from '../lib/analysis'
import type { Classification, GameAnalysis, MoveEvaluation, Score } from '../lib/analysis'
import { positionAt } from '../lib/chess'
import type { Replay } from '../lib/chess'
import type { GameSummary } from '../lib/games'
import { StockfishEngine } from '../lib/stockfish'
import CoachPanel from './CoachPanel'

const typeLabel = { rapid: 'Rapid', blitz: 'Blitz', bullet: 'Bullet' }
const resultLabel = { win: 'Vitória', loss: 'Derrota', draw: 'Empate' }
const classificationLabel = (kind: MoveEvaluation['classification']) => kind === 'unclassified' ? 'Indeterminada' : CLASSIFICATION_META[kind].label
const pieceLabel: Record<string, string> = { p: 'Peão', n: 'Cavalo', b: 'Bispo', r: 'Torre', q: 'Dama', k: 'Rei' }
const formattedDate = (timestamp: number) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(timestamp * 1000)
const formatLoss = (lossCp: number | null) => lossCp === null ? '—' : lossCp === 0 ? '0 peões' : lossCp < 10 ? `${(lossCp / 100).toFixed(2).replace('.', ',')} peão` : `${(lossCp / 100).toFixed(1).replace('.', ',')} peões`

interface BoardProps { replay: Replay; game: GameSummary; ply: number; preview: boolean; bestMove: MoveEvaluation['bestMove'] }

const ReplayBoard = memo(function ReplayBoard({ replay, game, ply, preview, bestMove }: BoardProps) {
  const shownPly = preview ? Math.max(0, ply - 1) : ply
  const lastMove = !preview && shownPly > 0 ? replay.moves[shownPly - 1] : null
  const squareStyles = useMemo<Record<string, CSSProperties>>(() => lastMove ? {
    [lastMove.from]: { background: 'rgba(183, 225, 99, .38)' },
    [lastMove.to]: { background: 'rgba(183, 225, 99, .58)' },
  } : {}, [lastMove])
  const options = useMemo(() => ({
    position: positionAt(replay, shownPly), boardOrientation: game.userColor,
    allowDragging: false, allowDrawingArrows: false, showNotation: true,
    animationDurationInMs: 180, squareStyles,
    arrows: preview && bestMove ? [{ startSquare: bestMove.from, endSquare: bestMove.to, color: '#b7e57b' }] : [],
    clearArrowsOnPositionChange: false,
    lightSquareStyle: { backgroundColor: '#e7e5d7' }, darkSquareStyle: { backgroundColor: '#759079' },
    lightSquareNotationStyle: { color: '#415446' },
    darkSquareNotationStyle: { color: '#f0eddf' },
    alphaNotationStyle: {
      bottom: 'clamp(3px, 0.8vw, 6px)', right: 'clamp(4px, 0.9vw, 7px)',
      fontSize: 'clamp(9px, 1.35vw, 13px)', fontWeight: 800, lineHeight: 1,
      letterSpacing: '0.01em', pointerEvents: 'none' as const, zIndex: 3,
    },
    numericNotationStyle: {
      top: 'clamp(3px, 0.8vw, 6px)', left: 'clamp(4px, 0.9vw, 7px)',
      fontSize: 'clamp(9px, 1.35vw, 13px)', fontWeight: 800, lineHeight: 1,
      pointerEvents: 'none' as const, zIndex: 3,
    },
    boardStyle: { borderRadius: '4px', overflow: 'hidden' },
  }), [bestMove, game.userColor, preview, replay, shownPly, squareStyles])
  return <Chessboard options={options} />
})

function EvaluationBar({ score }: { score: Score | null }) {
  const whitePercent = whiteAdvantageFraction(score) * 100
  return <div className="evaluation-column" aria-label={`Avaliação para as brancas: ${formatScore(score)}`}>
    <span className="evaluation-side">P</span>
    <div className="evaluation-rail"><div className="evaluation-white" style={{ height: `${whitePercent}%` }} /></div>
    <span className="evaluation-side">B</span>
  </div>
}

function MoveDetails({ move, preview, onPreview }: { move: MoveEvaluation; preview: boolean; onPreview: () => void }) {
  const moveNumber = Math.ceil(move.ply / 2)
  return <section className="move-details" aria-label="Informações da jogada">
    <div className="detail-heading"><span>JOGADA SELECIONADA</span><strong>{moveNumber}{move.color === 'w' ? '.' : '...'} {pieceLabel[move.piece] ?? 'Peça'} para {move.to}</strong></div>
    <div className="detail-grid">
      <div><span>Classificação</span><strong className={`detail-class ${move.classification}`}>{move.classification !== 'unclassified' && <span className="class-symbol">{CLASSIFICATION_META[move.classification].symbol}</span>}{classificationLabel(move.classification)}</strong></div>
      <div><span>Perda</span><strong>{formatLoss(move.lossCp)}</strong></div>
      <div><span>Avaliação anterior</span><strong>{formatScore(move.before.score)}</strong></div>
      <div><span>Após a jogada</span><strong>{formatScore(move.after.score)}</strong></div>
    </div>
    <div className="best-alternative"><div><span>MELHOR ALTERNATIVA</span><strong>{move.bestMove ? sanToPortuguese(move.bestMove.san) : 'Jogada realizada ou indisponível'}</strong></div>{move.bestMove && <button type="button" onClick={onPreview}>{preview ? 'Voltar à jogada' : 'Ver no tabuleiro'} <ArrowRight size={15} /></button>}</div>
    {move.note && <p className="detail-note">{move.note}</p>}
    <p className="perspective-note">Avaliações mostradas pela perspectiva das brancas. A classificação considera quem jogou.</p>
  </section>
}

function Summary({ analysis, userColor, onJump, loading, currentPly }: { analysis: GameAnalysis | null; userColor: GameSummary['userColor']; onJump: (ply: number) => void; loading: boolean; currentPly: number }) {
  const counts = analysis ? countClassifications(analysis.moves) : null
  const classifiedTotal = counts ? { w: Object.values(counts.w).reduce((sum, value) => sum + value, 0), b: Object.values(counts.b).reduce((sum, value) => sum + value, 0) } : null
  const userMoveColor = userColor === 'white' ? 'w' : 'b'
  const userMoves = analysis?.moves.filter((move) => move.color === userMoveColor) ?? []
  const sortedErrors = analysis?.moves.filter((move) => ['inaccuracy', 'mistake', 'blunder', 'missed'].includes(move.classification))
    .sort((a, b) => (b.lossCp ?? 10000) - (a.lossCp ?? 10000)).slice(0, 5)
  const userCritical = userMoves.filter((move) => ['inaccuracy', 'mistake', 'blunder', 'missed'].includes(move.classification))
    .sort((a, b) => (b.lossCp ?? 10000) - (a.lossCp ?? 10000)).slice(0, 5)
  const jump = (kind: Classification, color: 'w' | 'b') => {
    if (!analysis) return
    const next = nextCategoryPly(analysis.moves, kind, color, currentPly)
    if (next !== null) onJump(next)
  }
  return <section className="analysis-summary" aria-label="Resumo das Jogadas">
    <div className="summary-title"><div><span>REVISÃO DA PARTIDA</span><h2>Resumo das Jogadas</h2></div><strong>{analysis ? `${classifiedTotal!.w + classifiedTotal!.b} lances classificados` : loading ? 'Analisando...' : 'Aguardando análise'}</strong></div>
    <p className="summary-hint">Selecione um contador para percorrer as jogadas daquela categoria.</p>
    <div className="summary-table" role="table" aria-label="Classificações por cor">
      <div className="summary-row summary-header" role="row"><span role="columnheader">Classificação</span><span role="columnheader">Brancas</span><span role="columnheader">Pretas</span></div>
      {CLASSIFICATIONS.map((kind) => <div className={`summary-row ${kind}`} role="row" key={kind}>
        <span role="rowheader"><span className="summary-symbol">{CLASSIFICATION_META[kind].symbol}</span>{CLASSIFICATION_META[kind].label}</span>
        {(['w', 'b'] as const).map((color) => <button key={color} type="button" role="cell" disabled={!counts || counts[color][kind] === 0} onClick={() => jump(kind, color)} aria-label={`${CLASSIFICATION_META[kind].label}, ${color === 'w' ? 'brancas' : 'pretas'}: ${counts?.[color][kind] ?? 'aguardando'}`} title={counts?.[color][kind] ? 'Ir à próxima ocorrência' : undefined}>{counts ? counts[color][kind] : '—'}</button>)}
      </div>)}
      <div className="summary-row summary-total" role="row"><span role="rowheader">Total classificado</span><strong role="cell">{classifiedTotal?.w ?? '—'}</strong><strong role="cell">{classifiedTotal?.b ?? '—'}</strong></div>
    </div>
    {analysis && classifiedTotal!.w + classifiedTotal!.b < analysis.moves.length && <p className="summary-hint">{analysis.moves.length - classifiedTotal!.w - classifiedTotal!.b} lance(s) sem dados suficientes para uma classificação segura.</p>}
    {analysis && <>
    <div className="critical-title">MOMENTOS CRÍTICOS</div>
    {sortedErrors?.length ? <div className="critical-list">{sortedErrors.map((move) => <button type="button" key={move.ply} onClick={() => onJump(move.ply)}><span className={`critical-dot ${move.classification}`} /><strong>{Math.ceil(move.ply / 2)}{move.color === 'w' ? '.' : '...'} {sanToPortuguese(move.san)}</strong><span>{move.color === userMoveColor ? 'Você' : 'Adversário'} · {classificationLabel(move.classification)}</span><ArrowRight size={15} /></button>)}</div> : <p className="no-critical">Nenhum momento crítico detectado nesta profundidade.</p>}
    <div className="critical-title">SEUS PRINCIPAIS ERROS</div>
    {userCritical.length ? <div className="critical-list">{userCritical.map((move) => <button type="button" key={move.ply} onClick={() => onJump(move.ply)}><span className={`critical-dot ${move.classification}`} /><strong>{Math.ceil(move.ply / 2)}{move.color === 'w' ? '.' : '...'} {sanToPortuguese(move.san)}</strong><span>{classificationLabel(move.classification)}</span><ArrowRight size={15} /></button>)}</div> : <p className="no-critical">Nenhum erro relevante detectado nas suas jogadas nesta profundidade.</p>}
    </>}
  </section>
}

export default function AnalysisView({ game, replay, onBack }: { game: GameSummary; replay: Replay; onBack: () => void }) {
  const [ply, setPly] = useState(0)
  const [preview, setPreview] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'running' | 'done' | 'cancelled' | 'error'>('idle')
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: replay.fens.length })
  const [analysisError, setAnalysisError] = useState('')
  const [depth, setDepth] = useState(ANALYSIS_DEPTH)
  const [activeTab, setActiveTab] = useState<'moves' | 'analysis' | 'coach' | 'summary'>('moves')
  const controllerRef = useRef<AbortController | null>(null)
  const runId = useRef(0)
  const moveListRef = useRef<HTMLDivElement | null>(null)
  const top = game.userColor === 'white' ? game.black : game.white
  const bottom = game.userColor === 'white' ? game.white : game.black
  const selectedMove = ply > 0 ? analysis?.moves[ply - 1] ?? null : null
  const displayedPly = preview ? Math.max(0, ply - 1) : ply
  const displayedScore = analysis?.positions[displayedPly]?.score ?? null

  function navigate(target: number) { setPly(Math.max(0, Math.min(replay.moves.length, target))); setPreview(false) }
  function stopAnalysis() {
    runId.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setPhase('cancelled')
  }
  async function startAnalysis() {
    if (controllerRef.current) return
    const controller = new AbortController()
    const currentRun = ++runId.current
    controllerRef.current = controller
    setAnalysis(null); setAnalysisError(''); setProgress({ done: 0, total: replay.fens.length }); setPhase('loading'); setPreview(false)
    try {
      const result = await analyzeReplay(replay, new StockfishEngine(), controller.signal,
        (done, total) => { if (runId.current === currentRun) setProgress({ done, total }) },
        () => { if (runId.current === currentRun) setPhase('running') }, depth)
      if (runId.current === currentRun && !controller.signal.aborted) { setAnalysis(result); setPhase('done') }
    } catch (error) {
      if (runId.current === currentRun) {
        if (controller.signal.aborted) setPhase('cancelled')
        else { setAnalysisError(error instanceof Error ? error.message : 'Falha desconhecida ao analisar a partida.'); setPhase('error') }
      }
    } finally {
      if (runId.current === currentRun) controllerRef.current = null
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return
      if (event.key === 'ArrowLeft') { event.preventDefault(); setPly((value) => Math.max(0, value - 1)); setPreview(false) }
      if (event.key === 'ArrowRight') { event.preventDefault(); setPly((value) => Math.min(replay.moves.length, value + 1)); setPreview(false) }
      if (event.key === 'Home') { event.preventDefault(); setPly(0); setPreview(false) }
      if (event.key === 'End') { event.preventDefault(); setPly(replay.moves.length); setPreview(false) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [replay.moves.length])
  useEffect(() => () => { runId.current += 1; controllerRef.current?.abort() }, [])
  useEffect(() => {
    const container = moveListRef.current
    const active = container?.querySelector<HTMLElement>('.move-chip.active')
    if (!container || !active) return
    const bounds = container.getBoundingClientRect()
    const chip = active.getBoundingClientRect()
    if (chip.top < bounds.top || chip.bottom > bounds.bottom) {
      container.scrollBy({ top: chip.top - bounds.top - container.clientHeight / 2, behavior: 'smooth' })
    }
  }, [ply])

  const inProgress = phase === 'loading' || phase === 'running'
  const tabs = [
    { id: 'moves' as const, label: 'Jogadas', icon: ListOrdered },
    { id: 'analysis' as const, label: 'Análise', icon: Activity },
    { id: 'coach' as const, label: 'AI Coach', icon: Bot },
    { id: 'summary' as const, label: 'Resumo', icon: BarChart3 },
  ]
  function selectRelativeTab(current: number, offset: number) {
    const next = (current + offset + tabs.length) % tabs.length
    setActiveTab(tabs[next].id)
    requestAnimationFrame(() => document.getElementById(`analysis-tab-${tabs[next].id}`)?.focus())
  }
  return <main className="analysis-layout page-wrap">
    <div className="analysis-heading"><button className="back-link" onClick={() => { if (inProgress) stopAnalysis(); onBack() }} type="button"><ArrowLeft size={17} /> Voltar às partidas</button><div><span className="eyebrow"><span className="eyebrow-line" /> CENTRAL DE ANÁLISE</span><h1>Reviva cada <em>jogada.</em></h1><p>Use as setas do teclado ou selecione um lance no histórico.</p></div></div>
    <div className="analysis-grid">
      <section className="board-section" aria-label="Tabuleiro da partida">
        <div className="board-player"><span className={`piece-avatar ${game.userColor === 'white' ? 'dark' : 'light'}`}>♞</span><strong>{top.username} <span>({top.rating ?? '—'})</span></strong><span className="board-side">{game.userColor === 'white' ? 'PRETAS' : 'BRANCAS'}</span></div>
        <div className="board-with-eval"><EvaluationBar score={displayedScore} /><div className="board-shell"><ReplayBoard replay={replay} game={game} ply={ply} preview={preview} bestMove={selectedMove?.bestMove ?? null} /></div></div>
        <div className="board-player"><span className={`piece-avatar ${game.userColor === 'white' ? 'light' : 'dark'}`}>♞</span><strong>{bottom.username} <span>({bottom.rating ?? '—'})</span></strong><span className="board-side">{game.userColor === 'white' ? 'BRANCAS' : 'PRETAS'}</span></div>
        <div className="board-eval-text"><span>{preview ? 'ALTERNATIVA · POSIÇÃO ANTERIOR' : 'AVALIAÇÃO · BRANCAS'}</span><strong>{formatScore(displayedScore)}</strong></div>
        <div className="playback-controls" aria-label="Controles de reprodução"><button aria-label="Ir ao início" onClick={() => navigate(0)} disabled={ply === 0}><ChevronsLeft size={21} /></button><button aria-label="Voltar uma jogada" onClick={() => navigate(ply - 1)} disabled={ply === 0}><ArrowLeft size={21} /></button><span className="move-counter"><strong>{ply}</strong> / {replay.moves.length} lances</span><button aria-label="Avançar uma jogada" onClick={() => navigate(ply + 1)} disabled={ply === replay.moves.length}><ArrowRight size={21} /></button><button aria-label="Ir ao final" onClick={() => navigate(replay.moves.length)} disabled={ply === replay.moves.length}><ChevronsRight size={21} /></button></div>
      </section>
      <aside className="analysis-sidebar" aria-label="Painel de análise"><div className={`analysis-side${activeTab === 'coach' ? ' coach-active' : ''}`}><header className="match-compact"><div className="match-label"><Swords size={16} /> PARTIDA SELECIONADA <span>{formattedDate(game.endTime)}</span></div><div className="match-heading"><div><h2>{game.white.username} <span>vs.</span> {game.black.username}</h2><p>{typeLabel[game.timeClass]} <span className="dot">·</span> Você jogou de {game.userColor === 'white' ? 'brancas' : 'pretas'}</p></div><span className={`match-result ${game.result}`}>{resultLabel[game.result]}</span></div></header>
        <div className="analysis-tabs" role="tablist" aria-label="Seções da análise">{tabs.map((tab, index) => { const Icon = tab.icon; return <button id={`analysis-tab-${tab.id}`} key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`analysis-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => { if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); if (event.key === 'ArrowRight') selectRelativeTab(index, 1); if (event.key === 'ArrowLeft') selectRelativeTab(index, -1); if (event.key === 'Home') selectRelativeTab(0, -index); if (event.key === 'End') selectRelativeTab(index, tabs.length - 1 - index) }}><Icon size={16} /><span>{tab.label}</span></button> })}</div>
        <div className="analysis-panel">
        <div className="tab-pane moves-tab" id="analysis-panel-moves" role="tabpanel" aria-labelledby="analysis-tab-moves" hidden={activeTab !== 'moves'}><div className="move-list-heading"><span>HISTÓRICO DE JOGADAS</span><span>{Math.ceil(replay.moves.length / 2)} movimentos</span></div>
          <div className="move-list" ref={moveListRef} aria-label="Histórico de movimentos">{Array.from({ length: Math.ceil(replay.moves.length / 2) }, (_, index) => <div className="move-pair" key={index}><span className="move-number">{index + 1}.</span>{[0, 1].map((offset) => { const moveIndex = index * 2 + offset; const move = replay.moves[moveIndex]; const classification = analysis?.moves[moveIndex]?.classification; return move ? <button key={moveIndex} className={`move-chip ${ply === moveIndex + 1 ? 'active' : ''} ${classification ? `classified ${classification}` : ''}`} onClick={() => navigate(moveIndex + 1)} aria-label={`${index + 1}${offset ? '...' : '.'} ${sanToPortuguese(move.san)}${classification ? `, ${classificationLabel(classification)}` : ''}`} aria-current={ply === moveIndex + 1 ? 'step' : undefined}>{sanToPortuguese(move.san)}{classification && classification !== 'unclassified' && <span className="move-mark" aria-hidden="true">{CLASSIFICATION_META[classification].symbol}</span>}</button> : <span key={moveIndex} /> })}</div>)}</div>
          <div className="selected-move-glance"><span>{selectedMove ? `JOGADA ${Math.ceil(selectedMove.ply / 2)}${selectedMove.color === 'w' ? '.' : '...'}` : 'POSIÇÃO INICIAL'}</span><strong>{selectedMove ? sanToPortuguese(selectedMove.san) : 'Início da partida'}</strong><span>{selectedMove ? classificationLabel(selectedMove.classification) : formatScore(displayedScore)}</span></div></div>
        <div className="tab-pane analysis-tab-content" id="analysis-panel-analysis" role="tabpanel" aria-labelledby="analysis-tab-analysis" hidden={activeTab !== 'analysis'}><section className={`engine-panel ${phase}`} aria-label="Análise com Stockfish">
          <div className="engine-panel-title"><span className="engine-icon">♞</span><div><strong>Stockfish 19 Lite</strong><span>Motor local · profundidade {depth}</span></div></div>
          {!inProgress && <label className="analysis-depth">Profundidade <select value={depth} onChange={(event) => { setDepth(Number(event.target.value)); setAnalysis(null); setPreview(false); setPhase('idle') }}><option value={8}>8 · mais rápido</option><option value={10}>10 · equilibrado</option><option value={12}>12 · mais detalhado</option></select></label>}
          {phase === 'idle' && <><p>Descubra os lances que mudaram a partida e encontre alternativas melhores.</p><button className="analyze-button" type="button" onClick={startAnalysis}>Analisar partida <ArrowRight size={17} /></button></>}
          {inProgress && <><p>{phase === 'loading' ? 'Iniciando o motor no navegador...' : `Analisando posição ${progress.done} de ${progress.total}...`}</p><div className="progress-track" role="progressbar" aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total}><div style={{ width: `${Math.round(progress.done / progress.total * 100)}%` }} /></div><div className="progress-footer"><strong>{Math.round(progress.done / progress.total * 100)}% concluído</strong><button type="button" onClick={stopAnalysis}><X size={14} /> Cancelar</button></div></>}
          {phase === 'done' && <><p>Análise concluída. Selecione uma jogada para revisar as avaliações.</p><button className="reanalyse-button" type="button" onClick={startAnalysis}><RotateCcw size={15} /> Analisar novamente</button></>}
          {phase === 'cancelled' && <><p>Análise cancelada. Nenhum resultado parcial foi apresentado.</p><button className="analyze-button" type="button" onClick={startAnalysis}>Reiniciar análise <ArrowRight size={17} /></button></>}
          {phase === 'error' && <><p className="engine-error" role="alert">{analysisError}</p><button className="analyze-button" type="button" onClick={startAnalysis}>Tentar novamente <ArrowRight size={17} /></button></>}
          <div className="engine-legal"><a href={`${import.meta.env.BASE_URL}engine/COPYING.txt`} target="_blank" rel="noreferrer">Licença GPLv3</a><span>·</span><a href={`${import.meta.env.BASE_URL}engine/stockfish-19-source.tar.gz`} download>Fonte do motor</a></div>
        </section>
        {analysis && (selectedMove ? <MoveDetails move={selectedMove} preview={preview} onPreview={() => setPreview((value) => !value)} /> : <div className="initial-evaluation"><strong>Posição inicial</strong><span>Avaliação: {formatScore(analysis.positions[0].score)} para as brancas. Selecione uma jogada para ver os detalhes.</span></div>)}
        </div>
        <div className="tab-pane coach-tab" id="analysis-panel-coach" role="tabpanel" aria-labelledby="analysis-tab-coach" hidden={activeTab !== 'coach'}><CoachPanel key={`${game.id}:${analysis ? `${analysis.depth}:done` : 'idle'}`} game={game} analysis={analysis} move={selectedMove} ply={ply} onJump={navigate} /></div>
        <div className="tab-pane summary-tab" id="analysis-panel-summary" role="tabpanel" aria-labelledby="analysis-tab-summary" hidden={activeTab !== 'summary'}><Summary analysis={analysis} userColor={game.userColor} onJump={navigate} loading={inProgress} currentPly={ply} /></div>
        </div>
        <div className="analysis-foot"><span>STOCKFISH · PROFUNDIDADE {analysis?.depth ?? depth}</span>{game.id.startsWith('https://') && <a href={game.id} target="_blank" rel="noreferrer">Ver na Chess.com <ExternalLink size={15} /></a>}</div>
      </div></aside>
    </div>
  </main>
}
