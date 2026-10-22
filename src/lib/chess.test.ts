import { describe, expect, it } from 'vitest'
import { parsePgn, positionAt } from './chess'

describe('reprodução de PGN', () => {
  const pgn = '[Event "Test"]\n\n1. e4 e5 2. Nf3 Nc6 *'

  it('gera uma posição para o início e cada lance', () => {
    const replay = parsePgn(pgn)
    expect(replay.moves.map((move) => move.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6'])
    expect(replay.fens).toHaveLength(5)
    expect(positionAt(replay, 0)).toContain(' w KQkq ')
    expect(positionAt(replay, 1)).toContain(' b KQkq ')
    expect(positionAt(replay, 4)).toBe(replay.fens[4])
  })

  it('limita a navegação às posições existentes', () => {
    const replay = parsePgn(pgn)
    expect(positionAt(replay, -7)).toBe(replay.fens[0])
    expect(positionAt(replay, 100)).toBe(replay.fens[4])
  })

  it('rejeita PGN ausente ou inválido', () => {
    expect(() => parsePgn(null)).toThrow('não tem PGN')
    expect(() => parsePgn('1. e4 e5 2. NotAMove')).toThrow('inválido')
  })
})
