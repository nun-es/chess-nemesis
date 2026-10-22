import { describe, expect, it } from 'vitest'
import { analyzeReplay, buildMoveEvaluations, classifyMove, formatScore, sanToPortuguese, scoreFromUci, whiteAdvantageFraction } from './analysis'
import type { PositionEngine, PositionEvaluation } from './analysis'
import { parsePgn } from './chess'

const whiteFen = '8/8/8/8/8/8/8/K6k w - - 0 1'
const blackFen = '8/8/8/8/8/8/8/K6k b - - 0 1'

describe('avaliação e perspectiva UCI', () => {
  it('converte centipawns do lado a jogar para a perspectiva branca', () => {
    expect(scoreFromUci('cp', 120, whiteFen)).toEqual({ kind: 'cp', whiteCp: 120 })
    expect(scoreFromUci('cp', 120, blackFen)).toEqual({ kind: 'cp', whiteCp: -120 })
    expect(scoreFromUci('cp', -80, blackFen)).toEqual({ kind: 'cp', whiteCp: 80 })
    expect(formatScore(scoreFromUci('cp', 0, blackFen))).toBe('+0.0')
    expect(formatScore({ kind: 'cp', whiteCp: -80 })).toBe('-0.8')
    expect(whiteAdvantageFraction({ kind: 'cp', whiteCp: 5000 })).toBeLessThan(1)
  })

  it('mantém mate separado de centipawns e identifica o vencedor', () => {
    expect(scoreFromUci('mate', 3, blackFen)).toEqual({ kind: 'mate', winner: 'black', distance: 3 })
    expect(scoreFromUci('mate', -2, blackFen)).toEqual({ kind: 'mate', winner: 'white', distance: 2 })
    expect(formatScore({ kind: 'mate', winner: 'black', distance: 2 })).toBe('-M2')
  })

  it('apresenta SAN com as iniciais das peças em português', () => {
    expect(sanToPortuguese('Nf3')).toBe('Cf3')
    expect(sanToPortuguese('Rxe3+')).toBe('Txe3+')
    expect(sanToPortuguese('e8=Q+')).toBe('e8=D+')
    expect(sanToPortuguese('O-O')).toBe('O-O')
  })
})

describe('classificação dos lances', () => {
  const cp = (whiteCp: number) => ({ kind: 'cp' as const, whiteCp })

  it('usa os limites de 50, 100 e 200 cp', () => {
    expect(classifyMove(cp(0), cp(-49), 'w').classification).toBe('none')
    expect(classifyMove(cp(0), cp(-50), 'w').classification).toBe('inaccuracy')
    expect(classifyMove(cp(0), cp(-99), 'w').classification).toBe('inaccuracy')
    expect(classifyMove(cp(0), cp(-100), 'w').classification).toBe('mistake')
    expect(classifyMove(cp(0), cp(-200), 'w').classification).toBe('blunder')
  })

  it('detecta perda de vantagem das pretas sem inverter o sinal incorretamente', () => {
    expect(classifyMove(cp(-120), cp(60), 'b')).toMatchObject({ classification: 'mistake', lossCp: 180 })
    expect(classifyMove(cp(60), cp(-120), 'b').classification).toBe('none')
    expect(classifyMove(cp(40), cp(40), 'b').lossCp).toBe(0)
  })

  it('classifica mate concedido com segurança e deixa diferenças incertas sem perda em peões', () => {
    expect(classifyMove(cp(0), { kind: 'mate', winner: 'black', distance: 2 }, 'w'))
      .toMatchObject({ classification: 'blunder', lossCp: null })
    expect(classifyMove(cp(0), { kind: 'mate', winner: 'white', distance: 2 }, 'b'))
      .toMatchObject({ classification: 'blunder', lossCp: null })
    expect(classifyMove({ kind: 'mate', winner: 'white', distance: 3 }, cp(200), 'w'))
      .toMatchObject({ classification: 'uncertain', lossCp: null })
    expect(classifyMove(cp(20), { kind: 'mate', winner: 'white', distance: 3 }, 'w'))
      .toMatchObject({ classification: 'none', lossCp: null })
  })
})

describe('associação entre jogadas e avaliações', () => {
  const replay = parsePgn('1. e4 e5 2. Nf3 *')
  const positions: PositionEvaluation[] = replay.fens.map((fen, index) => ({
    fen, score: { kind: 'cp', whiteCp: [0, -120, 60, 20][index] }, bestMoveUci: index === 0 ? 'd2d4' : null, depth: 10,
  }))

  it('usa sempre a posição anterior para a alternativa e alinha cada lance à FEN resultante', () => {
    const moves = buildMoveEvaluations(replay, positions)
    expect(moves.map((move) => move.after.fen)).toEqual(replay.fens.slice(1))
    expect(moves[0]).toMatchObject({ ply: 1, san: 'e4', classification: 'mistake', bestMove: { san: 'd4', uci: 'd2d4' } })
    expect(moves[1]).toMatchObject({ ply: 2, san: 'e5', classification: 'mistake', lossCp: 180 })
    expect(() => buildMoveEvaluations(replay, [...positions].reverse())).toThrow('não correspondem')
  })

  it('interrompe a análise, encerra o motor e não produz resultado parcial', async () => {
    const controller = new AbortController()
    let disposed = 0
    let evaluated = 0
    const engine: PositionEngine = {
      initialize: async () => {},
      evaluate: async (fen) => {
        evaluated += 1
        return { fen, score: { kind: 'cp', whiteCp: 0 }, bestMoveUci: 'e2e4', depth: 10 }
      },
      dispose: () => { disposed += 1 },
    }
    await expect(analyzeReplay(replay, engine, controller.signal, (done) => { if (done === 1) controller.abort() }, undefined, 10, new Map())).rejects.toMatchObject({ name: 'AbortError' })
    expect(evaluated).toBe(1)
    expect(disposed).toBe(1)
  })
})
