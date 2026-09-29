# グラフィックス強化パイプライン（Blender × three.js）

ブラウザ版の 3D モデルを、Blender（Cycles）の物理ベースレンダリングで強化するための仕組みと、
各工程のあいだの**契約（ファイル・座標・単位）**をまとめたものです。

```
 src/（TypeScript：唯一の形状データ源）
   │  npm run dev → node scripts/export-scene.mjs
   ▼
 blender/cache/scene.glb, meta.json        ← 書き出し（ジオメトリ往復なし）
   │  .venv-blender/bin/python blender/*.py
   ▼
 src/assets/baked/   lm_floor / lm_ceil / lm_wall（GI ライトマップ）, env_interior.hdr, lightmaps.json
 src/assets/renders/ Cycles 静止画・360°パノラマ・サムネイル, renders.json
   │  vite build
   ▼
 ブラウザ：ライトマップ＋GTAO/Bloom/SMAA＋空＋フォトリアルギャラリー＋360°ビューア
```

## 1. 環境

- Blender は PyPI の `bpy`（Blender 4.5 LTS をPythonモジュール化したもの）を使う。GUI 不要・Cycles CPU・OpenImageDenoise 同梱。
  ```
  uv venv --python 3.11 .venv-blender
  uv pip install --python .venv-blender/bin/python bpy==4.5.14 Pillow
  ```
- CPU 4 コアで動かす前提。長時間ジョブは `--quality preview|final` で段階的に。

## 2. 書き出し（scripts/export-scene.mjs）

- 開発サーバー起動中に `node scripts/export-scene.mjs` → `blender/cache/scene.glb` と `meta.json`。
- glTF の最上位ノード：`L_structure, L_eaves, L_ceiling, L_furniture, L_people, L_site, L_upper`。
  - `L_upper` は他階のゴースト（半透明の箱）。Blender では非表示にし、2F を複製した本物の上階に置き換える。
- メッシュ名：静的メッシュは `structure:<マテリアルキー>` など、家具・人物は `<プロト名>:<マテリアルキー>[#色]`。
- マテリアル名は three.js 側のキー（例 `floor.carpetIT`, `glass.cw`, `light.panel`, `screen.video2`, `person.top#2f3b52`）。
  `#rrggbb` はインスタンス色（人物の服・肌、樹木の葉）で分割した派生マテリアル。
- 座標：three.js（x=東, y=上, z=南, m）。Blender の glTF 読み込み後は **(x, −z, y)**（Blender の +Y = 北）。
- 2F の床仕上げ面が y=0。地盤（1F 床）は y=−5.6、基準階高 4.5 m、天井高 2.8 m。

## 3. ライトマップ（GI ベイク）の契約

| アトラス | 画像サイズ | UV（TEXCOORD_1 / Blender「UVMap.001」） | 対象メッシュ |
|---|---|---|---|
| `floor` | 4096×2048 | 平面投影 u=(x+41.6)/83.2, v=(z+20.8)/43.6 | `structure:floor.*` |
| `ceil` | 4096×2048 | 平面投影 u=(x+38.8)/77.6, v=(z+19.6)/39.2 | `ceilingPlanes:ceiling` |
| `wall` | 4096×4096 | 壁・柱ボックス各面のシェルフパッキング（約 63 px/m） | `structure:wall.white / wall.core / wall.movable` |

- **v は画像の上端 = 0**（北が上の平面図になる）。Blender の glTF インポータは v を反転するので、
  Blender で `UVMap.001` にベイクした画像を**そのまま**書き出せばよい。three.js 側は `flipY = false` で読む。
- 対象外の面（床材に含まれる段板の側面、壁の上下面など）は各アトラスの**予約ブロック**の中心に縮退している。
  ベイク後、予約ブロック（`meta.json` の `atlases.*.dummy` = [x, y, size] px、左上原点）を周辺の中央値で塗りつぶす。
- **焼き込む光**：Diffuse の Direct+Indirect（Color なし）＝照度。天井 LED（発光面）＋天空光（Nishita、太陽ディスクなし）。
  **太陽の直達光は焼かない**（ブラウザ側の時刻スライダーでリアルタイムに与えるため）。
- 家具・人物・上階スラブはベイク時も遮蔽物として存在させる（机の下の接地影、天井の閉鎖）。
- 出力：`src/assets/baked/lm_<atlas>.webp`（または .jpg）8bit sRGB と `lightmaps.json`：
  ```json
  {
    "hash": "<meta.json の lightmap.hash と同じ値>",
    "atlases": { "floor": { "file": "lm_floor.webp", "w": 4096, "h": 2048, "scale": 3.2 } , "ceil": {}, "wall": {} },
    "encoding": "srgb8",
    "bake": { "blender": "4.5.14", "samples": 256, "seconds": 0, "denoise": "OIDN" }
  }
  ```
  画素値 p（sRGB をデコードした線形 0〜1）× `scale` = Blender の Diffuse ライトパス値。
  three.js では `lightMapIntensity = scale × π × gain`（three の lightMap は放射照度扱いで BRDF_Lambert の 1/π が掛かるため）。
- ブラウザは `hash` が一致したときだけ適用する（レイアウトを変えたら再ベイクが必要）。

## 4. 室内 HDR 環境マップ（任意）

- `src/assets/baked/env_interior.hdr`：IT 執務エリア中央・目線高さからの正距円筒 1024×512（Radiance HDR）。
  ブラウザで PMREM 化して `scene.environment` に使い、ガラス・金属・画面への映り込みを実写的にする。

## 5. Cycles レンダー（静止画・360°）

- `src/assets/renders/<id>.jpg`（1920×1080）、`<id>_thumb.jpg`（480×270）、`pano_<id>.jpg`（4096×2048 正距円筒）。
- `renders.json`：
  ```json
  [ { "id": "it-south", "kind": "still", "title": "IT・システムG 執務エリア（南）", "preset": "IT 執務（南）",
      "file": "it-south.jpg", "thumb": "it-south_thumb.jpg", "w": 1920, "h": 1080,
      "samples": 256, "seconds": 812, "sunHours": 10.5, "note": "" } ]
  ```
  `preset` は `src/data/presets.ts` の名前（ブラウザの「3Dでこの視点へ」に使う）。パノラマは `"kind": "pano"`。
- カメラは `meta.json` の `cameras`（three.js 座標の pos/target/fov〔縦画角〕）を変換して使う。

## 6. ブラウザ側

- `src/gfx/`：ライトマップ適用（ハッシュ照合・フォールバック）、ポストエフェクト（GTAO・Bloom・SMAA）、空（Sky シェーダ）。
- `src/ui/gallery.ts`・`src/ui/pano.ts`：フォトリアルギャラリーと 360° ビューア。
- 画質プリセット：高（GTAO＋Bloom＋SMAA）／標準（Bloom＋SMAA）／軽量（なし）。モバイルは標準が既定。
- アセットがなくても従来どおり動作する（すべて任意読み込み）。
