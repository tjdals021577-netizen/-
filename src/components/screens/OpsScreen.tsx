import { useEffect, useState } from 'react'
import { BlogComposer } from '../BlogComposer'
import { ThreadComposer } from '../ThreadComposer'
import { RemixComposer } from '../RemixComposer'
import { BrainPanel } from '../BrainPanel'
import { PreviewBanner } from './PreviewBanner'
import { BRAND_CHANNELS, type Brand } from '../../types/brand'

type ToolId = 'blog' | 'thread' | 'remix' | 'brain'

const TOOLS: { id: ToolId; label: string; channel?: string }[] = [
  { id: 'blog', label: '블로그', channel: '블로그' },
  { id: 'thread', label: '스레드', channel: '스레드' },
  { id: 'remix', label: '유튜브 기획', channel: '유튜브' },
  { id: 'brain', label: '브레인' },
]

export function OpsScreen({ brand }: { brand: Brand }) {
  const [tool, setTool] = useState<ToolId>('blog')

  const availableTools = TOOLS.filter(
    (t) => !t.channel || BRAND_CHANNELS[brand].includes(t.channel),
  )

  useEffect(() => {
    if (!availableTools.some((t) => t.id === tool)) {
      setTool(availableTools[0]?.id ?? 'blog')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand])

  return (
    <div>
      <PreviewBanner message="아래에서 만든 결과물은 자동으로 결재함에 올라갑니다. 자연어 지시 입력창(캘린더 연동)은 Phase 4(백엔드) 이후에 지원됩니다." />

      <div className="mb-4 flex gap-1 rounded-lg bg-[var(--surface-2)] p-1 w-fit">
        {availableTools.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTool(t.id)}
            className={`rounded-md px-3.5 py-1.5 text-[13px] font-semibold transition ${
              tool === t.id
                ? 'bg-[var(--surface)] text-[var(--accent)] shadow-sm'
                : 'text-[var(--text-faint)] hover:text-[var(--text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tool === 'blog' && <BlogComposer brand={brand} />}
      {tool === 'thread' && BRAND_CHANNELS[brand].includes('스레드') && <ThreadComposer brand={brand} />}
      {tool === 'remix' && BRAND_CHANNELS[brand].includes('유튜브') && <RemixComposer brand={brand} />}
      {tool === 'brain' && <BrainPanel brand={brand} />}
    </div>
  )
}
