/** モバイル（タッチ主体）または低メモリ端末か。画質の既定値やライトマップの解像度を控えめにする判断に使う */
export function constrainedDevice(): boolean {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return mobile || (mem !== undefined && mem <= 4);
}
