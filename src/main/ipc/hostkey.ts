import { CH } from '@shared/ipc'
import { hostKeyDecisionSchema } from '@shared/schema'
import type { AppContext } from '../context'
import { handle } from './index'

export function registerHostKeyIpc(ctx: AppContext): void {
  handle(ctx, CH.hostkeyDecision, hostKeyDecisionSchema, ({ challengeId, accept }) => {
    ctx.hostKeys.decide(challengeId, accept)
  })
}
