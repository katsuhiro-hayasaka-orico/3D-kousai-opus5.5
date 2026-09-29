# -*- coding: utf-8 -*-
"""
GI ライトマップのベイク（docs/GRAPHICS-PIPELINE.md §3 の契約どおり）と室内 HDR 環境マップ（§4）。

  .venv-blender/bin/python blender/bake_lightmaps.py --quality preview|final
      [--samples N] [--scale S] [--atlases floor,ceil,wall] [--no-env] [--env-only]

  1. シーン（common.build_scene、バリアント 'bake' = 天空光のみ＋室内照明、太陽ランプなし）
  2. アトラスごとに対象メッシュ（meta.json の lightmap.meshes、2F の原本のみ）を 1 オブジェクトに結合し、
     UVMap.001 に Diffuse（Direct＋Indirect、色なし）をベイク。上階・家具・人物は遮蔽物として残す
  3. OIDN（コンポジターの Denoise ノード）→ 予約ブロックを有効画素の中央値で塗る → scale = 99.5 パーセンタイル
  4. 画素 p = 値 / scale を sRGB 8bit の WebP に（v は画像上端 = 0。Blender の画像をそのまま上から書き出す）
  5. src/assets/baked/lightmaps.json（hash は meta.json からコピー）

  verify_uv()（blender/verify.py から呼ぶ）：強い点光源を既知の位置に置いた小さなテストベイクで、
  UV の向き（床・天井は契約の式、壁はメッシュの UV から求めた位置）と最も明るい画素の位置が一致することを確かめる。
"""

import argparse
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as C  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

ATLAS_NAMES = ('floor', 'ceil', 'wall')

#: 品質プリセット：サンプル数、アトラスごとの解像度倍率（契約サイズに対する）。
#: 最終品質は「時間を厭わない」方針で全アトラスを契約サイズのまま 128 サンプルで焼く
QUALITY = {
    'preview': {'samples': 16, 'scale': {'floor': 0.5, 'ceil': 0.5, 'wall': 0.5}, 'env_samples': 64},
    'final': {'samples': 128, 'scale': {'floor': 1.0, 'ceil': 1.0, 'wall': 1.0}, 'env_samples': 256},
}


def setup_bake_cycles() -> None:
    """ベイク用の Cycles 設定（拡散の相互反射を主に、コースティクスなし）"""
    c = bpy.context.scene.cycles
    c.device = 'CPU'
    c.use_light_tree = True
    c.max_bounces = 8
    c.diffuse_bounces = 4
    c.glossy_bounces = 2
    c.transmission_bounces = 4
    c.transparent_max_bounces = 16
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.blur_glossy = 1.0
    c.sample_clamp_direct = 0.0
    c.sample_clamp_indirect = 10.0
    c.use_guiding = False
    c.seed = 11

#: 室内 HDR（three.js 座標、目線高さ）。画像中央 = +X（東）、u=0.75 = +Z（南）＝ three.js の equirectUv と同じ並び
ENV_POS = (25.0, 1.55, 14.5)
ENV_SIZE = (1024, 512)


# ------------------------------------------------------------
# ベイク対象
# ------------------------------------------------------------


def join_atlas(h: C.SceneHandles, atlas: str) -> bpy.types.Object:
    """アトラスの対象メッシュ（2F の原本）を 1 オブジェクトに結合する（余白の拡張がほかのメッシュを上書きしないように）"""
    names = [m['name'] for m in h.meta['lightmap']['meshes'] if m['atlas'] == atlas]
    objs = []
    for n in names:
        ob = bpy.data.objects.get(n)
        if ob is None or ob.type != 'MESH':
            raise RuntimeError(f'ライトマップ対象 {n} が scene.glb にない（meta.json と不一致）')
        if 'UVMap.001' not in ob.data.uv_layers:
            raise RuntimeError(f'{n} に UVMap.001（TEXCOORD_1）がない')
        objs.append(ob)
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=objs[0], object=objs[0], selected_objects=objs,
                                       selected_editable_objects=objs):
            bpy.ops.object.join()
    ob = objs[0]
    ob.name = f'LM:{atlas}'
    uv = ob.data.uv_layers
    uv.active = uv['UVMap.001']  # ベイク先
    uv['UVMap'].active_render = True  # 描画（テクスチャ）は従来の UV
    C.log(f'{atlas}: {len(objs)} メッシュを結合（{len(ob.data.polygons)} 面）')
    return ob


