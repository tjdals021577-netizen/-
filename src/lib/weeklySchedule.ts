import type { Brand } from '../types/brand.js'
import type { CalendarChannel } from '../types/calendar.js'

export interface ScheduledSlot {
  brand: Brand
  channel: CalendarChannel
}

// 대표님이 정한 주간 고정 업로드 루틴.
// 유튜브(마잘남만 — 업메리는 유튜브 채널 없음): 월·수·금, 주 3편
// 블로그(업메리+마잘남 둘 다): 화·목·토·일, 브랜드당 주 4편
// 스레드는 이 스케줄에 없음 — 대표님이 직접 관리(기존 수동/대행 자동생성만 유지).
// Date.getDay(): 0=일 1=월 2=화 3=수 4=목 5=금 6=토
const WEEKLY_SCHEDULE: Record<number, ScheduledSlot[]> = {
  0: [{ brand: '업메리', channel: 'blog' }, { brand: '마잘남', channel: 'blog' }],
  1: [{ brand: '마잘남', channel: 'youtube' }],
  2: [{ brand: '업메리', channel: 'blog' }, { brand: '마잘남', channel: 'blog' }],
  3: [{ brand: '마잘남', channel: 'youtube' }],
  4: [{ brand: '업메리', channel: 'blog' }, { brand: '마잘남', channel: 'blog' }],
  5: [{ brand: '마잘남', channel: 'youtube' }],
  6: [{ brand: '업메리', channel: 'blog' }, { brand: '마잘남', channel: 'blog' }],
}

export function getScheduledSlots(date: Date): ScheduledSlot[] {
  return WEEKLY_SCHEDULE[date.getDay()] ?? []
}

const WEEKDAY_LABEL_KO = ['일', '월', '화', '수', '목', '금', '토']

export function kstWeekdayLabel(date: Date): string {
  return WEEKDAY_LABEL_KO[date.getDay()]
}

// 크론/모닝 브리핑은 전부 KST 기준으로 "오늘"을 계산해야 한다(서버는 UTC라
// new Date()를 그대로 쓰면 자정 근처에 날짜가 하루 밀리는 문제가 실제로 있었음).
export function kstNow(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
}

export function kstDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDaysKst(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}
