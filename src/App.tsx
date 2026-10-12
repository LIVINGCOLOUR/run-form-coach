import { useCallback, useEffect, useState } from 'react'
import type { Session } from './core/types'
import { loadSessions } from './core/storage'
import { Home } from './screens/Home'
import { Live } from './modes/camera/screens/Live'
import { Result } from './screens/Result'
import { Posture } from './modes/camera/screens/Posture'
import { Slow } from './modes/camera/screens/Slow'
import { PhoneLive } from './modes/phone/screens/PhoneLive'
import { PhoneResult } from './modes/phone/screens/PhoneResult'
import { loadPhoneSessions } from './modes/phone/storage'
import type { PhoneSession, PhoneWhere } from './modes/phone/session'
import type { LocationPermission } from './modes/phone/sensor'

export type Screen = { name: 'home' } | { name: 'live'; video?: File } | { name: 'result'; id: string } | { name: 'posture'; id: string } | { name: 'slow'; video: File }
  // スマホ版（腰）。where：外（GPS の速さで判定を止める）かトレッドミル（実機テスト。速さは一定とみなす）。
  // location：外のとき、位置情報を許可されたか。sim は模擬データで試す速さ（倍。模擬データは速さ一定なのでトレッドミル扱い）
  | { name: 'phone'; where: PhoneWhere; location?: LocationPermission; sim?: number }
  | { name: 'phoneResult'; id: string }

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [sessions, setSessions] = useState<Session[]>([])
  const [phoneSessions, setPhoneSessions] = useState<PhoneSession[]>([])

  const reload = useCallback(async () => {
    try {
      setSessions(await loadSessions())
    } catch {
      setSessions([])
    }
    try {
      setPhoneSessions(await loadPhoneSessions())
    } catch {
      setPhoneSessions([])
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const find = (id: string) => sessions.find((s) => s.id === id)

  switch (screen.name) {
    case 'home':
      return <Home sessions={sessions} phoneSessions={phoneSessions} go={setScreen} />
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
      return s ? <Result session={s} sessions={sessions} go={setScreen} /> : <Home sessions={sessions} phoneSessions={phoneSessions} go={setScreen} />
    }
    case 'phone':
      return (
        <PhoneLive
          sim={screen.sim}
          where={screen.where}
          location={screen.location}
          onDone={async (id) => {
            await reload()
            setScreen(id ? { name: 'phoneResult', id } : { name: 'home' })
          }}
        />
      )
    case 'phoneResult': {
      const s = phoneSessions.find((x) => x.id === screen.id)
      return s ? <PhoneResult session={s} sessions={phoneSessions} onHome={() => setScreen({ name: 'home' })} /> : <Home sessions={sessions} phoneSessions={phoneSessions} go={setScreen} />
    }
    case 'slow':
      return <Slow video={screen.video} go={setScreen} />
    case 'posture': {
      const s = find(screen.id)
      return s ? <Posture session={s} sessions={sessions} go={setScreen} /> : <Home sessions={sessions} phoneSessions={phoneSessions} go={setScreen} />
    }
  }
}
