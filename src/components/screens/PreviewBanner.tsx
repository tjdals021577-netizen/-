interface Props {
  message?: string
}

export function PreviewBanner({
  message = '미리보기 화면입니다 — 아직 실제 데이터와 연결되지 않았습니다. 다음 단계에서 순서대로 기능이 붙습니다.',
}: Props) {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-[var(--planned)] bg-[var(--planned-soft)] px-3 py-2 text-xs font-medium text-[var(--planned)]">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--planned)]" />
      {message}
    </div>
  )
}
