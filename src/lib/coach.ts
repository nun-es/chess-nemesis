import { Chess } from 'chess.js'
import { CLASSIFICATIONS, CLASSIFICATION_META, countClassifications, sanToPortuguese, uciMoveToSan } from './analysis'
import type { GameAnalysis, MoveEvaluation, Score } from './analysis'
import type { GameSummary } from './games'

export interface CoachMoveContext {
  kind: 'move'
  gameId: string
  ply: number
  mover: 'white' | 'black'
  isUser: boolean
  rating: number | null
  san: string
  classification: string
  fenBefore: string
  fenAfter: string
  evaluationBefore: Score
  evaluationAfter: Score
  depth: number
  lossCp: number | null
  bestMove: string | null
  principalVariation: string[]
  secondVariation: string[]
  secondEvaluation: Score | null
  replyVariation: string[]
}

export interface CoachDiagnosisContext {
  kind: 'diagnosis'
  gameId: string
  result: GameSummary['result']
  modality: GameSummary['timeClass']
  userColor: GameSummary['userColor']
  rating: number | null
  depth: number
  totalUserMoves: number
  counts: Record<string, number>
  critical: Array<Pick<CoachMoveContext, 'ply' | 'san' | 'classification' | 'evaluationBefore' | 'evaluationAfter' | 'bestMove' | 'principalVariation' | 'replyVariation'>>
  positive: Array<Pick<CoachMoveContext, 'ply' | 'san' | 'classification' | 'evaluationBefore' | 'evaluationAfter'>>
}

export type CoachContext = CoachMoveContext | CoachDiagnosisContext
export type CoachRequest = { mode: 'explain' | 'chat' | 'diagnosis'; context: CoachContext; question?: string; history?: Array<{ role: 'user' | 'assistant'; text: string }> }

export function replyMatchesSelection(request: { id: number; ply: number; mode: CoachRequest['mode'] },
  active: { id: number } | null, selectedPly: number, aborted: boolean): boolean {
  return !aborted && active?.id === request.id && (request.mode === 'diagnosis' || request.ply === selectedPly)
}

export function uciLineToSan(fen: string, line: readonly string[] | undefined, limit = 6): string[] {
  if (!line?.length) return []
  let board: Chess
  try { board = new Chess(fen) } catch { return [] }
  const result: string[] = []
  for (const uci of line.slice(0, limit)) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) break
    try {
      const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      result.push(sanToPortuguese(move.san))
    } catch { break }
  }
  return result
}

export function buildMoveCoachContext(game: GameSummary, move: MoveEvaluation, depth: number): CoachMoveContext {
  const mover = move.color === 'w' ? 'white' : 'black'
  const player = mover === 'white' ? game.white : game.black
  const best = uciMoveToSan(move.before.fen, move.before.bestMoveUci)
  return {
    kind: 'move', gameId: game.id, ply: move.ply, mover, isUser: game.userColor === mover,
    rating: player.rating ?? null, san: sanToPortuguese(move.san),
    classification: move.classification === 'unclassified' ? 'Indeterminada' : CLASSIFICATION_META[move.classification].label,
    fenBefore: move.before.fen, fenAfter: move.after.fen,
    evaluationBefore: move.before.score, evaluationAfter: move.after.score,
    depth, lossCp: move.lossCp, bestMove: best ? sanToPortuguese(best.san) : null,
    principalVariation: uciLineToSan(move.before.fen, move.before.pvUci),
    secondVariation: uciLineToSan(move.before.fen, move.before.secondBest?.pvUci),
    secondEvaluation: move.before.secondBest?.score ?? null,
    replyVariation: uciLineToSan(move.after.fen, move.after.pvUci),
  }
}

export function buildDiagnosisContext(game: GameSummary, analysis: GameAnalysis): CoachDiagnosisContext {
  const color = game.userColor === 'white' ? 'w' : 'b'
  const userMoves = analysis.moves.filter((move) => move.color === color)
  const counts = countClassifications(analysis.moves)[color]
  const severity: Record<string, number> = { blunder: 4, missed: 3, mistake: 2, inaccuracy: 1 }
  const critical = userMoves.filter((move) => severity[move.classification]).sort((a, b) =>
    severity[b.classification] - severity[a.classification] || (b.lossCp ?? 0) - (a.lossCp ?? 0)).slice(0, 10)
    .map((move) => { const item = buildMoveCoachContext(game, move, analysis.depth); return {
      ply: item.ply, san: item.san, classification: item.classification,
      evaluationBefore: item.evaluationBefore, evaluationAfter: item.evaluationAfter,
      bestMove: item.bestMove, principalVariation: item.principalVariation.slice(0, 4), replyVariation: item.replyVariation.slice(0, 4),
    } })
  const positive = userMoves.filter((move) => ['great', 'brilliant', 'best', 'excellent'].includes(move.classification)).slice(0, 3)
    .map((move) => { const item = buildMoveCoachContext(game, move, analysis.depth); return {
      ply: item.ply, san: item.san, classification: item.classification,
      evaluationBefore: item.evaluationBefore, evaluationAfter: item.evaluationAfter,
    } })
  return {
    kind: 'diagnosis', gameId: game.id, result: game.result, modality: game.timeClass,
    userColor: game.userColor, rating: (game.userColor === 'white' ? game.white : game.black).rating ?? null,
    depth: analysis.depth, totalUserMoves: userMoves.length,
    counts: Object.fromEntries(CLASSIFICATIONS.map((kind) => [kind, counts[kind]])), critical, positive,
  }
}

const completed = new Map<string, string>()
const pending = new Map<string, Promise<string>>()
const CACHE_LIMIT = 120

export async function requestCoach(payload: CoachRequest, signal: AbortSignal): Promise<string> {
  const key = JSON.stringify(payload)
  const cached = completed.get(key)
  if (cached) return cached
  const existing = pending.get(key)
  if (existing) return existing
  const task = (async () => {
    const response = await fetch('/api/coach', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: key, signal,
    })
    const body = await response.json().catch(() => null) as { text?: string; error?: string } | null
    if (!response.ok) throw new Error(body?.error ?? `Falha no treinador (HTTP ${response.status}).`)
    if (!body?.text?.trim()) throw new Error('O treinador retornou uma resposta vazia. Tente novamente.')
    if (completed.size >= CACHE_LIMIT) completed.delete(completed.keys().next().value!)
    completed.set(key, body.text)
    return body.text
  })()
  pending.set(key, task)
  try { return await task } finally { pending.delete(key) }
}

export async function coachStatus(signal?: AbortSignal): Promise<{ ready: boolean; model?: string; reason?: string }> {
  const response = await fetch('/api/coach/status', { signal })
  if (!response.ok) throw new Error('Servidor do treinador indisponível. Inicie npm run coach:dev.')
  return response.json() as Promise<{ ready: boolean; model?: string; reason?: string }>
}
