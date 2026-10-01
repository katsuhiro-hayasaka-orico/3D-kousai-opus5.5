# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

麹町弘済ビルディング 2 階（オリエントコーポレーション IT・システムグループ／リスク管理グループ）を実寸で再現した three.js（r180）＋ TypeScript ＋ Vite の 3D ビューア。実図面は非公開のため、**公開情報に合わせた寸法と推定・想定を区別すること**が前提（README の「再現の考え方」表と `src/about.ts` の「出典・前提」モーダル、`src/data/spec.ts` のコメントで「公開／推定」を明示している）。社名は文字のみで、ロゴは使わない。ユーザーへの応答・ドキュメント・コメントは日本語。

## コマンド

```bash
npm install
npm run dev                 # http://localhost:5173
npm run typecheck           # tsc --noEmit（strict・noUnusedLocals/Parameters：未使用変数でビルドが落ちる）
npm run build               # dist/
npm run build:standalone    # dist-standalone/index.html（three.js ごと 1 ファイルに同梱）
npm run build:docs          # 上記を docs/index.html にコピー（コミット対象の配布物）
```

テストフレームワークはない。検証は型チェックと、ヘッドレス Chromium による撮影で行う。

```bash
# dev サーバー起動中に。steps は eval / click / key(+hold) / wait / shot（.jpg なら JPEG）/ text
node scripts/shoot.mjs http://localhost:5173/ shots '[{"eval":"__app.goPreset(\"SOC\")","wait":1000,"shot":"soc"}]'
```

- Chromium は `CHROME_PATH`、未指定なら `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`（SwiftShader でソフトウェア WebGL。初回ロードは約 10 秒）。
- `window.__app`（`src/main.ts` 末尾）が撮影・書き出し用のフック：`setMode`、`goPreset(名前)`、`presets()`、`toggle(キー, bool)`（キーは UI の表示レイヤー：furniture / people / labels / ceiling / zones / ac / wifi / evac / grid / context / upper / gi。LayerKey ではない。外構は context、上階・周辺は upper）、`setSun(時)`、`setQuality('high'|'standard'|'low')`、`setGIGain`、`debugView`、`openGallery`／`openPano`／`closePano`、`stats()`、`info()`（renderer.info）、`pick`、`lightmapInfo()`、`cityHidden()`、`view(pos, target)`（外観・俯瞰のカメラを任意位置へ）、`gfx()`、`exportScene()`。
- 撮影結果は Read ツールで画像を見て確認する（`shots/` は gitignore 済み）。Blender のベイク・レンダー中は CPU が埋まるので、`nice` を付け、`W=1100 H=680` 程度に小さくして撮る。
- URL に `?lmdebug=1` を付けると、ライトマップの代わりに UV 検証用の合成画像（室の輪郭・グリッド・壁面の向き）を貼る。

## アーキテクチャ

### 座標系・単位
three.js 座標は **x = 東、y = 上、z = 南（北は -z）**、単位は m。原点は 2F プレート中心、**y = 0 は 2F の OA 床仕上げ面**。天井高 2.8、地盤（1F 床）は y = -5.6、基準階高 4.5（`src/data/spec.ts`）。平面は 3.2 m モジュール、外形 76.8×38.4 m、北側に寄せたコア 32.0×22.4 m。

### データ → 生成 → 描画
- `src/data/` が唯一の形状データ源。
  - `spec.ts`：建物寸法。
  - `rooms.ts`：全室の矩形 `[x0,z0,x1,z1]`（z0 が北）、各辺の壁種、扉（種類・中心座標・開き勝手・カードリーダー）、席数、設備。専有部の矩形は重なりなく敷き詰めてあり、面積集計にそのまま使う。
  - `presets.ts`：視点プリセット（walk は `[x, z, yaw, pitch]`、yaw = 0 で北向き）。
- **壁は手書きしない**。`src/build/walls.ts` が室の辺から壁を集め、同一線上の重なりを壁種の優先度（RC > LGS > 可動 > フィルム > ガラス > 腰壁）で統合し、扉位置を開口として切り欠いて扉・枠・欄間を生成する。間取りの変更は `rooms.ts` の矩形・壁種・扉を編集する。
- `src/build/` の各モジュールが生成を担う。
  - `shell.ts`：床・柱・カーテンウォール・バルコニー・外構・周辺街区（`CITY_BLOCKS`、箱ごとに別メッシュ）。
  - `upper.ts`：外観用の上階 3F〜12F（2F の躯体・軒・天井と照明、主な家具を InstancedMesh で積む。人物・小物なし）と屋上。Blender へは書き出さない（Blender 側で独自に積む）。
  - `layout.ts`：家具・人物の配置。
  - `ceiling.ts`：天井設備（壁との干渉を自動回避）。
  - `overlays.ts`：分析オーバーレイ。
  - `protos.ts`：家具・人物のプロトタイプ。
- `src/world.ts` がレイヤー（`LayerKey`：structure / furniture / people / ceiling / eaves / site / upper（周辺街区）/ floors（上階・屋上）/ zones …）ごとの Group を組み立て、集計値（`world.stats`）を返す。`src/main.ts` はモード（俯瞰／平面図／ウォークスルー／外観）、UI、ピック、ループ、`__app` を担当する。
- `src/gfx/`：描画の強化。`lightmaps.ts`（ベイク GI の適用。上階の複製にも同じマテリアルを当てる）、`post.ts`（EffectComposer：MSAA・GTAO・選択的 Bloom・Neutral トーンマッピング・SMAA、画質 高／標準／軽量）、`bloom.ts`、`sky.ts`（Sky シェーダ＋PMREM）、`environment.ts`（モード別の背景・IBL・半球光）、`clearance.ts`（外観で建物を遮る街区を隠す）、`device.ts`。
- `src/ui/gallery.ts`・`pano.ts`・`renders.ts`：Blender レンダーのギャラリーと 360° ビューア（`src/assets/renders/renders.json` を読む）。

