import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { CLASSIFICATIONS, buildMoveEvaluations, classifyReviewedMove, countClassifications, isVerifiedSacrifice, nextCategoryPly } from './analysis'
import type { PositionEvaluation, Score } from './analysis'
import { parsePgn } from './chess'
import { isBookMove } from './openings'

const cp = (whiteCp: number): Score => ({ kind: 'cp', whiteCp })
const start = new Chess()
const first = start.fen()
const e4 = start.move('e4')
const second = start.fen()
const evalAt = (fen: string, score: Score, bestMoveUci: string | null, secondBest?: PositionEvaluation['secondBest']): PositionEvaluation => ({ fen, score, bestMoveUci, secondBest, depth: 12 })
const move = { san: e4.san, from: e4.from, to: e4.to, color: e4.color, piece: e4.piece, promotion: e4.promotion }

describe('revisão completa', () => {
  it('usa apenas sequências exatas da base real para jogadas teóricas', () => {
    expect(isBookMove(['e2e4'])).toBe(true)
    expect(isBookMove(['e2e4', 'e7e5'])).toBe(true)
    expect(isBookMove(['a2a3', 'h7h5'])).toBe(false)
    expect(isBookMove([])).toBe(false)
  })
  it('atribui categorias comuns, melhor, teórica e dez linhas no painel', () => {
    const before = (score: Score, best = 'd2d4', alternative?: PositionEvaluation['secondBest']) => evalAt(first, score, best, alternative)
    const after = (score: Score) => evalAt(second, score, 'e7e5')
    expect(CLASSIFICATIONS).toHaveLength(10)
    expect(classifyReviewedMove(move, before(cp(0), 'e2e4'), after(cp(0)), false).classification).toBe('best')
    expect(classifyReviewedMove(move, before(cp(0)), after(cp(-15)), false).classification).toBe('excellent')
    expect(classifyReviewedMove(move, before(cp(0)), after(cp(-40)), false).classification).toBe('good')
    expect(classifyReviewedMove(move, before(cp(0), 'e2e4'), after(cp(0)), true).classification).toBe('book')
    expect(classifyReviewedMove(move, before(cp(0)), after(cp(-60)), false).classification).toBe('inaccuracy')
    expect(classifyReviewedMove(move, before(cp(0)), after(cp(-120)), false).classification).toBe('mistake')
    expect(classifyReviewedMove(move, before(cp(0)), after(cp(-250)), false).classification).toBe('blunder')
    expect(classifyReviewedMove(move, before(cp(2000)), after(cp(1700)), false).classification).toBe('excellent')
  })

  it('reconhece apenas uma defesa realmente única como ótima', () => {
    const before = evalAt(first, cp(0), 'e2e4', { uci: 'd2d4', score: cp(-400), depth: 12 })
    expect(classifyReviewedMove(move, before, evalAt(second, cp(0), 'e7e5'), false).classification).toBe('great')
    expect(classifyReviewedMove(move, { ...before, secondBest: undefined }, evalAt(second, cp(0), 'e7e5'), false).classification).toBe('best')
  })

  it('exige captura real de uma peça sacrificada, avaliação adequada e duas variantes para brilhante', () => {
    const board = new Chess('4k3/8/3p4/8/8/5N2/8/4K3 w - - 0 1')
    const played = board.move({ from: 'f3', to: 'e5' })
    const candidate = { san: played.san, from: played.from, to: played.to, color: played.color, piece: played.piece }
    const before = evalAt('4k3/8/3p4/8/8/5N2/8/4K3 w - - 0 1', cp(20), 'f3e5', { uci: 'f3g5', score: cp(-230), depth: 12 })
    const after = evalAt(board.fen(), cp(30), 'd6e5')
    expect(isVerifiedSacrifice(before, after, candidate)).toBe(true)
    expect(classifyReviewedMove(candidate, before, after, false).classification).toBe('brilliant')
    expect(classifyReviewedMove(candidate, before, { ...after, bestMoveUci: 'e8e7' }, false).classification).not.toBe('brilliant')
    expect(classifyReviewedMove(candidate, { ...before, secondBest: undefined }, after, false).classification).toBe('best')
  })

  it('detecta uma oportunidade tática perdida sem contar também como erro', () => {
    const board = new Chess('4k3/8/8/8/4p3/8/8/3QK3 w - - 0 1')
    const played = board.move('Qd2')
    const reviewed = classifyReviewedMove(played, evalAt('4k3/8/8/8/4p3/8/8/3QK3 w - - 0 1', cp(450), 'd1h5'), evalAt(board.fen(), cp(0), 'e8e7'), false)
    expect(reviewed.classification).toBe('missed')
    expect(classifyReviewedMove(played, evalAt('4k3/8/8/8/4p3/8/8/3QK3 w - - 0 1', cp(450), 'd1h5'), evalAt(board.fen(), cp(-500), 'e8e7'), false).classification).toBe('blunder')
  })

  it('normaliza pretas, inclusive oportunidades perdidas, e não converte mate em peões', () => {
    const board = new Chess('3qk3/8/8/8/8/8/8/4K3 b - - 0 1')
    const played = board.move('Qd7')
    expect(classifyReviewedMove(played, evalAt('3qk3/8/8/8/8/8/8/4K3 b - - 0 1', cp(-450), 'd8h4'), evalAt(board.fen(), cp(0), 'e1e2'), false).classification).toBe('missed')
    expect(classifyReviewedMove(played, evalAt('3qk3/8/8/8/8/8/8/4K3 b - - 0 1', cp(0), 'd8h4'), evalAt(board.fen(), cp(120), 'e1e2'), false).classification).toBe('mistake')
    expect(classifyReviewedMove(move, evalAt(first, cp(0), 'd2d4'), evalAt(second, { kind: 'mate', winner: 'black', distance: 2 }, 'e7e5'), false)).toMatchObject({ classification: 'blunder', lossCp: null })
    expect(classifyReviewedMove(move, evalAt(first, { kind: 'mate', winner: 'white', distance: 3 }, 'd2d4'), evalAt(second, cp(200), 'e7e5'), false).classification).toBe('unclassified')
  })

  it('conta cada lance uma vez e percorre ocorrências com retorno ao início', () => {
    const replay = parsePgn('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *')
    const positions = replay.fens.map((fen) => evalAt(fen, cp(0), null))
    const moves = buildMoveEvaluations(replay, positions)
    moves.forEach((item, index) => { item.classification = index % 2 ? 'blunder' : 'best' })
    const counts = countClassifications(moves)
    expect(counts.w.best).toBe(3)
    expect(counts.b.blunder).toBe(3)
    expect(Object.values(counts.w).reduce((a, b) => a + b, 0) + Object.values(counts.b).reduce((a, b) => a + b, 0)).toBe(6)
    expect(nextCategoryPly(moves, 'blunder', 'b', 0)).toBe(2)
    expect(nextCategoryPly(moves, 'blunder', 'b', 2)).toBe(4)
    expect(nextCategoryPly(moves, 'blunder', 'b', 6)).toBe(2)
    expect(nextCategoryPly(moves, 'brilliant', 'b', 0)).toBeNull()
  })
})
