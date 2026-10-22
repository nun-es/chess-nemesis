import { Chess } from 'chess.js'
import type { Replay } from './chess'
import { isBookMove } from './openings'

export type Color = 'white' | 'black'
export type Score = { kind: 'cp'; whiteCp: number } | { kind: 'mate'; winner: Color; distance: number }
export const CLASSIFICATIONS = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'blunder', 'missed'] as const
export type Classification = typeof CLASSIFICATIONS[number]
export type MoveClassification = Classification | 'unclassified'
type BaseClassification = 'none' | 'inaccuracy' | 'mistake' | 'blunder' | 'uncertain'
export const CLASSIFICATION_META: Record<Classification, { label: string; symbol: string }> = {
  brilliant: { label: 'Brilhante', symbol: '!!' }, great: { label: 'Ótima jogada', symbol: '!' },
  best: { label: 'Melhor jogada', symbol: '★' }, excellent: { label: 'Excelente', symbol: '✓' },
  good: { label: 'Boa', symbol: '✓' }, book: { label: 'Teórica', symbol: '📖' },
  inaccuracy: { label: 'Imprecisão', symbol: '?!' }, mistake: { label: 'Erro', symbol: '?' },
  blunder: { label: 'Erro grave', symbol: '??' }, missed: { label: 'Oportunidade perdida', symbol: '×' },
}

export interface PositionEvaluation {
  fen: string
  score: Score
  bestMoveUci: string | null
  depth: number
  pvUci?: string[]
  secondBest?: { uci: string; score: Score; depth: number; pvUci?: string[] }
}

export interface MoveEvaluation {
  ply: number
  san: string
  from: string
  to: string
  color: 'w' | 'b'
  piece: string
  before: PositionEvaluation
  after: PositionEvaluation
  classification: MoveClassification
  lossCp: number | null
  note: string | null
  bestMove: { san: string; from: string; to: string; uci: string } | null
}

export interface GameAnalysis {
  positions: PositionEvaluation[]
  moves: MoveEvaluation[]
  depth: number
}

export interface PositionEngine {
  initialize(signal: AbortSignal): Promise<void>
  evaluate(fen: string, depth: number, signal: AbortSignal): Promise<PositionEvaluation>
  dispose(): void
}

export const ANALYSIS_DEPTH = 10
export const LOSS_THRESHOLDS = { inaccuracy: 50, mistake: 100, blunder: 200 } as const
export const REVIEW_THRESHOLDS = {
  expectedScaleCp: 250, excellentLoss: 0.025, inaccuracyLoss: 0.05, mistakeLoss: 0.10, blunderLoss: 0.20,
  greatGap: 0.20, greatBestMinimum: 0.42, greatSecondMaximum: 0.25,
  brilliantGap: 0.12, brilliantMinimum: 0.42, brilliantMaximum: 0.88, sacrificePawns: 2,
  missedBefore: 0.78, missedAfterMinimum: 0.35, missedAfterMaximum: 0.62, missedLoss: 0.22,
} as const
const POSITION_CACHE_LIMIT = 3000
const positionCache = new Map<string, PositionEvaluation>()

export function scoreFromUci(kind: 'cp' | 'mate', value: number, fen: string): Score {
  const sideToMove = fen.split(' ')[1]
  if (sideToMove !== 'w' && sideToMove !== 'b') throw new Error('FEN inválida: lado a jogar ausente.')
  if (!Number.isFinite(value)) throw new Error('Avaliação UCI inválida.')
  if (kind === 'cp') return { kind: 'cp', whiteCp: value === 0 ? 0 : sideToMove === 'w' ? value : -value }
  return {
    kind: 'mate',
    winner: (value > 0 ? sideToMove === 'w' : sideToMove !== 'w') ? 'white' : 'black',
    distance: Math.abs(value),
  }
}

