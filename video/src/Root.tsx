import React from 'react'
import { Composition } from 'remotion'
import { Promo, TOTAL } from './Promo'
import { Modes, MODES_TOTAL } from './Modes'
import { SS_H, SS_TOTAL, SS_W, SSReport } from './SSReport'
import { FPS, H, W } from './theme'

export function Root() {
  return (
    <>
      <Composition id="Promo" component={Promo} durationInFrames={TOTAL} fps={FPS} width={W} height={H} />
      <Composition id="Modes" component={Modes} durationInFrames={MODES_TOTAL} fps={FPS} width={W} height={H} />
      {/* SS（NPO）の月1回の報告。材料は node scripts/ss-prep.mjs で video/public/private/ に作る（git に入れない） */}
      <Composition id="SSReport" component={SSReport} durationInFrames={SS_TOTAL} fps={FPS} width={SS_W} height={SS_H} />
    </>
  )
}
