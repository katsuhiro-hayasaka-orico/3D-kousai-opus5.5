#!/usr/bin/env bash
# 最終品質の一括実行：検証 → ライトマップ＋室内 HDR → 全静止画・パノラマ。
# 所要時間の目安とショットの一覧は blender/README.md。ログは blender/out/*.log。
#   bash blender/run_final.sh            # すべて
#   bash blender/run_final.sh bake       # ベイクだけ
#   bash blender/run_final.sh render     # レンダーだけ
#   bash blender/run_final.sh resume     # レンダーの続き（renders.json で final になっていないショットだけ）
set -euo pipefail
cd "$(dirname "$0")/.."
PY=.venv-blender/bin/python
mkdir -p blender/out
what="${1:-all}"

step() {
  local name="$1"
  shift
  local t0=$SECONDS
  echo "== ${name} 開始 $(date '+%F %T')"
  "$PY" "$@" 2>&1 | tee "blender/out/${name}.log"
  echo "== ${name} 完了 $((SECONDS - t0)) 秒"
}

if [[ "$what" == all || "$what" == bake ]]; then
  step verify blender/verify.py
  step bake_final blender/bake_lightmaps.py --quality final
fi
if [[ "$what" == all || "$what" == render ]]; then
  step render_final blender/render.py --shots all --quality final
fi
if [[ "$what" == resume ]]; then
  step render_resume blender/render.py --shots remaining --quality final
fi
