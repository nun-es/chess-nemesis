import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import { CoachService, DEFAULT_MODEL, REQUEST_LIMITS, publicError } from '../server/coach.js'

const apiKey = process.env.GEMINI_API_KEY?.trim()
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

export async function POST(request: Request): Promise<Response> {
  if (!apiKey) {
    return json(503, { error: 'Configure GEMINI_API_KEY na Vercel.' })
  }

  // Reject cross-origin browser requests; this is not a substitute for rate limiting.
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return json(403, { error: 'Origem não permitida.' })
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
