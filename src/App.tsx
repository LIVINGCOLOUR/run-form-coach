import { useCallback, useEffect, useState } from 'react'
import type { Session } from './core/types'
import { loadSessions } from './core/storage'
import { Home } from './screens/Home'
import { Live } from './screens/Live'
import { Result } from './screens/Result'
import { Posture } from './screens/Posture'
import { Slow } from './screens/Slow'

export type Screen = { name: 'home' } | { name: 'live'; video?: File } | { name: 'result'; id: string } | { name: 'posture'; id: string } | { name: 'slow'; video: File }

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [sessions, setSessions] = useState<Session[]>([])

  const reload = useCallback(async () => {
    try {
      setSessions(await loadSessions())
    } catch {
      setSessions([])
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const find = (id: string) => sessions.find((s) => s.id === id)

  switch (screen.name) {
    case 'home':
      return <Home sessions={sessions} go={setScreen} />
    case 'live':
      return (
        <Live
          video={screen.video}
          onDone={async (id) => {
            await reload()
            setScreen(id ? { name: 'result', id } : { name: 'home' })
          }}
        />
      )
    case 'result': {
      const s = find(screen.id)
      return s ? <Result session={s} sessions={sessions} go={setScreen} /> : <Home sessions={sessions} go={setScreen} />
    }
    case 'slow':
      return <Slow video={screen.video} go={setScreen} />
    case 'posture': {
      const s = find(screen.id)
      return s ? <Posture session={s} sessions={sessions} go={setScreen} /> : <Home sessions={sessions} go={setScreen} />
    }
  }
}
