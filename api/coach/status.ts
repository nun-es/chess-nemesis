import { DEFAULT_MODEL } from '../../server/coach'

export function GET(): Response {
  const ready = Boolean(process.env.GEMINI_API_KEY?.trim() && process.env.COACH_ACCESS_CODE?.trim())
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL
  return Response.json({
    ready,
    model,
    reason: ready ? undefined : 'Configure GEMINI_API_KEY e COACH_ACCESS_CODE no projeto da Vercel.',
  }, {
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  })
}
