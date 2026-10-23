// 업메리 상담 신청(리드) — 대시보드 카드. 목록·상태 변경은 /api/radar-refresh(앱 비밀번호)를 거친다
// (leads 테이블은 공개 키로 읽기 금지). 개인정보라 브라우저 저장소(localStorage)에 리드를 남기지 않고
// 화면 상태로만 들고 있다. 상태를 "통화 완료"·"결제"로 바꾸면 다음 meta-capi 크론(07시대)이 메타로 보낸다.
import { useCallback, useEffect, useState } from 'react'
import { LEAD_STATUSES, type LeadRow, type LeadStatus } from '../types/lead'
import { buildLeadDoneSnippet, buildLeadFormSnippet } from '../lib/leadFormSnippet'
import { callLeadsApi, type LeadListResponse } from '../lib/leadsApi'

type ListResponse = LeadListResponse

const DONE_URL_KEY = 'ai-ops:lead-form-done-url'

function kstTime(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function formatPhone(p: string): string {
  return p.length === 11 ? `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}` : p
}

function sourceLabel(l: LeadRow): string {
  const parts = [l.utm_source, l.utm_campaign, l.utm_content].filter(Boolean)
  if (parts.length > 0) return parts.join(' / ')
  return l.fbclid ? '메타 광고(fbclid)' : '직접·알 수 없음'
}

function sentMarks(l: LeadRow): string {
  const marks = [l.capi_lead_sent_at ? '신청✓' : '신청 대기']
  if (l.called_at) marks.push(l.capi_contact_sent_at ? '통화✓' : '통화 대기')
  if (l.paid_at) marks.push(l.capi_purchase_sent_at ? '결제✓' : '결제 대기')
  return marks.join(' · ')
}

function readDoneUrl(): string {
  try {
    return localStorage.getItem(DONE_URL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function LeadsPanel() {
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [doneUrl, setDoneUrl] = useState(readDoneUrl)
  const [copied, setCopied] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await callLeadsApi<ListResponse>({ action: 'leads' }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function changeStatus(lead: LeadRow, status: LeadStatus) {
    if (status === '결제' && !(Number(amounts[lead.id] ?? lead.paid_amount) > 0)) {
      setError('결제로 바꾸기 전에 결제 금액(원)을 먼저 적어주세요. 메타 결제 전환에 금액이 함께 갑니다.')
      return
    }
    setSavingId(lead.id)
    setError(null)
    try {
      const r = await callLeadsApi<{ ok: boolean; lead?: LeadRow; error?: string }>({
        action: 'lead-status',
        id: lead.id,
        status,
        amount: amounts[lead.id] ?? lead.paid_amount ?? undefined,
      })
      if (!r.ok || !r.lead) throw new Error(r.error || '상태를 바꾸지 못했습니다.')
      const updated = r.lead
      setData((prev) => (prev && prev.ok ? { ...prev, leads: prev.leads.map((l) => (l.id === updated.id ? updated : l)) } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingId(null)
    }
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setError('복사하지 못했습니다. 브라우저 권한을 확인해 주세요.')
    }
  }

  function copyForm() {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) {
      setError('VITE_SUPABASE_URL·VITE_SUPABASE_ANON_KEY 환경변수가 없어 폼 코드를 만들 수 없습니다.')
      return
    }
    void copy('form', buildLeadFormSnippet({ supabaseUrl, supabaseKey, pixelId: data?.pixelId, doneUrl: doneUrl.trim() }))
  }

  function saveDoneUrl(v: string) {
    setDoneUrl(v)
    try {
      localStorage.setItem(DONE_URL_KEY, v)
    } catch {
      // 저장이 안 돼도 이번 화면에서는 쓴다.
    }
  }

  const leads = data && data.ok ? data.leads : []
  const counts = LEAD_STATUSES.map((s) => `${s} ${leads.filter((l) => l.status === s).length}`).join(' · ')

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-bold text-[var(--text)]">📝 업메리 — 상담 신청(리드)</p>
        <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-[var(--text-faint)]">
          <span>픽셀 {data?.pixelId ? '연결됨' : '미설정'} · 전환 API {data?.capiConfigured ? '연결됨' : '미설정'}</span>
          <button type="button" onClick={() => void load()} className="rounded-md bg-[var(--surface-2)] px-2 py-1 font-bold text-[var(--text)] hover:bg-[var(--border)]">
            새로고침
          </button>
          <button type="button" onClick={() => setShowSetup((v) => !v)} className="rounded-md bg-[var(--surface-2)] px-2 py-1 font-bold text-[var(--text)] hover:bg-[var(--border)]">
            폼 설치 {showSetup ? '닫기' : '열기'}
          </button>
        </div>
      </div>

      {showSetup && (
        <div className="mb-3 space-y-2 rounded-lg bg-[var(--surface-2)] p-3 text-[12px] text-[var(--text-dim)]">
          <p>① 아임웹 신청 페이지에 "코드" 블록을 넣고 <b>폼 코드</b>를 붙여 넣으세요. ② 완료 페이지를 따로 만들었다면 그 주소를 아래에 적고 다시 복사하세요(비우면 폼 자리에 완료 화면이 떠요). ③ 완료 페이지에는 <b>완료 페이지 코드</b>를 넣으세요.</p>
          <input
            type="url"
            value={doneUrl}
            onChange={(e) => saveDoneUrl(e.target.value)}
            placeholder="완료 페이지 주소 (예: https://내사이트/apply-done)"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[12px] text-[var(--text)]"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copyForm} className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-bold text-white">
              {copied === 'form' ? '복사됨' : '폼 코드 복사'}
            </button>
            <button type="button" onClick={() => void copy('done', buildLeadDoneSnippet())} className="rounded-md bg-[var(--surface)] px-3 py-1.5 text-[12px] font-bold text-[var(--text)] ring-1 ring-[var(--border)]">
              {copied === 'done' ? '복사됨' : '완료 페이지 코드 복사'}
            </button>
          </div>
          {!data?.pixelId && <p className="text-[11px]">메타 픽셀 ID(META_PIXEL_ID)가 아직 없어 폼에 픽셀이 빠진 채 복사돼요. 넣은 뒤 다시 복사하세요.</p>}
        </div>
      )}

      {error && <p className="mb-2 text-[12px] font-bold text-[var(--down)]">{error}</p>}

      {data === null && !error ? (
        <p className="py-3 text-center text-[12px] text-[var(--text-faint)]">불러오는 중…</p>
      ) : data && !data.ok ? (
        <p className="py-3 text-center text-[12px] text-[var(--text-faint)]">
          아직 leads 테이블이 없어요. Supabase SQL Editor에서 db/schema.sql 맨 아래 "상담 신청(리드)" 블록을 한 번 실행해 주세요.
        </p>
      ) : (
        <>
          <p className="mb-1 text-[11px] text-[var(--text-faint)]">{counts} · 상태를 바꾸면 다음 날 07시대에 메타로 전송돼요</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10.5px] text-[var(--text-faint)]">
                  <th className="py-1.5 pr-3 text-left font-bold">신청</th>
                  <th className="py-1.5 pr-3 text-left font-bold">이름·전화</th>
                  <th className="py-1.5 pr-3 text-left font-bold">타로 · 시간</th>
                  <th className="py-1.5 pr-3 text-left font-bold">유입</th>
                  <th className="py-1.5 pr-3 text-left font-bold">상태</th>
                  <th className="py-1.5 text-left font-bold">메타 전송</th>
                </tr>
              </thead>
              <tbody>
                {leads.length === 0 ? (
                  <tr><td colSpan={6} className="py-3 text-center text-[var(--text-faint)]">아직 신청이 없어요.</td></tr>
                ) : (
                  leads.map((l) => (
                    <tr key={l.id} className="border-t border-[var(--border)] align-top">
                      <td className="py-1.5 pr-3 tabular-nums text-[var(--text-dim)]">{kstTime(l.created_at)}</td>
                      <td className="py-1.5 pr-3 text-[var(--text)]">
                        <div className="font-semibold">{l.name}</div>
                        <a href={`tel:${l.phone}`} className="tabular-nums text-[var(--text-dim)]">{formatPhone(l.phone)}</a>
                      </td>
                      <td className="py-1.5 pr-3 text-[var(--text-dim)]">{l.tarot_experience ?? '—'} · {l.daily_time ?? '—'}</td>
                      <td className="max-w-[220px] py-1.5 pr-3 break-words text-[var(--text-dim)]">{sourceLabel(l)}</td>
                      <td className="py-1.5 pr-3">
                        <select
                          value={l.status}
                          disabled={savingId === l.id}
                          onChange={(e) => void changeStatus(l, e.target.value as LeadStatus)}
                          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-[12px] text-[var(--text)]"
                        >
                          {LEAD_STATUSES.map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={amounts[l.id] ?? (l.paid_amount ? String(l.paid_amount) : '')}
                          onChange={(e) => setAmounts((a) => ({ ...a, [l.id]: e.target.value }))}
                          placeholder="결제 금액(원)"
                          className="mt-1 block w-[120px] rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 py-1 text-[11.5px] text-[var(--text)]"
                        />
                      </td>
                      <td className="py-1.5 text-[11px] text-[var(--text-faint)]">{sentMarks(l)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