def atlas_size(h: C.SceneHandles, atlas: str, scale: float) -> tuple[int, int]:
    a = h.meta['lightmap']['atlases'][atlas]
    return max(64, round(a['w'] * scale)), max(64, round(a['h'] * scale))


# ------------------------------------------------------------
# デノイズ（OIDN：コンポジターの Denoise ノード）
# ------------------------------------------------------------


def denoise_exr(src: Path, dst: Path) -> float:
    """src の EXR を OIDN で雑音除去して dst へ。空のシーンでコンポジターだけを実行する"""
    main = bpy.context.window.scene if bpy.context.window else bpy.context.scene
    img = bpy.data.images.load(str(src), check_existing=False)
    w, hh = img.size
    sc = bpy.data.scenes.new('denoise')
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 1
    sc.render.resolution_x, sc.render.resolution_y = w, hh
    sc.render.resolution_percentage = 100
    sc.render.use_compositing = True
    sc.render.use_sequencer = False
    sc.view_settings.view_transform = 'Standard'
    sc.use_nodes = True
    nt = sc.node_tree
    nt.nodes.clear()
    n_img = nt.nodes.new('CompositorNodeImage')
    n_img.image = img
    dn = nt.nodes.new('CompositorNodeDenoise')
    dn.use_hdr = True
    dn.prefilter = 'ACCURATE'
    dn.quality = 'HIGH'
    comp = nt.nodes.new('CompositorNodeComposite')
    nt.links.new(n_img.outputs['Image'], dn.inputs['Image'])
    nt.links.new(dn.outputs['Image'], comp.inputs['Image'])
    s = sc.render.image_settings
    s.file_format = 'OPEN_EXR'
    s.color_depth = '32'
    s.exr_codec = 'ZIP'
    sc.render.filepath = str(dst)
    t = time.time()
    with C.blender_log():
        bpy.ops.render.render(write_still=True, scene=sc.name)
    dt = time.time() - t
    bpy.data.scenes.remove(sc)
    bpy.data.images.remove(img)
    if bpy.context.window:
        bpy.context.window.scene = main
    return dt


# ------------------------------------------------------------
# 後処理・書き出し
# ------------------------------------------------------------


