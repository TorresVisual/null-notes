import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Options } from '@wdio/types'
import { fixtureWorkspace } from './fixtureWorkspace.js'

const here = dirname(fileURLToPath(import.meta.url))
const appBinaryPath = resolve(here, '../src-tauri/target/debug/null-notes.exe')

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./specs/**/*.e2e.ts'],
  maxInstances: 1,
  maxInstancesPerCapability: 1,

  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath,
        appArgs: [`--workspace=${fixtureWorkspace}`],
        driverProvider: 'official',
        autoInstallTauriDriver: true,
        autoDownloadEdgeDriver: true,
        // This suite never uses Tauri command mocking; skipping the service's
        // default per-session mock bookkeeping avoids an unnecessary script
        // injection round trip through the WebView on every command.
        clearMocks: false,
        resetMocks: false,
        restoreMocks: false,
      },
    ],
  ],

  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: appBinaryPath,
        args: [`--workspace=${fixtureWorkspace}`],
      },
    },
  ],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
    // @wdio/tauri-service's official driverProvider has occasional per-command
    // timing flakiness in this environment (~1 in 8 runs observed) unrelated
    // to app behavior. One retry absorbs that without masking a real failure
    // — a genuinely broken feature fails on the retry too.
    retries: 1,
  },

  reporters: ['spec'],
}
