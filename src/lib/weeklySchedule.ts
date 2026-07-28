import type { Brand } from '../types/brand.js'
import type { CalendarChannel } from '../types/calendar.js'

export interface ScheduledSlot {
  brand: Brand
  channel: CalendarChannel
}

// 대표님이 정한 주간 고정 업로드 루틴.
// 블로그(업메리+마잘남 둘 다): "매일" 브랜드당 1편(주 7편씩) — 대표님 결정.
// 유튜브(마잘남만 — 업메리는 유튜브 채널 없음): 월·수·금, 주 3편(유지).
// 스레드는 이 스케줄에 없음 — 대표님이 직접 관리(기존 수동/대행 자동생성만 유지).
// Date.getDay(): 0=일 1=월 2=화 3=수 4=목 5=금 6=토
const BLOG_EVERYDAY: ScheduledSlot[] = [
  { brand: '업메리', channel: 'blog' },
  { brand: '마잘남', channel: 'blog' },
]
const MAJALNAM_YT: ScheduledSlot = { brand: '마잘남', channel: 'youtube' }
const WEEKLY_SCHEDULE: Record<number, ScheduledSlot[]> = {
  0: [...BLOG_EVERYDAY], // 일
  1: [...BLOG_EVERYDAY, MAJALNAM_YT], // 월
  2: [...BLOG_EVERYDAY], // 화
  3: [...BLOG_EVERYDAY, MAJALNAM_YT], // 수
  4: [...BLOG_EVERYDAY], // 목
  5: [...BLOG_EVERYDAY, MAJALNAM_YT], // 금
  6: [...BLOG_EVERYDAY], // 토
}

// 이 파일의 모든 함수는 "실행 환경의 로컬 타임존이 UTC"라고 가정하고
// kstNow()에서 +9시간을 더한 뒤, 그 결과를 UTC 게터(getUTCDay/getUTCDate 등)로
// 읽는 방식으로 KST를 흉내낸다(서버 크론은 실제로 UTC라 이게 맞는다). 로컬
// 게터(getDay/getDate, 로컬 타임존에 따라 달라짐)를 쓰면, 브라우저처럼 로컬
// 타임존이 이미 Asia/Seoul(KST)인 환경에서는 +9시간이 중복 적용돼 요일이
// 통째로 밀리는 문제가 실제로 있었다(예: 화요일이 수요일로 표시됨) — 그래서
// 이 파일 안에서는 항상 getUTC* 게터만 쓴다.
export function getScheduledSlots(date: Date): ScheduledSlot[] {
  return WEEKLY_SCHEDULE[date.getUTCDay()] ?? []
}

const WEEKDAY_LABEL_KO = ['일', '월', '화', '수', '목', '금', '토']

export function kstWeekdayLabel(date: Date): string {
  return WEEKDAY_LABEL_KO[date.getUTCDay()]
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
