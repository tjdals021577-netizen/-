import { useState } from 'react'
import { AppShell } from './components/AppShell'
import { PasswordGate } from './components/PasswordGate'
import { isUnlocked } from './lib/appPassword'

export default function App() {
  const [unlocked, setUnlocked] = useState(() => isUnlocked())

  if (!unlocked) {
    return <PasswordGate onUnlock={() => setUnlocked(true)} />
  }
  return <AppShell />
}
