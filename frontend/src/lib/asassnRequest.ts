export const ASASSN_SKY_PATROL_URL = 'https://asas-sn.osu.edu/'

export interface AsassnRequest {
  url: string
  clipboardText: string
  guidance: string
}

export function buildAsassnRequest(ra: number, dec: number): AsassnRequest {
  if (!Number.isFinite(ra) || ra < 0 || ra >= 360) {
    throw new Error('right ascension must be between 0 and 360 degrees')
  }
  if (!Number.isFinite(dec) || dec < -90 || dec > 90) {
    throw new Error('declination must be between -90 and 90 degrees')
  }
  return {
    url: ASASSN_SKY_PATROL_URL,
    clipboardText: `RA: ${ra}\nDec: ${dec}`,
    guidance:
      '已复制 RA/Dec；请设置 30 天并选择 Image Subtraction Photometry (No reference flux added)，完成人机验证后点击 Compute。',
  }
}
