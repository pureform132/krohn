import { withInkSuspended } from '@krohn/ink'

import { t } from '../../../i18n/runtime.js'
import { launchKROHNCommand } from '../../../lib/externalCli.js'
import { runExternalSetup } from '../../setupHandoff.js'
import type { SlashCommand } from '../types.js'

export const setupCommands: SlashCommand[] = [
  {
    help: 'run full setup wizard (launches `krohn setup`)',
    name: 'setup',
    run: (arg, ctx) =>
      void runExternalSetup({
        args: ['setup', ...arg.split(/\s+/).filter(Boolean)],
        ctx,
        done: t('slashCmd.setup.setup.done'),
        launcher: launchKROHNCommand,
        suspend: withInkSuspended
      })
  }
]
