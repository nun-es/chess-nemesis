import { Chess } from 'chess.js'

export interface Replay {
  fens: string[]
  moves: { san: string; from: string; to: string; color: 'w' | 'b'; piece: string; promotion?: string }[]
}

export function parsePgn(pgn: string | null): Replay {
  if (!pgn?.trim()) throw new Error('Esta partida não tem PGN disponível para reprodução.')
  const game = new Chess()
  try {
    game.loadPgn(pgn)
  } catch {
    throw new Error('O PGN desta partida está inválido e não pôde ser reproduzido.')
  }
  const moves = game.history({ verbose: true })
  if (!moves.length) throw new Error('O PGN desta partida não contém jogadas para reproduzir.')
  return {
    fens: [moves[0].before, ...moves.map((move) => move.after)],
    moves: moves.map(({ san, from, to, color, piece, promotion }) => ({ san, from, to, color, piece, promotion })),
  }
}

export function positionAt(replay: Replay, ply: number): string {
  return replay.fens[Math.max(0, Math.min(Math.trunc(ply), replay.moves.length))]
}