### 描画の仕組み（`src/core/`）
- `PB`（パーツビルダー、`geom.ts`）でジオメトリ＋**マテリアルキー**＋行列のパーツを組み立てる。
  - 静的物は `buildStatic` で**マテリアルごとに 1 メッシュへマージ**する。
  - 家具・人物は `Instancer`（`instancer.ts`）でプロトタイプをマテリアル単位にマージし、InstancedMesh にする（1 プロト × 1 マテリアル = 1 ドローコール）。
- マテリアルは `materials.ts` のキー（`M('floor.carpetIT')` など）で共有する。`userData.tintable` のマテリアルは instanceColor で色替えし（人物の肌・髪・服、葉）、`defaultTint` を持つ。
- **マテリアルのテクスチャは Canvas で手続き生成**（`textures.ts`：床材・画面・サイン・ロッカー面・周辺街区の外装など）。Blender の生成物（`src/assets/baked/` のライトマップ・HDR、`src/assets/renders/` の JPEG）は `import.meta.glob` で読み込む。単一 HTML になるのは standalone ビルド（`vite.config.ts` の viteSingleFile と assetsInlineLimit）が data URI で埋め込むため。
- プロトタイプの向きの規約：**人と椅子はローカル -z を向き（背もたれは +z）、画面・機器・収納の正面は +z**。机に対する席の配置は `Layout.deskSeat` / `island` / `tf()` を参照。
- 乱数は `Rng`（固定シード）のみを使う。在席・小物・服の色は毎回同じになる。
- ピック情報は Instancer の各インスタンスの `pick` に持たせ、`Instancer.pickOf` で引く。歩行モードの衝突は壁線分（`wallColliders`）＋家具・柱の AABB（`layout.obstacles`）で判定する。

### ライトマップ UV と Blender 連携
契約（ファイル名・UV の向き・単位・JSON 形式）は **`docs/GRAPHICS-PIPELINE.md`** にまとめてある。
- `src/core/lightmap.ts` がライトマップ用の `uv1` を決定論的に生成する。
  - floor / ceil：XZ 平面投影。
  - wall：壁・柱のボックス面チャートをシェルフパッキング。
  - v は画像上端が 0 なので、three.js では `flipY = false` で読む。
- 対象外の面は各アトラスの予約（dummy）ブロックに縮退させる。レイアウトから `world.lightmap.hash` を計算し、ベイク画像の `lightmaps.json` の hash と一致したときだけ適用する。**ジオメトリ（床・天井・壁）を変えると hash が変わり、再ベイクが必要になる。**
- `scripts/export-scene.mjs`（dev サーバー起動中に実行）が `__app.exportScene()` を呼び、`blender/cache/scene.glb` と `meta.json` を書き出す。
  - InstancedMesh は EXT_mesh_gpu_instancing で書き出す。
  - Blender はインスタンス色を読まないため、色ごとに派生マテリアル「キー#rrggbb」を作って分割する。
  - Vite が新しい依存（動的 import）を検出すると初回はページがリロードされ失敗するので、そのときは再実行する。
- Blender は PyPI の `bpy`（4.5 LTS）を `.venv-blender`（gitignore 済み）で使う（Cycles CPU・OIDN・Nishita 空）。
  ```bash
  uv venv --python 3.11 .venv-blender && uv pip install --python .venv-blender/bin/python bpy==4.5.14 Pillow
  ```
  glTF 読み込み後の Blender 座標は (x, -z, y) になる。生成物の出力先は `src/assets/baked/`（ライトマップ・環境 HDR）と `src/assets/renders/`（Cycles 静止画・360°パノラマの Web 用縮小版）、final の原寸は `docs/renders/`。
  ```bash
  .venv-blender/bin/python blender/verify.py                               # シーン構築・UV・太陽方位などの検証
  .venv-blender/bin/python blender/bake_lightmaps.py --quality preview     # ライトマップ＋室内 HDR（数分）
  .venv-blender/bin/python blender/render.py --shots it-south,soc --quality preview   # --list で一覧
  .venv-blender/bin/python blender/render.py --resave                      # 中間 PNG から JPEG を作り直す
  bash blender/run_final.sh [all|bake|render|resume]                       # 最終品質（数時間。resume は未完成のショットだけ。ログは blender/out/）
  ```
  詳細（照明の校正、材質規則、所要時間）は `blender/README.md`。

## 変更時の注意

- README の「主な数値」と「室一覧」はモデルの集計値（`__app.stats()`）と一致させている。間取り・家具を変えたら確認して更新する。
- `docs/index.html`（単一 HTML の配布物）と `docs/images/`（README 用スクリーンショット）はコミットしている生成物。見た目を変えたら `npm run build:docs` と撮影をやり直す。
- 生成物・作業物は gitignore 済み：`dist/`、`dist-standalone/`、`shots/`、`blender/cache/`、`blender/out/`。
- ベイク・レンダーは `blender/cache/scene.glb` を入力にする。床・天井・壁のジオメトリを変えたら書き出し → 再ベイクが必要（hash 不一致だとブラウザはライトマップを使わない）。家具・照明器具を変えたらレンダーのやり直しが必要。
- 周辺街区のマテリアル名 `ghost.city` と glTF の最上位ノード名（`L_*`）は Blender 側が参照する契約なので変えない。
