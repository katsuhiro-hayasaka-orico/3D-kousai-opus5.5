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
- `window.__app`（`src/main.ts` 末尾）が撮影・書き出し用のフック：`setMode`、`goPreset(名前)`、`toggle(レイヤー, bool)`、`setSun(時)`、`stats()`、`info()`（renderer.info）、`pick`、`lightmapInfo()`、`exportScene()`。
- 撮影結果は Read ツールで画像を見て確認する（`shots/` は gitignore 済み）。

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
  - `shell.ts`：床・柱・カーテンウォール・バルコニー・外構・他階ゴースト。
  - `layout.ts`：家具・人物の配置。
  - `ceiling.ts`：天井設備（壁との干渉を自動回避）。
  - `overlays.ts`：分析オーバーレイ。
  - `protos.ts`：家具・人物のプロトタイプ。
- `src/world.ts` がレイヤー（`LayerKey`：structure / furniture / people / ceiling / eaves / site / upper / zones …）ごとの Group を組み立て、集計値（`world.stats`）を返す。`src/main.ts` はモード（俯瞰／平面図／ウォークスルー／外観）、UI、ピック、ループ、`__app` を担当する。

### 描画の仕組み（`src/core/`）
- `PB`（パーツビルダー、`geom.ts`）でジオメトリ＋**マテリアルキー**＋行列のパーツを組み立てる。
  - 静的物は `buildStatic` で**マテリアルごとに 1 メッシュへマージ**する。
  - 家具・人物は `Instancer`（`instancer.ts`）でプロトタイプをマテリアル単位にマージし、InstancedMesh にする（1 プロト × 1 マテリアル = 1 ドローコール）。
- マテリアルは `materials.ts` のキー（`M('floor.carpetIT')` など）で共有する。`userData.tintable` のマテリアルは instanceColor で色替えし（人物の肌・髪・服、葉）、`defaultTint` を持つ。
- **テクスチャはすべて Canvas で手続き生成**（`textures.ts`：床材・画面・サイン・ロッカー面など）。外部画像に依存しないため、単一 HTML で完結する。
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
  glTF 読み込み後の Blender 座標は (x, -z, y) になる。生成物の出力先は `src/assets/baked/`（ライトマップ・環境 HDR）と `src/assets/renders/`（Cycles 静止画・360°パノラマ）。

## 変更時の注意

- README の「主な数値」と「室一覧」はモデルの集計値（`__app.stats()`）と一致させている。間取り・家具を変えたら確認して更新する。
- `docs/index.html`（単一 HTML の配布物）と `docs/images/`（README 用スクリーンショット）はコミットしている生成物。見た目を変えたら `npm run build:docs` と撮影をやり直す。
- 生成物・作業物は gitignore 済み：`dist/`、`dist-standalone/`、`shots/`、`blender/cache/`、`blender/out/`。
