import { useEffect, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { useUpdateStore } from '../store/update'

const STATUS_TEXT = {
  current: "You're up to date.",
  unsupported: 'Updates are only available in installed release builds.',
  error: "Couldn't reach the update server.",
}

export function AboutSettings() {
  const [version, setVersion] = useState<string | null>(null)
  const [status, setStatus] = useState<keyof typeof STATUS_TEXT | null>(null)
  const update = useUpdateStore((s) => s.update)
  const checking = useUpdateStore((s) => s.checking)
  const checkForUpdate = useUpdateStore((s) => s.checkForUpdate)
  const openDialog = useUpdateStore((s) => s.openDialog)

  useEffect(() => {
    getVersion().then(setVersion, () => setVersion(null))
  }, [])

  async function checkNow() {
    const result = await checkForUpdate()
    setStatus(result === 'available' ? null : result)
  }

  return (
    <div className="settings-card">
      <div className="settings-row">
        <span>
          Null Notes{version && ` v${version}`}
          <small>{update ? `v${update.version} is available.` : (status && STATUS_TEXT[status]) || ' '}</small>
        </span>
        <span className="settings-row-control">
          {update ? (
            <button className="dialog-action" onClick={openDialog}>
              Install v{update.version}
            </button>
          ) : (
            <button className="dialog-action" onClick={() => void checkNow()} disabled={checking}>
              {checking ? 'Checking…' : 'Check for updates'}
            </button>
          )}
        </span>
      </div>
    </div>
  )
}
