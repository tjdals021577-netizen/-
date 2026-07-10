import { useState } from 'react'
import { BlogComposer } from '../BlogComposer'
import { ThreadComposer } from '../ThreadComposer'
import { RemixComposer } from '../RemixComposer'
import { PreviewBanner } from './PreviewBanner'

type ToolId = 'blog' | 'thread' | 'remix'

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'blog', label: '블로그' },
  { id: 'thread', label: '스레드' },
  { id: 'remix', label: '유튜브 기획' },
]

export function OpsScreen() {
  const [tool, setTool] = useState<ToolId>('blog')

  return (
    <div>
      <PreviewBanner message="콘텐츠 캘린더·결재함·지시 입력창은 Phase 4(백엔드) 이후에 실제 데이터와 연결됩니다. 지금은 아래 제작 도구들이 실제로 동작합니다." />

      <div className="mb-4 flex gap-1 rounded-lg bg-[var(--surface-2)] p-1 w-fit">
        {TOOLS.map((t) => (
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

      {tool === 'blog' && <BlogComposer />}
      {tool === 'thread' && <ThreadComposer />}
      {tool === 'remix' && <RemixComposer />}
    </div>
  )
}
