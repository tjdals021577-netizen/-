import { useEffect, useState } from 'react'
import { PreviewBanner } from './PreviewBanner'
import {
  listContentPhotos,
  addContentPhoto,
  deleteContentPhoto,
  getContentPhotos,
  getUpcomingBlogSlots,
  syncContentPhotosFromSupabase,
} from '../../lib/contentPhotoStore'
import { fileToBase64, mediaTypeOf } from '../../lib/imageFile'
import type { Brand } from '../../types/brand'

function formatDateLabel(dateStr: string): string {
  const [, m, d] = dateStr.split('-')
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(`${dateStr}T00:00:00+09:00`).getDay()]
  return `${Number(m)}월 ${Number(d)}일 (${weekday})`
}

function SlotCard({
  date,
  brand,
  onChanged,
}: {
  date: string
  brand: Brand
  onChanged: () => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const photos = getContentPhotos(date, brand)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        const mediaType = mediaTypeOf(file)
        if (!mediaType) {
          setError('png/jpeg/webp 이미지만 올릴 수 있습니다.')
          continue
        }
        const imageBase64 = await fileToBase64(file)
        addContentPhoto({ date, brand, label: file.name, imageBase64, mediaType })
      }
      onChanged()
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-[13.5px] font-bold text-[var(--text)]">{formatDateLabel(date)}</p>
          <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-faint)]">
            {brand} · 블로그
          </span>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
            photos.length > 0
              ? 'bg-[var(--done-soft)] text-[var(--done)]'
              : 'bg-[var(--open-soft)] text-[var(--open)]'
          }`}
        >
          {photos.length > 0 ? `${photos.length}장 업로드됨` : '사진 필요'}
        </span>
      </div>

      {photos.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {photos.map((p) => (
            <div key={p.id} className="group relative h-16 w-16 overflow-hidden rounded-lg border border-[var(--border)]">
              <img
                src={`data:${p.mediaType};base64,${p.imageBase64}`}
                alt={p.label}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => {
                  deleteContentPhoto(p.id)
                  onChanged()
                }}
                className="absolute inset-0 flex items-center justify-center bg-black/50 text-[11px] font-bold text-white opacity-0 transition group-hover:opacity-100"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}

      <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[12px] font-bold text-[var(--text-dim)] transition hover:opacity-90">
        {uploading ? '업로드 중...' : '📷 사진 추가'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </label>
      {error && <p className="mt-1.5 text-[11px] text-[var(--open)]">{error}</p>}
    </div>
  )
}

export function PhotoUploadScreen() {
  const [, setVersion] = useState(0)

  useEffect(() => {
    void syncContentPhotosFromSupabase().then(() => setVersion((v) => v + 1))
  }, [])

  const upcoming = getUpcomingBlogSlots(7)
  const needCount = upcoming.filter((s) => !s.hasPhotos).length
  const allPhotos = listContentPhotos()

  return (
    <div>
      <PreviewBanner message="블로그는 화·목·토·일마다 업메리·마잘남 각각 새 글이 자동 기획됩니다. 그 글에 쓸 실제 사진을 미리 올려두면 그 날짜 콘텐츠 생성 때 AI가 사진을 직접 보고 글을 씁니다 — 사진이 없으면 텍스트만으로 씁니다. 아침 브리핑 카톡으로 사진이 필요한 날을 미리 알려드려요." />

      {needCount > 0 && (
        <div className="mb-4 rounded-xl border border-dashed border-[var(--open)] bg-[var(--open-soft)] px-4 py-2.5 text-[12.5px] font-semibold text-[var(--open)]">
          앞으로 {needCount}건의 블로그 예정일에 아직 사진이 없습니다.
        </div>
      )}

      <h2 className="mb-2.5 text-[14px] font-extrabold text-[var(--text)]">앞으로 7일 — 블로그 예정일</h2>
      <div className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {upcoming.map((slot) => (
          <SlotCard
            key={`${slot.date}-${slot.brand}`}
            date={slot.date}
            brand={slot.brand}
            onChanged={() => setVersion((v) => v + 1)}
          />
        ))}
      </div>

      {allPhotos.length > 0 && (
        <>
          <h2 className="mb-2.5 text-[14px] font-extrabold text-[var(--text)]">최근 업로드한 사진</h2>
          <div className="flex flex-wrap gap-2">
            {allPhotos.slice(0, 24).map((p) => (
              <div key={p.id} className="h-16 w-16 overflow-hidden rounded-lg border border-[var(--border)]">
                <img
                  src={`data:${p.mediaType};base64,${p.imageBase64}`}
                  alt={p.label}
                  className="h-full w-full object-cover"
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
