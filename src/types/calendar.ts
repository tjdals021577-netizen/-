import type { Brand } from './brand.js'

export type CalendarStatus = 'planned' | 'done' | 'open'

export type CalendarChannel = 'blog' | 'thread' | 'youtube' | 'agency' | 'etc'

export interface CalendarEntry {
  id: string
  date: string // YYYY-MM-DD
  brand: Brand
  channel: CalendarChannel
  title: string
  status: CalendarStatus
  note: string
  contentHtml?: string
  createdAt: string
  sourceWorkLogId?: string
}
