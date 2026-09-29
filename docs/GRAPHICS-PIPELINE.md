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
  - `L_upper` は周辺街区の箱（マテリアル `ghost.city`、箱ごとに別メッシュ。旧版は 1 メッシュ）。Blender は連結成分ごとに
    `city.<n>`（番号はブラウザの `CITY_BLOCKS` の順。親ノードは `cityBlock.<n>`）として実体化し、1 個の共有マテリアル `city`
    （階 3.8 m・スパン 1.5 m の格子の外装シェーダ。太陽へ向かう影の光線だけ素通し）を当てる。
  - ブラウザの外観用の上階 3F〜12F と屋上（`floors` レイヤー）は書き出さない。Blender は 2F のコレクションインスタンスで独自に積む。
    ブラウザの上階は 2F の躯体・天井・照明に加えて大きな家具を複製し、2F と同じライトマップを当てる（家具の接地影と物が一致する）。
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
  three.js では `lightMapIntensity = scale × π × exposure × gain × (1 + SUN_BOUNCE[atlas] × sun)`
  （three の lightMap は放射照度扱いで BRDF_Lambert の 1/π が掛かるため π を掛ける）。`SUN_BOUNCE`（床 0.05・壁 0.2・天井 0.55）は
  焼いていない太陽直達光の室内での照り返しの近似、`sun` は太陽高度 / 25° を 0〜1 に丸めた値。
  `exposure` は `bake.atlases.floor.stats.meanLum`（床の平均輝度。無ければ壁 → 天井）を目標値に合わせる自動露出、
  `gain` は UI の「GI 強度」。
  `bake.atlases.<atlas>` には `samples`・`seconds`・`resolutionScale`・`quality`（preview／final）と
  `stats`（`validFraction`・`median`・`meanLum`・`p99_5`・`max`・`clippedFraction`・`bytes`）が入る。
  最上位の `quality` はすべてのアトラスが final のときだけ `final`。
- ブラウザは `hash` が一致したときだけ適用する（レイアウトを変えたら再ベイクが必要）。

## 4. 室内 HDR 環境マップ（任意）

- `src/assets/baked/env_interior.hdr`：IT 執務エリア中央・目線高さからの正距円筒 1024×512（Radiance HDR）。
  ブラウザで PMREM 化して `scene.environment` に使い、ガラス・金属・画面への映り込みを実写的にする。

## 5. Cycles レンダー（静止画・360°）

- レンダー解像度は静止画 1920×1080、パノラマ 4096×2048（正距円筒）。ブラウザに同梱するのは縮小版で、
  `src/assets/renders/<id>.jpg`（静止画 1600 px 幅）、`<id>_thumb.jpg`（480 px 幅）、
  パノラマは id が `pano-<場所>`、ファイルが `pano_<場所>.jpg`（3072 px 幅）。
  final 品質の原寸 JPEG は `docs/renders/`（README 用・ダウンロード用）。
- `renders.json`：
  ```json
  [ { "id": "it-south", "kind": "still", "title": "IT・システムG 執務エリア（南）", "preset": "IT 執務（南）",
      "file": "it-south.jpg", "thumb": "it-south_thumb.jpg", "webW": 1600, "webH": 900,
      "original": "docs/renders/it-south.jpg", "w": 1920, "h": 1080,
      "samples": 160, "seconds": 812, "sunHours": 10.5, "note": "", "variant": "day", "ev": 1.6, "quality": "final",
      "camera": { "pos": [13.9, 1.55, 10.5], "target": [23.2, 0.75, 14.2], "fov": 62, "twoPoint": true, "shiftY": -0.067 } } ]
  ```
  `w`・`h` はレンダー解像度、`webW`・`webH` は同梱画像の寸法。`original` は final のときだけ。
  `preset` は `src/data/presets.ts` の名前（ブラウザの「3Dでこの視点へ」に使う）。パノラマは `"kind": "pano"` で、
  `pos`・`heading`・`clearance`・`mapping` を持つ。外観で視線を遮る街区を隠したショットは `hiddenCityBlocks`。
- カメラは `meta.json` の `cameras`（three.js 座標の pos/target/fov〔縦画角〕）を変換して使う。

## 6. ブラウザ側

- `src/gfx/`：ライトマップ適用（ハッシュ照合・フォールバック）、ポストエフェクト（GTAO・Bloom・SMAA）、空（Sky シェーダ）。
- `src/ui/gallery.ts`・`src/ui/pano.ts`：フォトリアルギャラリーと 360° ビューア。
- 画質プリセット：高（MSAA＋GTAO＋Bloom＋SMAA）／標準（Bloom＋SMAA）／軽量（ポストなし）。モバイルは標準が既定。
  トーンマッピングは Neutral（OutputPass）。単色背景は、トーンマッピング後に指定色になるよう逆算した色を使う。
- ライトマップはシェーダーで LED 成分と天空成分に分け、時刻スライダーに応じて天空成分だけを減らす（夕方・夜）。
  室内の IBL・半球光も机上照度の内訳（`AMBIENT_SPLIT`：LED 0.46・天空 0.11・日射 0.43）で同様に減らす。
  太陽の直達光は DirectionalLight＋シャドウマップでリアルタイムに与える。
- 外観では建物の外接箱の 27 点へカメラから引いた線分に当たる街区を隠す（Blender の撮影と同じ判定、`gfx/clearance.ts`）。
- アセットがなくても従来どおり動作する（すべて任意読み込み）。
