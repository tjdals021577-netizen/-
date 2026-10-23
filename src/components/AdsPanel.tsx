// 업메리 "광고" 카드 — 채널별 퍼널(노출 → 클릭 → 신청 → 통화 → 결제)과 비용 대비 성과(2026-10 대표님 요청).
// AI 호출 없이 코드로만 집계한다(src/lib/adFunnel.ts). 메타 광고 숫자는 radar 크론(07:50)이 매일 저장한 것,
// 당근은 설정 화면 CSV, 신청·통화·결제는 리드 테이블(서버 경유)에서 온다. 기간은 "어제까지 7일 / 30일".
import { useEffect, useMemo, useState } from 'react'
import {
  AD_CHANNEL_LABEL,
  buildAdFunnelReport,
  costPer,
  roas,
  type DaangnDailyRow,
  type FunnelStats,
  type MetaAdDailyRow,
} from '../lib/adFunnel'
import { fetchDaangnRows, fetchMetaAdRows, type AdRowsSnapshot } from '../lib/adStore'
import { callLeadsApi, type LeadListResponse } from '../lib/leadsApi'
import type { LeadRow } from '../types/lead'

const PERIODS = [7, 30] as const

function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function won(v: number | null): string {
  return v === null ? '—' : `${Math.round(v).toLocaleString('ko-KR')}원`
}

