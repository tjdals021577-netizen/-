const STORAGE_KEY = 'ai-ops:daily-spend'
export const DAILY_BUDGET_USD = 5

// Sonnet 5 도입가($2/$10 per MTok, 2026-08-31까지). 이후 정식가로 바뀌면 여기만 수정.
const INPUT_USD_PER_MTOK = 2
const OUTPUT_USD_PER_MTOK = 10

function todayKey(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function readStore(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export function estimateCostUsd(usage: {
  input_tokens: number
  output_tokens: number
}): number {
  return (
    (usage.input_tokens / 1_000_000) * INPUT_USD_PER_MTOK +
    (usage.output_tokens / 1_000_000) * OUTPUT_USD_PER_MTOK
  )
}

export function getTodaySpendUsd(): number {
  return readStore()[todayKey()] ?? 0
}

export function isOverDailyBudget(): boolean {
  return getTodaySpendUsd() >= DAILY_BUDGET_USD
}

export function recordSpendUsd(usd: number): void {
  const store = readStore()
  const key = todayKey()
  store[key] = (store[key] ?? 0) + usd
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // localStorage 사용 불가 시(사생활 보호 모드 등) 조용히 무시 — 예산 가드는 best-effort
  }
}
