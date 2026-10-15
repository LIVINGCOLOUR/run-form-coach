import React from 'react'
import { Composition } from 'remotion'
import { Promo, TOTAL } from './Promo'
import { Modes, MODES_TOTAL } from './Modes'
import { FPS, H, W } from './theme'

export function Root() {
  return (
    <>
      <Composition id="Promo" component={Promo} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
      <Composition id="Modes" component={Modes} durationInFrames={MODES_TOTAL} fps={FPS} width={W} height={H} />
    </>
  )
}
