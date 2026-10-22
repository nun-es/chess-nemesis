import Markdown from 'react-markdown'
import { normalizeCoachMarkdown } from '../lib/coachMarkdown'

export default function CoachMarkdown({ text }: { text: string }) {
  return <div className="coach-markdown"><Markdown skipHtml>{normalizeCoachMarkdown(text)}</Markdown></div>
}
