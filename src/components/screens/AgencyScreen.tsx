import { PreviewBanner } from './PreviewBanner'

export function AgencyScreen() {
  return (
    <div>
      <PreviewBanner message="대행 클라이언트 카드는 팀 채팅에서 구글폼 응답을 전달하면 생성됩니다. 아직 등록된 클라이언트가 없습니다." />
      <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <p className="text-sm font-medium text-[var(--text)]">
          등록된 대행 클라이언트가 없습니다
        </p>
        <p className="mt-1 text-xs text-[var(--text-faint)]">
          팀 채팅에서 버즈에게 구글폼 응답 + 스레드 링크를 전달하면 여기에
          카드가 만들어집니다.
        </p>
      </div>
    </div>
  )
}
