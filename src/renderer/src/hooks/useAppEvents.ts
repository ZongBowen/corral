import { useEffect } from 'react'
import type { AppNotice } from '@shared/types'
import { useRunStreamStore } from '../stores/runStreamStore'
import { useHostKeyStore } from '../stores/hostKeyStore'
import { useRunsStore } from '../stores/runsStore'
import { useEnvsStore } from '../stores/envsStore'

type Notify = (notice: AppNotice) => void

export function useAppEvents(notify: Notify): void {
  useEffect(() => {
    const stream = useRunStreamStore.getState()
    const unsubscribers = [
      window.api.events.onRunOutput((event) => {
        stream.output(event)
      }),
      window.api.events.onRunStatus((event) => {
        stream.setStatus(event.runId, event.status, {
          exitCode: event.exitCode,
          errorMessage: event.errorMessage,
          durationMs: event.durationMs
        })
      }),
      window.api.events.onRunProgress((progress) => {
        stream.setProgress(progress)
      }),
      window.api.events.onRunDone((run) => {
        stream.setDone(run)
        void useRunsStore.getState().load()
        void useEnvsStore.getState().load(true)
      }),
      window.api.events.onHostKeyChallenge((challenge) => {
        useHostKeyStore.getState().setChallenge(challenge)
      }),
      window.api.events.onAppNotice((notice) => {
        notify(notice)
      })
    ]
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [notify])
}
