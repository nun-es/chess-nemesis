import { describe, expect, it } from 'vitest'
import { parseUciInfo, StockfishEngine } from './stockfish'

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  commands: string[] = []
  terminated = false
  postMessage(command: string) {
    this.commands.push(command)
    if (command === 'uci') queueMicrotask(() => this.emit('uciok'))
    if (command === 'isready') queueMicrotask(() => this.emit('readyok'))
    if (command === 'go depth 10') queueMicrotask(() => {
      this.emit('info depth 10 seldepth 12 multipv 1 score cp 85 nodes 1000 pv e2e4 e7e5')
      this.emit('info depth 10 seldepth 12 multipv 2 score cp 40 nodes 1000 pv d2d4 d7d5')
      this.emit('bestmove e2e4 ponder e7e5')
    })
  }
  emit(line: string) { this.onmessage?.({ data: line } as MessageEvent) }
  terminate() { this.terminated = true }
}

describe('protocolo UCI do Stockfish', () => {
  it('lê centipawns, mate e duas variantes, ignorando limites', () => {
    expect(parseUciInfo('info depth 10 score cp -85 nodes 100')).toEqual({ depth: 10, rank: 1, score: { kind: 'cp', value: -85 }, pv: null, pvMoves: [] })
    expect(parseUciInfo('info depth 10 score mate 3 pv e2e4 e7e5')).toEqual({ depth: 10, rank: 1, score: { kind: 'mate', value: 3 }, pv: 'e2e4', pvMoves: ['e2e4', 'e7e5'] })
    expect(parseUciInfo('info depth 10 multipv 2 score cp 40 pv d2d4')).toMatchObject({ rank: 2, pv: 'd2d4' })
    expect(parseUciInfo('info depth 10 score cp 40 lowerbound')).toBeNull()
  })

  it('inicializa UCI, analisa uma posição e encerra o Worker', async () => {
    const worker = new FakeWorker()
    const engine = new StockfishEngine(() => worker)
    const signal = new AbortController().signal
    await engine.initialize(signal)
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    const result = await engine.evaluate(fen, 10, signal)
    expect(worker.commands).toContain(`position fen ${fen}`)
    expect(worker.commands).toContain('setoption name MultiPV value 2')
    expect(result).toMatchObject({ fen, score: { kind: 'cp', whiteCp: 85 }, bestMoveUci: 'e2e4', depth: 10,
      pvUci: ['e2e4', 'e7e5'], secondBest: { uci: 'd2d4', score: { kind: 'cp', whiteCp: 40 }, pvUci: ['d2d4', 'd7d5'] } })
    engine.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('cancela uma busca pendente e termina o Worker imediatamente', async () => {
    const worker = new FakeWorker()
    const engine = new StockfishEngine(() => worker)
    const controller = new AbortController()
    await engine.initialize(controller.signal)
    const pending = engine.evaluate('8/8/8/8/8/8/8/K6k w - - 0 1', 9, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.terminated).toBe(true)
  })

  it('informa falha ao criar ou carregar o Worker', async () => {
    const controller = new AbortController()
    await expect(new StockfishEngine(() => { throw new Error('blocked') }).initialize(controller.signal))
      .rejects.toThrow('Não foi possível criar o Worker')
    const worker = new FakeWorker()
    worker.postMessage = (command: string) => {
      worker.commands.push(command)
      queueMicrotask(() => worker.onerror?.({ message: 'load failed' } as ErrorEvent))
    }
    await expect(new StockfishEngine(() => worker).initialize(controller.signal))
      .rejects.toThrow('Falha ao carregar o Stockfish')
    expect(worker.terminated).toBe(true)
  })
})
