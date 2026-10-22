import { timingSafeEqual } from 'node:crypto'
import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import { CoachService, DEFAULT_MODEL, REQUEST_LIMITS, publicError } from '../server/coach'

const apiKey = process.env.GEMINI_API_KEY?.trim()
const accessCode = process.env.COACH_ACCESS_CODE?.trim()
const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null

// The service preserves the existing PGN/Stockfish checks and answer validation.
// Its in-memory rate limit is only best-effort in a serverless environment.
const service = new CoachService(async (prompt, systemInstruction, maxTokens, signal) => {
  if (!ai) throw new Error('GEMINI_API_KEY ausente.')
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction,
      temperature: 0.25,
      maxOutputTokens: maxTokens,
      ...(model.startsWith('gemini-3.')
        ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
        : {}),
      abortSignal: signal,
      httpOptions: { timeout: 37_000, retryOptions: { attempts: 1 } },
    },
  })
  return {
    text: response.text ?? '',
    finishReason: response.candidates?.[0]?.finishReason,
    outputTokens: response.usageMetadata?.candidatesTokenCount,
    thinkingTokens: response.usageMetadata?.thoughtsTokenCount,
  }
})

function json(status: number, body: object): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function isAuthorized(provided: string | null): boolean {
  // Fail closed: the Coach must never be publicly callable without an access code.
  if (!accessCode || !provided) return false
  const received = Buffer.from(provided, 'utf8')
  const expected = Buffer.from(accessCode, 'utf8')
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export async function POST(request: Request): Promise<Response> {
  if (!apiKey || !accessCode) {
    return json(503, { error: 'Configure GEMINI_API_KEY e COACH_ACCESS_CODE na Vercel.' })
  }

  // Explicit same-origin check; credentials are sent in a custom header.
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return json(403, { error: 'Origem não permitida.' })
  }
  if (!isAuthorized(request.headers.get('x-coach-access'))) {
    return json(401, { error: 'Código de acesso do treinador inválido.' })
  }
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) {
    return json(415, { error: 'Envie JSON.' })
  }
  const length = Number(request.headers.get('content-length') ?? '0')
  if (length > REQUEST_LIMITS.bytes) {
    return json(413, { error: 'Pedido grande demais.' })
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  request.signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, REQUEST_LIMITS.timeoutMs)

  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw, 'utf8') > REQUEST_LIMITS.bytes) {
      return json(413, { error: 'Pedido grande demais.' })
    }
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return json(400, { error: 'JSON inválido.' })
    }

    const ip = (request.headers.get('x-vercel-forwarded-for')
      ?? request.headers.get('x-forwarded-for')
      ?? 'unknown').split(',')[0].trim()
    const text = await service.answer(body, ip, controller.signal)
    return json(200, { text })
  } catch (error) {
    const mapped = publicError(error)
    return json(mapped.status, { error: mapped.message })
  } finally {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', abort)
  }
}