def srgb_encode(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def resize_float(arr: np.ndarray, w: int, hh: int) -> np.ndarray:
    """float (h, w, c) を双線形で拡大（プレビュー解像度 → 契約サイズ）"""
    from PIL import Image

    return np.stack([np.asarray(Image.fromarray(arr[..., c].astype(np.float32), 'F').resize((w, hh), Image.BILINEAR))
                     for c in range(arr.shape[2])], axis=-1)


def dummy_slice(meta_atlas: dict, w: int, hh: int, scale: float):
    """予約ブロック（左上原点 [x, y, size] px、契約サイズ基準）→ numpy（下端原点）のスライス"""
    x, y, size = meta_atlas['dummy']
    x0, y0, s = int(x * scale), int(y * scale), max(2, math.ceil(size * scale))
    return slice(hh - (y0 + s), hh - y0), slice(x0, x0 + s)


def finish_atlas(h: C.SceneHandles, atlas: str, den: np.ndarray, valid: np.ndarray, scale_res: float,
                 quality: str) -> dict:
    """予約ブロックの塗りつぶし・スケール決定・契約サイズへの拡大・WebP 書き出し"""
    from PIL import Image

    ma = h.meta['lightmap']['atlases'][atlas]
    hh, w = den.shape[:2]
    rgb = den[..., :3].copy()
    vals = rgb[valid]
    med = np.median(vals, axis=0)
    ys, xs = dummy_slice(ma, w, hh, scale_res)
    rgb[~valid] = med  # 未使用領域（どの UV も参照しない）。圧縮しやすい一定値に
    rgb[ys, xs] = med
    peak = vals.max(axis=1)
    scale = float(np.percentile(peak, 99.5))
    W, H = ma['w'], ma['h']
    if (w, hh) != (W, H):
        rgb = resize_float(rgb, W, H)
    enc = srgb_encode(rgb / scale)
    u8 = np.round(enc * 255.0).astype(np.uint8)[::-1]  # 行を上端から（v は画像上端 = 0）
    path = C.ensure_dir(C.BAKED_DIR) / f'lm_{atlas}.webp'
    Image.fromarray(u8, 'RGB').save(path, 'WEBP', quality=92, method=6)
    lum = vals @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    stats = {
        'validFraction': round(float(valid.mean()), 4),
        'median': [round(float(v), 4) for v in med],
        'meanLum': round(float(lum.mean()), 4),
        'p99_5': round(scale, 4),
        'max': round(float(peak.max()), 4),
        'clippedFraction': round(float((peak > scale).mean()), 5),
        'bytes': path.stat().st_size,
    }
    C.log(f'{atlas}: scale {scale:.3f}、中央値 {med.round(3).tolist()}、有効 {stats["validFraction"]:.1%}、'
          f'{path.name} {stats["bytes"] / 1e3:.0f} kB')
    return {'file': path.name, 'w': W, 'h': H, 'scale': round(scale, 5), 'stats': stats}


def bake_atlas(h: C.SceneHandles, atlas: str, samples: int, scale_res: float, quality: str) -> dict:
    C.set_visibility(h, hide=('upper',))
    ob = join_atlas(h, atlas)
    w, hh = atlas_size(h, atlas, scale_res)
    margin = max(4, round(8 * scale_res))
    img = C.new_float_image(f'lm_{atlas}', w, hh, -1.0)
    C.log(f'{atlas}: ベイク {w}×{hh}、{samples} spp、余白 {margin}px …')
    setup_bake_cycles()
    dt = C.bake_diffuse([ob], img, samples, margin)
    raw = C.image_array(img)
    bpy.data.images.remove(img)
    valid = raw[..., 0] > -0.5
    C.log(f'{atlas}: ベイク {dt:.0f}s（有効画素 {valid.mean():.1%}）')
    # デノイズ前に未使用画素を中央値で埋める（負の番兵値が OIDN を乱さないように）
    med = np.median(raw[valid][:, :3], axis=0)
    filled = raw.copy()
    filled[~valid, :3] = med
    work = C.ensure_dir(C.OUT / 'bake')
    src, dst = work / f'lm_{atlas}_raw.exr', work / f'lm_{atlas}_oidn.exr'
    C.save_float_image(filled, src)
    dn_s = denoise_exr(src, dst)
    den = C.load_float_image(dst)
    # 書き出し・読み戻しで色変換が入っていないか：デノイズは平均をほぼ保つ
    # （中央値は比べない。低サンプルの雑音は右に裾が長く、雑音のある画像の中央値は低く出る）
    mean_raw = raw[valid][:, :3].mean(axis=0)
    mean_dn = den[valid][:, :3].mean(axis=0)
    if np.any(np.abs(mean_dn - mean_raw) > 0.03 * mean_raw + 1e-4):
        raise RuntimeError(f'{atlas}: デノイズ前後で平均が一致しない {mean_raw} → {mean_dn}（色変換の混入）')
    C.log(f'{atlas}: OIDN {dn_s:.0f}s（平均 {mean_raw.round(4).tolist()} → {mean_dn.round(4).tolist()}）')
    res = finish_atlas(h, atlas, den, valid, scale_res, quality)
    res['seconds'] = round(dt + dn_s, 1)
    return res


# ------------------------------------------------------------
# 室内 HDR 環境マップ
# ------------------------------------------------------------


def render_env(h: C.SceneHandles, samples: int) -> dict:
    C.set_variant(h, 'day')
    C.set_visibility(h, hide=('upper',))
    C.make_pano_camera('env_cam', ENV_POS, 90.0)
    C.setup_cycles(samples, threshold=0.01, ev=0.0)
    C.set_resolution(*ENV_SIZE)
    work = C.ensure_dir(C.OUT / 'bake')
    exr = work / 'env_interior.exr'
    dt = C.render_to(exr, 'EXR')
    ref = C.load_float_image(exr)
    out = C.ensure_dir(C.BAKED_DIR) / 'env_interior.hdr'
    C.save_float_image(ref, out, 'HDR')
    # 書き出した HDR を読み戻して値が線形のまま（表示変換なし）か確かめる
    back = C.load_float_image(out)
    rel = float(np.abs(back[..., :3].mean() - ref[..., :3].mean()) / max(1e-6, ref[..., :3].mean()))
    if rel > 0.02:
        raise RuntimeError(f'env_interior.hdr の値が EXR と一致しない（相対差 {rel:.3f}）')
    C.log(f'env_interior.hdr {ENV_SIZE[0]}×{ENV_SIZE[1]}、{dt:.0f}s、平均 {ref[..., :3].mean():.3f}（EXR との差 {rel:.2%}）')
    return {'file': out.name, 'w': ENV_SIZE[0], 'h': ENV_SIZE[1], 'pos': list(ENV_POS), 'variant': 'day',
            'sunHours': h.meta['sun']['default']['hours'], 'samples': samples, 'seconds': round(dt, 1),
            'mapping': 'three.js equirectUv（u=0.5 が +X 東、u=0.75 が +Z 南、上端が天頂）', 'mean': round(float(ref[..., :3].mean()), 4)}


# ------------------------------------------------------------
# UV の向きの検証
# ------------------------------------------------------------


def _point_light(name: str, pos3, power: float) -> bpy.types.Object:
    L = bpy.data.lights.new(name, 'POINT')
    L.energy = power
    L.shadow_soft_size = 0.01
    ob = bpy.data.objects.new(name, L)
    ob.location = C.three_to_bl(pos3)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _brightest_uv(im: bpy.types.Image) -> tuple[float, float]:
    """最も明るい画素の (u, v_top)。v_top は画像上端から"""
    a = C.image_array(im)[..., :3]
    lum = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    r, c = np.unravel_index(np.argmax(lum), lum.shape)
    hh, w = lum.shape
    return (c + 0.5) / w, 1.0 - (r + 0.5) / hh


def _mesh_uv_at(ob: bpy.types.Object, origin: Vector, direction: Vector) -> tuple[Vector, tuple[float, float]]:
    """レイが当たった点の UVMap.001（重心座標で補間）を (u, v_top) で返す"""
    ok, loc, nrm, idx = ob.ray_cast(origin, direction)
    if not ok:
        raise RuntimeError('検証用のレイが壁に当たらない')
    me = ob.data
    poly = me.polygons[idx]
    uvl = me.uv_layers['UVMap.001'].data
    vs = [me.vertices[me.loops[li].vertex_index].co for li in poly.loop_indices]
    uvs = [uvl[li].uv for li in poly.loop_indices]
    from mathutils.geometry import barycentric_transform

    uv3 = barycentric_transform(loc, vs[0], vs[1], vs[2], uvs[0].to_3d(), uvs[1].to_3d(), uvs[2].to_3d())
    return loc, (uv3.x, 1.0 - uv3.y)


def verify_uv(h: C.SceneHandles) -> list[dict]:
    """
    点光源 1 灯だけのテストベイク（1/4 解像度、4 spp）で最も明るい画素の位置を確かめる。
      floor：three (30, 0.3, 12) → u=(x+41.6)/83.2, v=(z+20.8)/43.6
      ceil ：three (−19.2, 2.5, 15.2) → u=(x+38.8)/77.6, v=(z+19.6)/39.2
      wall ：柱（x=25.6 の南面柱）の北面から 0.3 m、高さ 0.6 m → レイキャストで得た面の UV
    """
    C.set_variant(h, 'night')
    h.background.inputs['Strength'].default_value = 0.0
    C.set_visibility(h, hide=('people', 'furniture', 'upper', 'site', 'city'))
    for o in C.descendants(bpy.data.objects['ceilingEquip'], C.children_map()):
        o.hide_render = True
    for m in bpy.data.materials:  # 発光を止めて点光源だけにする
        if m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED' and not n.inputs['Emission Strength'].is_linked:
                    n.inputs['Emission Strength'].default_value = 0.0
                elif n.type == 'BSDF_PRINCIPLED':
                    for l in list(n.inputs['Emission Strength'].links):
                        m.node_tree.links.remove(l)
                    n.inputs['Emission Strength'].default_value = 0.0
    results = []
    lm = h.meta['lightmap']['atlases']
    tests = [
        ('floor', (30.0, 0.3, 12.0)),
        ('ceil', (-19.2, 2.5, 15.2)),
        ('wall', (25.6, 0.6, 18.25 - 0.3)),
    ]
    for atlas, pos in tests:
        ob = join_atlas(h, atlas)
        light = _point_light(f'verify_{atlas}', pos, 2000.0)
        w, hh = atlas_size(h, atlas, 0.25)
        im = C.new_float_image(f'verify_{atlas}', w, hh, 0.0)
        setup_bake_cycles()
        C.bake_diffuse([ob], im, 4, 0)
        got = _brightest_uv(im)
        bpy.data.images.remove(im)
        if atlas == 'wall':
            p = C.three_to_bl(pos)
            loc, exp = _mesh_uv_at(ob, p, C.three_to_bl((0, 0, 1)))
            # チャートの上下：同じ面の 1 m 上の点は画像の上側（v_top が小さい）にあるはず
            _, exp_up = _mesh_uv_at(ob, p + Vector((0, 0, 1.0)), C.three_to_bl((0, 0, 1)))
            up_ok = exp_up[1] < exp[1]
            px = (abs(got[0] - exp[0]) * w, abs(got[1] - exp[1]) * hh)
            ok = px[0] <= 3 and px[1] <= 3 and up_ok
            note = f'面上の点 {tuple(round(v, 3) for v in loc)}、1 m 上は v_top {exp_up[1]:.4f}（上向き {"OK" if up_ok else "NG"}）'
        else:
            x0, z0, x1, z1 = lm[atlas]['bounds']
            exp = ((pos[0] - x0) / (x1 - x0), (pos[2] - z0) / (z1 - z0))
            ok = abs(got[0] - exp[0]) < 0.01 and abs(got[1] - exp[1]) < 0.01
            px = (abs(got[0] - exp[0]) * w, abs(got[1] - exp[1]) * hh)
            note = f'契約の式 u=(x−{x0})/{x1 - x0:.1f}, v=(z−{z0})/{z1 - z0:.1f}'
        r = {'atlas': atlas, 'light_three': list(pos), 'expected_uv': [round(v, 4) for v in exp],
             'brightest_uv': [round(v, 4) for v in got], 'error_px': [round(v, 2) for v in px],
             'resolution': [w, hh], 'ok': bool(ok), 'note': note}
        C.log(f'検証 {atlas}: 期待 {r["expected_uv"]} / 実測 {r["brightest_uv"]}（誤差 {r["error_px"]} px）'
              f' → {"OK" if ok else "NG"}  {note}')
        results.append(r)
        bpy.data.objects.remove(light)
    return results


# ------------------------------------------------------------
# メイン
# ------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description='GI ライトマップと室内 HDR のベイク')
    ap.add_argument('--quality', choices=QUALITY, default='preview')
    ap.add_argument('--samples', type=int)
    ap.add_argument('--scale', type=float, help='契約サイズに対する解像度倍率（全アトラス共通。例 0.5）')
    ap.add_argument('--atlases', default=','.join(ATLAS_NAMES))
    ap.add_argument('--no-env', action='store_true')
    ap.add_argument('--env-only', action='store_true')
    args = ap.parse_args(C.parse_args())
    q = QUALITY[args.quality]
    samples = args.samples or q['samples']
    t0 = time.time()

    h = C.build_scene(variant='bake')
    json_path = C.BAKED_DIR / 'lightmaps.json'
    doc = {}
    if json_path.exists():
        import json

        doc = json.loads(json_path.read_text(encoding='utf-8'))
        if doc.get('hash') != h.meta['lightmap']['hash']:
            doc = {}  # レイアウトが変わった：前回の結果は使えない
    doc['hash'] = h.meta['lightmap']['hash']
    doc.setdefault('atlases', {})
    doc['encoding'] = 'srgb8'
    doc['units'] = ('画素 p（sRGB をデコードした線形 0〜1）× scale = Cycles の Diffuse ライトパス値（白の拡散面の輝度）。'
                    '照度 E = π × 値。値 1.0 ≒ 1,000 cd/m²（照度 π×1,000 lx）')
    bake_info = doc.setdefault('bake', {})

    if not args.env_only:
        for atlas in [a for a in args.atlases.split(',') if a]:
            if atlas not in ATLAS_NAMES:
                raise SystemExit(f'不明なアトラス {atlas}')
            scale_res = args.scale or q['scale'][atlas]
            res = bake_atlas(h, atlas, samples, scale_res, args.quality)
            bake_info.setdefault('atlases', {})[atlas] = {
                'samples': samples, 'seconds': res.pop('seconds'), 'resolutionScale': scale_res,
                'quality': args.quality, 'stats': res.pop('stats')}
            doc['atlases'][atlas] = res
            C.write_json(json_path, doc)
    per = bake_info.get('atlases', {})
    doc['quality'] = 'final' if per and all(v['quality'] == 'final' for v in per.values()) else 'preview'
    bake_info.update({
        'blender': bpy.app.version_string.split()[0],
        'samples': max((v['samples'] for v in per.values()), default=samples),
        'seconds': round(sum(v['seconds'] for v in per.values()), 1),
        'denoise': 'OIDN',
        'world': 'Nishita 天空（10:30 の分布、太陽ディスクなし）＋室内照明。太陽ランプなし。周辺街区（概略の箱）は天空光を遮る',
        'ledRadiance': C.LED_RADIANCE,
    })
    if not args.no_env:
        doc['env'] = render_env(h, q['env_samples'] if not args.samples else max(args.samples, 16))
    C.write_json(json_path, doc)
    C.log(f'完了 {time.time() - t0:.0f}s → {json_path}')


if __name__ == '__main__':
    main()
