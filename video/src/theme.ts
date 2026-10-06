import { loadFont as loadZen } from '@remotion/google-fonts/ZenKakuGothicNew'
import { loadFont as loadBarlow } from '@remotion/google-fonts/BarlowCondensed'

export const jp = loadZen('normal', { weights: ['500', '700', '900'], subsets: ['japanese', 'latin'], ignoreTooManyRequestsWarning: true }).fontFamily
export const num = loadBarlow('normal', { weights: ['600', '700'] }).fontFamily

export const C = {
  bg: '#0A0C0E',
  stage: '#101316',
  line: '#262C33',
  grid: '#161B20',
  text: '#F2F4F5',
  muted: '#9AA3AD',
  faint: '#6B7480',
  accent: '#C8F03C',
  warn: '#FF8A3D',
  limb: '#4A535D',
  limbBack: '#2E353D',
}

export const FPS = 30
export const W = 1080
export const H = 1920