export function formatScore(score: Score | null): string {
  if (!score) return '—'
  if (score.kind === 'mate') return `${score.winner === 'white' ? '+' : '-'}M${score.distance}`
  if (score.whiteCp === 0) return '+0.0'
  const pawns = score.whiteCp / 100
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`
}

export function sanToPortuguese(san: string): string {
  const piece: Record<string, string> = { K: 'R', Q: 'D', R: 'T', B: 'B', N: 'C' }
  return san.replace(/^[KQRBN]/, (letter) => piece[letter]).replace(/=([KQRBN])/, (_, letter: string) => `=${piece[letter]}`)
}

export function whiteAdvantageFraction(score: Score | null): number {
  if (!score) return 0.5
  if (score.kind === 'mate') return score.winner === 'white' ? 0.96 : 0.04
  return Math.max(0.06, Math.min(0.94, 1 / (1 + Math.exp(-score.whiteCp / 260))))
}

export function expectedPoints(score: Score, mover: 'w' | 'b'): number | null {
  if (score.kind === 'mate') return null
  const cp = score.whiteCp * (mover === 'w' ? 1 : -1)
  return 1 / (1 + Math.exp(-cp / REVIEW_THRESHOLDS.expectedScaleCp))
}

export function classifyMove(before: Score, after: Score, mover: 'w' | 'b'): { classification: BaseClassification; lossCp: number | null; note: string | null } {
  const moverColor: Color = mover === 'w' ? 'white' : 'black'
  if (before.kind === 'cp' && after.kind === 'cp') {
    const perspective = mover === 'w' ? 1 : -1
    const lossCp = Math.max(0, (before.whiteCp - after.whiteCp) * perspective)
    const loss = Math.max(0, expectedPoints(before, mover)! - expectedPoints(after, mover)!)
    // Normalized to the expected-points loss of the original cp thresholds at equality.
    const threshold = (cp: number) => 0.5 - 1 / (1 + Math.exp(cp / REVIEW_THRESHOLDS.expectedScaleCp))
    const classification: BaseClassification = loss >= threshold(LOSS_THRESHOLDS.blunder) ? 'blunder'
      : loss >= threshold(LOSS_THRESHOLDS.mistake) ? 'mistake'
        : loss >= threshold(LOSS_THRESHOLDS.inaccuracy) ? 'inaccuracy' : 'none'
    return { classification, lossCp, note: null }
  }

  if (after.kind === 'mate' && after.winner !== moverColor) {
    const beforeWasSafe = before.kind === 'cp' && before.whiteCp * (mover === 'w' ? 1 : -1) >= -199
    const reversedForcedMate = before.kind === 'mate' && before.winner === moverColor
    if (beforeWasSafe || reversedForcedMate) return { classification: 'blunder', lossCp: null, note: 'A jogada permitiu mate forçado.' }
  }
  if (before.kind === 'mate' && before.winner !== moverColor && after.kind === 'cp') {
    return { classification: 'none', lossCp: null, note: 'A jogada saiu de uma linha de mate forçado.' }
  }
  if (before.kind === 'mate' && before.winner !== moverColor && after.kind === 'mate' && after.winner === moverColor) {
    return { classification: 'none', lossCp: null, note: 'A jogada reverteu uma linha de mate forçado.' }
  }
  if (after.kind === 'mate' && after.winner === moverColor && before.kind === 'cp') {
    return { classification: 'none', lossCp: null, note: 'A jogada encontrou uma linha de mate forçado.' }
  }
  return { classification: 'uncertain', lossCp: null, note: 'Há uma avaliação de mate; não é confiável converter esta diferença em peões.' }
}

export function uciMoveToSan(fen: string, uci: string | null): { san: string; from: string; to: string; uci: string } | null {
  if (!uci || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null
  try {
    const board = new Chess(fen)
    const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    return { san: move.san, from: move.from, to: move.to, uci }
  } catch {
    return null
  }
}

const pieceValues: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
function materialBalance(board: Chess, mover: 'w' | 'b'): number {
  return board.board().flat().reduce((sum, piece) => sum + (piece ? pieceValues[piece.type] * (piece.color === mover ? 1 : -1) : 0), 0)
}

export function isVerifiedSacrifice(before: PositionEvaluation, after: PositionEvaluation, move: Replay['moves'][number]): boolean {
  if (!after.bestMoveUci || pieceValues[move.piece] < 3) return false
  try {
    const board = new Chess(before.fen)
    const priorBalance = materialBalance(board, move.color)
    board.move({ from: move.from, to: move.to, promotion: move.promotion })
    const reply = board.move({ from: after.bestMoveUci.slice(0, 2), to: after.bestMoveUci.slice(2, 4), promotion: after.bestMoveUci[4] })
    if (reply.to !== move.to || !reply.captured) return false
    return priorBalance - materialBalance(board, move.color) >= REVIEW_THRESHOLDS.sacrificePawns
  } catch { return false }
}

export function classifyReviewedMove(move: Replay['moves'][number], before: PositionEvaluation, after: PositionEvaluation, book: boolean): { classification: MoveClassification; lossCp: number | null; note: string | null } {
  const base = classifyMove(before.score, after.score, move.color)
  const playedUci = `${move.from}${move.to}${move.promotion ?? ''}`
  const isBest = before.bestMoveUci === playedUci
  const beforeChance = expectedPoints(before.score, move.color)
  const afterChance = expectedPoints(after.score, move.color)
  const secondChance = before.secondBest ? expectedPoints(before.secondBest.score, move.color) : null
  const loss = beforeChance !== null && afterChance !== null ? Math.max(0, beforeChance - afterChance) : null

  // A missed win that falls back to equality is distinct from a blunder into a lost game.
  if (loss !== null && beforeChance !== null && afterChance !== null &&
    beforeChance >= REVIEW_THRESHOLDS.missedBefore &&
    afterChance >= REVIEW_THRESHOLDS.missedAfterMinimum && afterChance <= REVIEW_THRESHOLDS.missedAfterMaximum &&
    loss >= REVIEW_THRESHOLDS.missedLoss && !isBest &&
    before.bestMoveUci && /[x+#=]/.test(uciMoveToSan(before.fen, before.bestMoveUci)?.san ?? '')) {
    return { ...base, classification: 'missed', note: 'Uma alternativa forçante preservava uma vantagem importante.' }
  }
  if (base.classification === 'blunder') return { ...base, classification: 'blunder' }
  if (base.classification === 'mistake' || base.classification === 'inaccuracy') return { ...base, classification: base.classification }
  if (base.classification === 'uncertain') return { ...base, classification: 'unclassified' }
  if (book) return { ...base, classification: 'book', note: 'Linha encontrada na base de aberturas do Lichess.' }
  if (isBest && beforeChance !== null && afterChance !== null && secondChance !== null &&
    before.depth >= 10 && after.depth >= 10 && before.secondBest!.depth >= 10 &&
    beforeChance <= REVIEW_THRESHOLDS.brilliantMaximum &&
    afterChance >= REVIEW_THRESHOLDS.brilliantMinimum &&
    afterChance - secondChance >= REVIEW_THRESHOLDS.brilliantGap &&
    isVerifiedSacrifice(before, after, move)) {
    return { ...base, classification: 'brilliant', note: 'Sacrifício de peça confirmado pela resposta principal do motor; a avaliação permanece favorável.' }
  }
  if (isBest && beforeChance !== null && secondChance !== null &&
    before.depth >= 10 && before.secondBest!.depth >= 10 &&
    beforeChance >= REVIEW_THRESHOLDS.greatBestMinimum &&
    secondChance <= REVIEW_THRESHOLDS.greatSecondMaximum &&
    beforeChance - secondChance >= REVIEW_THRESHOLDS.greatGap) {
    return { ...base, classification: 'great', note: 'A segunda alternativa perderia uma posição importante.' }
  }
  if (isBest) return { ...base, classification: 'best' }
  if (loss !== null) return { ...base, classification: loss <= REVIEW_THRESHOLDS.excellentLoss ? 'excellent' : 'good' }
  return { ...base, classification: 'unclassified' }
}

export function countClassifications(moves: MoveEvaluation[]): Record<'w' | 'b', Record<Classification, number>> {
  const blank = () => Object.fromEntries(CLASSIFICATIONS.map((kind) => [kind, 0])) as Record<Classification, number>
  const counts = { w: blank(), b: blank() }
  for (const move of moves) if (move.classification !== 'unclassified') counts[move.color][move.classification]++
  return counts
}

export function nextCategoryPly(moves: MoveEvaluation[], kind: Classification, color: 'w' | 'b', currentPly: number): number | null {
  const matches = moves.filter((move) => move.classification === kind && move.color === color).map((move) => move.ply)
  return matches.find((ply) => ply > currentPly) ?? matches[0] ?? null
}

export function buildMoveEvaluations(replay: Replay, positions: PositionEvaluation[]): MoveEvaluation[] {
  if (positions.length !== replay.moves.length + 1 || positions.some((position, index) => position.fen !== replay.fens[index])) {
    throw new Error('As avaliações não correspondem às posições desta partida.')
  }
  const played: string[] = []
  return replay.moves.map((move, index) => {
    const before = positions[index]
    const after = positions[index + 1]
    played.push(`${move.from}${move.to}${move.promotion ?? ''}`)
    const quality = classifyReviewedMove(move, before, after, isBookMove(played))
    const candidate = uciMoveToSan(before.fen, before.bestMoveUci)
    const playedUci = `${move.from}${move.to}${move.promotion ?? ''}`
    return {
      ply: index + 1, san: move.san, from: move.from, to: move.to, color: move.color, piece: move.piece,
      before, after, ...quality,
      bestMove: candidate?.uci === playedUci ? null : candidate,
    }
  })
}

function terminalEvaluation(fen: string): PositionEvaluation | null {
  const board = new Chess(fen)
  if (board.isCheckmate()) {
    return { fen, score: { kind: 'mate', winner: board.turn() === 'w' ? 'black' : 'white', distance: 0 }, bestMoveUci: null, depth: 0 }
  }
  if (board.isDraw()) return { fen, score: { kind: 'cp', whiteCp: 0 }, bestMoveUci: null, depth: 0 }
  return null
}

function cacheKey(fen: string, depth: number) { return `sf19-lite-multipv2:${depth}:${fen.split(' ').slice(0, 5).join(' ')}` }

export async function analyzeReplay(
  replay: Replay,
  engine: PositionEngine,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
  onReady?: () => void,
  depth = ANALYSIS_DEPTH,
  cache: Map<string, PositionEvaluation> = positionCache,
): Promise<GameAnalysis> {
  const positions: PositionEvaluation[] = []
  const total = replay.fens.length
  try {
    if (signal.aborted) throw new DOMException('Análise cancelada.', 'AbortError')
    await engine.initialize(signal)
    if (signal.aborted) throw new DOMException('Análise cancelada.', 'AbortError')
    onReady?.()
    onProgress(0, total)
    for (const fen of replay.fens) {
      if (signal.aborted) throw new DOMException('Análise cancelada.', 'AbortError')
      const key = cacheKey(fen, depth)
      const cached = cache.get(key)
      const evaluation = cached ? { ...cached, fen } : terminalEvaluation(fen) ?? await engine.evaluate(fen, depth, signal)
      if (signal.aborted) throw new DOMException('Análise cancelada.', 'AbortError')
      if (!cached && (evaluation.depth >= depth || evaluation.depth === 0)) {
        if (cache.size >= POSITION_CACHE_LIMIT) cache.delete(cache.keys().next().value!)
        cache.set(key, evaluation)
      }
      positions.push(evaluation)
      onProgress(positions.length, total)
    }
    return { positions, moves: buildMoveEvaluations(replay, positions), depth }
  } finally {
    engine.dispose()
  }
}
