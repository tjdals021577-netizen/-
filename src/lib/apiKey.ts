const STORAGE_KEY = 'ai-editing-committee:anthropic-api-key'

export function getStoredApiKey(): string {
  return localStorage.getItem(STORAGE_KEY) ?? ''
}

export function setStoredApiKey(key: string): void {
  if (key.trim() === '') {
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  localStorage.setItem(STORAGE_KEY, key.trim())
}
