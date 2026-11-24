import { useState } from 'react'

export function useDrawerSession(): {
  session: number
  open: boolean
  show: () => void
  close: () => void
} {
  const [drawer, setDrawer] = useState({ session: 0, open: false })

  const show = (): void => {
    setDrawer((current) => ({ session: current.session + 1, open: true }))
  }

  const close = (): void => {
    setDrawer((current) =>
      current.session === drawer.session ? { ...current, open: false } : current
    )
  }

  return { ...drawer, show, close }
}
