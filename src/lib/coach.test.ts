import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMoveEvaluations } from './analysis'
import type { PositionEvaluation } from './analysis'
import { parsePgn } from './chess'
import { buildDiagnosisContext, buildMoveCoachContext, replyMatchesSelection, requestCoach, uciLineToSan } from './coach'
import type { CoachRequest } from './coach'
import type { GameSummary } from './games'

const game: GameSummary = {
  id: 'test-coach-game', pgn: '1. e4 e5 2. Nf3 *', endTime: 1, timeClass: 'rapid', userColor: 'white', result: 'loss',
  white: { username: 'Jogador', rating: 1030, result: 'resigned' },
  black: { username: 'Adversário', rating: 1120, result: 'win' },
  opponent: { username: 'Adversário', rating: 1120, result: 'win' },
}
const replay = parsePgn(game.pgn!)
const positions: PositionEvaluation[] = replay.fens.map((fen, index) => ({
  fen, score: { kind: 'cp', whiteCp: [20, -120, 30, -200][index] }, depth: 10,
  bestMoveUci: index === 0 ? 'd2d4' : index === 1 ? 'e7e5' : null,
  pvUci: index === 0 ? ['d2d4', 'd7d5', 'c2c4'] : index === 1 ? ['e7e5', 'g1f3'] : undefined,
  secondBest: index === 0 ? { uci: 'e2e4', score: { kind: 'cp', whiteCp: 10 }, depth: 10, pvUci: ['e2e4', 'e7e5'] } : undefined,
}))
const analysis = { positions, moves: buildMoveEvaluations(replay, positions), depth: 10 }

describe('contexto do treinador', () => {
  it('converte variantes UCI válidas para SAN e para ao encontrar lance ilegal', () => {
    expect(uciLineToSan(replay.fens[0], ['e2e4', 'e7e5', 'g1f3'])).toEqual(['e4', 'e5', 'Cf3'])
    expect(uciLineToSan(replay.fens[0], ['e2e4', 'e2e5', 'g1f3'])).toEqual(['e4'])
    expect(uciLineToSan(replay.fens[0], ['z9z8'])).toEqual([])
  })

  it('associa avaliação, posição, rating e variantes à jogada correta sem inventar dados', () => {
    const context = buildMoveCoachContext(game, analysis.moves[0], 10)
    expect(context).toMatchObject({ kind: 'move', gameId: game.id, ply: 1, mover: 'white', isUser: true,
      rating: 1030, san: 'e4', fenBefore: replay.fens[0], fenAfter: replay.fens[1],
      bestMove: 'd4', principalVariation: ['d4', 'd5', 'c4'], secondVariation: ['e4', 'e5'], replyVariation: ['e5', 'Cf3'] })
    expect(context.evaluationBefore).toEqual(positions[0].score)
    const black = buildMoveCoachContext(game, analysis.moves[1], 10)
    expect(black).toMatchObject({ mover: 'black', rating: 1120, isUser: false, ply: 2 })
    const missing = buildMoveCoachContext(game, analysis.moves[2], 10)
    expect(missing).toMatchObject({ bestMove: null, principalVariation: [], secondVariation: [], secondEvaluation: null })
  })

  it('resume apenas os lances do jogador e limita posições críticas', () => {
    const context = buildDiagnosisContext(game, analysis)
    expect(context).toMatchObject({ kind: 'diagnosis', result: 'loss', modality: 'rapid', rating: 1030, totalUserMoves: 2 })
    expect(context.critical.length).toBeLessThanOrEqual(10)
    expect(context.critical.every((item) => item.ply % 2 === 1)).toBe(true)
    expect(Object.values(context.counts).reduce((a, b) => a + b, 0)).toBe(2)
    expect(JSON.stringify(context)).not.toContain(game.pgn!)
  })

  it('descarta respostas canceladas, antigas ou de outra jogada', () => {
    const request = { id: 7, ply: 3, mode: 'chat' as const }
    expect(replyMatchesSelection(request, { id: 7 }, 3, false)).toBe(true)
    expect(replyMatchesSelection(request, { id: 7 }, 4, false)).toBe(false)
    expect(replyMatchesSelection(request, { id: 8 }, 3, false)).toBe(false)
    expect(replyMatchesSelection(request, { id: 7 }, 3, true)).toBe(false)
    expect(replyMatchesSelection({ id: 7, ply: 3, mode: 'diagnosis' }, { id: 7 }, 4, false)).toBe(true)
  })
})

afterEach(() => vi.unstubAllGlobals())

describe('cache e credenciais', () => {
  it('deduplica pedidos idênticos e reutiliza uma explicação pronta', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    const payload: CoachRequest = { mode: 'explain', context: { ...buildMoveCoachContext(game, analysis.moves[0], 10), gameId: 'cache-test-1' } }
    const signal = new AbortController().signal
    const first = requestCoach(payload, signal)
    const second = requestCoach(payload, signal)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolveFetch(new Response(JSON.stringify({ text: 'Observe a resposta das pretas.' }), { status: 200 }))
    expect(await first).toBe('Observe a resposta das pretas.')
    expect(await second).toBe('Observe a resposta das pretas.')
    expect(await requestCoach(payload, signal)).toBe('Observe a resposta das pretas.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('propaga cancelamento e não guarda resposta interrompida', async () => {
    const fetchMock = vi.fn((_: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')))
    }))
    vi.stubGlobal('fetch', fetchMock)
    const payload: CoachRequest = { mode: 'chat', context: { ...buildMoveCoachContext(game, analysis.moves[0], 10), gameId: 'cancel-test-2' }, question: 'Por quê?' }
    const controller = new AbortController()
    const pending = requestCoach(payload, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

})