function count(v: number | null): string {
  return v === null ? '—' : Math.round(v).toLocaleString('ko-KR')
}

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100).toLocaleString('ko-KR')}%`
}

function kstStamp(iso: string | null): string {
  if (!iso) return '없음'
  const d = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

const TH = 'py-1.5 pr-3 font-bold whitespace-nowrap'
const TD = 'py-1.5 pr-3 tabular-nums whitespace-nowrap'

function StatCells({ s }: { s: FunnelStats }) {
  return (
    <>
      <td className={`${TD} text-right text-[var(--text-dim)]`}>{count(s.impressions)}</td>
      <td className={`${TD} text-right text-[var(--text-dim)]`}>{count(s.clicks)}</td>
      <td className={`${TD} text-right font-semibold text-[var(--text)]`}>{s.leads}</td>
      <td className={`${TD} text-right text-[var(--text)]`}>{s.calls}</td>
      <td className={`${TD} text-right text-[var(--text)]`}>{s.purchases}</td>
      <td className={`${TD} text-right text-[var(--text)]`}>{won(s.spend)}</td>
      <td className={`${TD} text-right text-[var(--text)]`}>{won(costPer(s.spend, s.leads))}</td>
      <td className={`${TD} text-right text-[var(--text)]`}>{won(costPer(s.spend, s.purchases))}</td>
      <td className={`${TD} text-right font-semibold text-[var(--text)]`}>{pct(roas(s.revenue, s.spend))}</td>
    </>
  )
}

const STAT_HEADERS = ['노출', '클릭', '신청', '통화', '결제', '비용', '신청당 비용', '결제당 비용', 'ROAS']

export function AdsPanel() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7)
  const [leads, setLeads] = useState<LeadRow[] | null>(null)
  const [leadNote, setLeadNote] = useState<string | null>(null)
  const [meta, setMeta] = useState<AdRowsSnapshot<MetaAdDailyRow> | null>(null)
  const [daangn, setDaangn] = useState<AdRowsSnapshot<DaangnDailyRow> | null>(null)

  useEffect(() => {
    void fetchMetaAdRows().then(setMeta)
    void fetchDaangnRows().then(setDaangn)
    callLeadsApi<LeadListResponse>({ action: 'leads' })
      .then((r) => {
        if (r.ok) setLeads(r.leads)
        else {
          setLeads([])
          setLeadNote('leads 테이블이 아직 없어 신청 수는 0으로 보여요.')
        }
      })
      .catch((err: unknown) => {
        setLeads([])
        setLeadNote(`신청 데이터를 못 불러왔어요: ${err instanceof Error ? err.message : String(err)}`)
      })
  }, [])

  const report = useMemo(() => {
    if (!leads || !meta || !daangn) return null
    return buildAdFunnelReport({ leads, metaRows: meta.rows, daangnRows: daangn.rows, days, todayKst: kstToday() })
  }, [leads, meta, daangn, days])

  const totals = useMemo(() => {
    if (!report) return null
    // 비용 데이터가 있는 유료 채널끼리만 합친다(스레드·인스타 같은 무료 유입까지 섞으면 신청당 비용·ROAS가 부풀려짐).
    const paid = report.channels.filter((c) => c.spend !== null)
    if (paid.length === 0) return null
    const sumOf = (pick: (c: (typeof paid)[number]) => number) => paid.reduce((s, c) => s + pick(c), 0)
    return {
      impressions: sumOf((c) => c.impressions ?? 0),
      clicks: sumOf((c) => c.clicks ?? 0),
      spend: sumOf((c) => c.spend ?? 0),
      leads: sumOf((c) => c.leads),
      calls: sumOf((c) => c.calls),
      purchases: sumOf((c) => c.purchases),
      revenue: sumOf((c) => c.revenue),
    } satisfies FunnelStats
  }, [report])

  return (
    <section className="card p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-bold text-[var(--text)]">📣 업메리 — 광고 (채널별 퍼널·비용 대비 성과)</p>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDays(p)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] font-bold transition ${
                days === p ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--border)]'
              }`}
            >
              {p}일
            </button>
          ))}
        </div>
      </div>

      {!report ? (
        <p className="py-3 text-center text-[12px] text-[var(--text-faint)]">불러오는 중…</p>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-[var(--text-faint)]">
            기간 {report.from} ~ {report.to}(어제까지) · 어제 메타 비용 <b className="text-[var(--text)]">{won(report.yesterdayMetaSpend)}</b> ·
            메타 수집 {kstStamp(meta?.createdAt ?? null)} · 당근 CSV {daangn && daangn.rows.length > 0 ? `${daangn.rows[0].date}~${daangn.rows[daangn.rows.length - 1].date}` : '없음(설정에서 올리기)'}
          </p>
          {leadNote && <p className="mb-2 text-[11.5px] font-bold text-[var(--down)]">{leadNote}</p>}

          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10.5px] text-[var(--text-faint)]">
                  <th className={`${TH} text-left`}>채널</th>
                  {STAT_HEADERS.map((h) => (
                    <th key={h} className={`${TH} text-right`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.channels.map((c) => (
                  <tr key={c.channel} className="border-t border-[var(--border)]">
                    <td className={`${TD} text-[var(--text)]`}>
                      {AD_CHANNEL_LABEL[c.channel]}
                      {c.metaLeads !== undefined && <span className="ml-1 text-[10.5px] text-[var(--text-faint)]">(메타 집계 리드 {c.metaLeads})</span>}
                    </td>
                    <StatCells s={c} />
                  </tr>
                ))}
                {totals && (
                  <tr className="border-t-2 border-[var(--border)] font-bold">
                    <td className={`${TD} text-[var(--text)]`}>유료 광고 합계</td>
                    <StatCells s={totals} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="mb-1 mt-4 text-[12px] font-extrabold text-[var(--text)]">메타 광고별</p>
          {report.ads.length === 0 ? (
            <p className="py-2 text-[12px] text-[var(--text-faint)]">
              {meta && meta.rows.length > 0 ? '이 기간에 집행된 메타 광고가 없어요.' : '아직 메타 광고 데이터가 없어요(META_AD_ACCOUNT_ID·META_ACCESS_TOKEN 설정 후 다음 07:50부터).'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[10.5px] text-[var(--text-faint)]">
                    <th className={`${TH} text-left`}>광고 (캠페인)</th>
                    {STAT_HEADERS.map((h) => (
                      <th key={h} className={`${TH} text-right`}>{h}</th>
                    ))}
                    <th className={`${TH} text-right`}>메타 리드</th>
                  </tr>
                </thead>
                <tbody>
                  {report.ads.map((a) => (
                    <tr key={a.adId} className="border-t border-[var(--border)]">
                      <td className="max-w-[240px] py-1.5 pr-3 text-[var(--text)]">
                        <div className="truncate font-semibold" title={a.adName}>{a.adName || a.adId}</div>
                        <div className="truncate text-[10.5px] text-[var(--text-faint)]" title={a.campaignName}>{a.campaignName}</div>
                      </td>
                      <StatCells s={a} />
                      <td className={`${TD} text-right text-[var(--text-dim)]`}>{a.metaLeads ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {report.unmatchedMetaLeads > 0 && (
            <p className="mt-1 text-[11px] text-[var(--text-faint)]">
              광고를 특정 못 한 메타 신청 {report.unmatchedMetaLeads}건 — 메타 광고 "URL 매개변수"에
              utm_content={'{{ad.id}}'} 를 넣으면 광고별로 나뉘어요.
            </p>
          )}
        </>
      )}
    </section>
  )
}
