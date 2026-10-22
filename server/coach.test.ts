import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { buildMoveEvaluations } from '../src/lib/analysis'
import type { PositionEvaluation } from '../src/lib/analysis'
import { parsePgn } from '../src/lib/chess'
import { buildMoveCoachContext } from '../src/lib/coach'
import type { GameSummary } from '../src/lib/games'
import { CoachService, buildPrompt, checkedGeminiAnswer, parseCoachRequest, publicError, verifiedMoveReferences } from './coach'

const game: GameSummary = {
  id: 'server-test-game', pgn: '1. e4 *', endTime: 1, timeClass: 'rapid', userColor: 'white', result: 'win',
  white: { username: 'Player', rating: 1000, result: 'win' }, black: { username: 'Opponent', rating: 1100, result: 'resigned' },
  opponent: { username: 'Opponent', rating: 1100, result: 'resigned' },
}
const replay = parsePgn(game.pgn!)
const positions: PositionEvaluation[] = replay.fens.map((fen) => ({ fen, score: { kind: 'cp', whiteCp: 0 }, depth: 10, bestMoveUci: 'e2e4' }))
const move = buildMoveEvaluations(replay, positions)[0]
const payload = { mode: 'explain' as const, context: buildMoveCoachContext(game, move, 10) }
const complete = 'O que aconteceu: e4 ocupou o centro.\nPor que foi bom ou ruim: A posição ficou equilibrada.\nO que seria melhor: A variante principal não está disponível.\nO que aprender: Confira a resposta do adversário.'

describe('servidor do treinador', () => {
  it('mantém segredos fora do frontend e ignora .env no repositório', () => {
    expect(readFileSync('.gitignore', 'utf8')).toContain('.env')
    expect(readFileSync('.env.example', 'utf8')).toContain('GEMINI_API_KEY=')
    expect(readFileSync('src/lib/coach.ts', 'utf8')).not.toContain('process.env')
    expect(readFileSync('src/components/CoachPanel.tsx', 'utf8')).not.toContain('GEMINI_API_KEY')
  })
  it('valida jogada/FEN e rejeita contexto adulterado ou pergunta excessiva', () => {
    expect(parseCoachRequest(payload)).toEqual(payload)
    expect(() => parseCoachRequest({ ...payload, context: { ...payload.context, fenAfter: replay.fens[0] } })).toThrow('Posições')
    expect(() => parseCoachRequest({ mode: 'chat', context: payload.context, question: 'x'.repeat(401) })).toThrow('Pergunta')
  })

  it('monta instrução factual e usa cache sem chamada Gemini duplicada', async () => {
    const generate = vi.fn(async () => ({ text: complete, finishReason: 'STOP' }))
    const service = new CoachService(generate)
    const signal = new AbortController().signal
    const [first, second] = await Promise.all([service.answer(payload, 'local', signal), service.answer(payload, 'local', signal)])
    expect(first).toBe(second)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(await service.answer(payload, 'local', signal)).toBe(first)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(buildPrompt(payload)).not.toContain('SOMENTE desta partida')
  })

  it('aplica rate limit antes de chamar o SDK e mapeia 429/503/timeout', async () => {
    const generate = vi.fn(async () => ({ text: complete, finishReason: 'STOP' }))
    const service = new CoachService(generate, () => 0, { perMinute: 1, perDay: 5 })
    const signal = new AbortController().signal
    await service.answer(payload, 'local', signal)
    await expect(service.answer(payload, 'local', signal)).rejects.toMatchObject({ status: 429 })
    expect(generate).toHaveBeenCalledTimes(1)
    expect(publicError({ status: 429 })).toMatchObject({ status: 429 })
    expect(publicError({ status: 503 })).toMatchObject({ status: 503 })
    expect(publicError({ status: 400, message: 'key=secret' }).message).not.toContain('secret')
    expect(publicError(new DOMException('timeout', 'AbortError'))).toMatchObject({ status: 504 })
    expect(publicError(new Error('secret=abc')).message).not.toContain('secret=abc')
  })

  it('não coloca no cache uma resposta que chegou depois do cancelamento', async () => {
    let release!: (answer: { text: string; finishReason: string }) => void
    const generate = vi.fn(() => new Promise<{ text: string; finishReason: string }>((resolve) => { release = resolve }))
    const service = new CoachService(generate)
    const controller = new AbortController()
    const pending = service.answer(payload, 'local', controller.signal)
    controller.abort()
    release({ text: complete, finishReason: 'STOP' })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const next = service.answer(payload, 'local', new AbortController().signal)
    release({ text: complete, finishReason: 'STOP' })
    expect(await next).toBe(complete)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('rejeita MAX_TOKENS, fim desconhecido e seções vazias sem colocá-los no cache', async () => {
    expect(() => checkedGeminiAnswer({ text: complete.slice(0, 30), finishReason: 'MAX_TOKENS' }, 'explain')).toThrow('limite')
    expect(() => checkedGeminiAnswer({ text: complete, finishReason: 'SAFETY' }, 'explain')).toThrow('interrompeu')
    expect(() => checkedGeminiAnswer({ text: complete.replace('A variante principal não está disponível.', ''), finishReason: 'STOP' }, 'explain')).toThrow('seção vazia')
    expect(() => checkedGeminiAnswer({ text: 'A ideia principal:', finishReason: 'STOP' }, 'chat')).toThrow('meio')
    const generate = vi.fn().mockResolvedValueOnce({ text: 'O que aconteceu:', finishReason: 'MAX_TOKENS' }).mockResolvedValue({ text: complete, finishReason: 'STOP' })
    const service = new CoachService(generate)
    await expect(service.answer(payload, 'local', new AbortController().signal)).rejects.toThrow('limite')
    expect(await service.answer(payload, 'local', new AbortController().signal)).toBe(complete)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('rejeita referência a lance não verificado na posição selecionada', () => {
    const blackGame = { ...game, pgn: '1. e4 e5 2. Nf3 Nc6 *', userColor: 'black' as const }
    const replayBlack = parsePgn(blackGame.pgn)
    const positionsBlack = replayBlack.fens.map((fen, index) => ({ fen, score: { kind: 'cp' as const, whiteCp: 0 }, depth: 10,
      bestMoveUci: index === 3 ? 'd7d6' : null, pvUci: index === 3 ? ['d7d6', 'd2d4'] : [] }))
    const selected = buildMoveEvaluations(replayBlack, positionsBlack)[3]
    const request = { mode: 'chat' as const, context: buildMoveCoachContext(blackGame, selected, 10), question: 'Qual movimento você recomenda?' }
    expect(request.context).toMatchObject({ ply: 4, mover: 'black', san: 'Cc6', bestMove: 'd6', principalVariation: ['d6', 'd4'] })
    expect(parseCoachRequest(request)).toEqual(request)
    expect(verifiedMoveReferences('O Stockfish recomenda 2...d6.', request)).toBe(true)
    expect(verifiedMoveReferences('O Stockfish recomenda 2...exf4.', request)).toBe(false)
    expect(verifiedMoveReferences('Recomendo 2...Cc6.', request)).toBe(false)
  })
})
