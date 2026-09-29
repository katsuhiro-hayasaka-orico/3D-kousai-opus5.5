# -*- coding: utf-8 -*-
"""
向き・位置の実測による検証（結果は blender/out/verify.json）。

  .venv-blender/bin/python blender/verify.py [--only sun,facade,sky,uv]

  sun    ：白い拡散球を真上から正投影で撮り、最も明るい法線の方位・高度を測る。
           太陽ランプ単独と Nishita 天空（検証時だけ太陽ディスクを出す）の両方が meta.json の太陽位置と一致するか
  facade ：実際の建物で、2F 南面ガラスの外側と北面（コア外壁）の外側に鉛直のプローブ面を置き、
           直射日光の寄与（day − bake の照度差）が南面では大きく、北面ではほぼ 0 であること。
           南面から太陽への線上にある周辺街区（直射日光の影は落とさない）も記録する
  sky    ：室内の天空光（ライトマップと同じ条件）を、本番の光源サンプリング＋MIS と BSDF サンプリングだけの基準で求めて一致すること
  uv     ：ライトマップ UV の向き（bake_lightmaps.verify_uv）
"""

import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import calibrate as K  # noqa: E402
import common as C  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

RES = 256  # 球の撮影解像度（1 画素 ≒ 0.45°〜）
#: 天空光の一致を見る測定点（名前, three.js の x, z, 高さ）。北窓の SOC・北西の集中席・南の執務エリア（周辺街区が空を大きく遮る）
SKY_PROBES = [
    ('SOC 中央 机上', 20.8, -15.8, 0.75),
    ('SOC 北窓際 机上高', 20.8, -18.5, 0.75),
    ('集中席（北西）机上', -32.0, -16.0, 0.75),
    ('IT南 中央 机上', 25.0, 14.5, 0.75),
    ('IT南 窓から 1 m 机上高', 25.0, 18.2, 0.75),
]
#: 天空光の許容差：基準に対する相対 8% か 20 lx の大きい方（512 spp の実測で両者の差は 2% 以内）
SKY_TOL = (0.08, 20.0)


def _brightest_direction(a: np.ndarray) -> tuple[float, float]:
    """正投影で撮った単位球の画像から、最も明るい上位 0.05% の画素の法線の平均 → (方位, 高度)"""
    lum = a[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    thr = np.percentile(lum, 99.95)
    ys, xs = np.nonzero(lum >= thr)
    x = (xs + 0.5) / RES * 2 - 1  # 右 = +X（東）
    y = (ys + 0.5) / RES * 2 - 1  # 上 = +Y（北）（行 0 = 下端）
    z = np.sqrt(np.clip(1 - x * x - y * y, 0, 1))
    n = np.array([x.mean(), y.mean(), z.mean()])
    n /= np.linalg.norm(n)
    return math.degrees(math.atan2(n[0], n[1])) % 360, math.degrees(math.asin(n[2]))


def verify_sun() -> list[dict]:
    C.reset_scene()
    h = C.SceneHandles()
    h.meta = C.load_meta()
    h.col['Lights'] = bpy.context.scene.collection
    C.setup_world(h)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=256, ring_count=128, radius=1.0)
    sph = bpy.context.object
    bpy.ops.object.shade_smooth()
    m = bpy.data.materials.new('white')
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (1, 1, 1, 1)
    p.inputs['Roughness'].default_value = 1.0
    p.inputs['Specular IOR Level'].default_value = 0.0
    sph.data.materials.append(m)
    cam = bpy.data.cameras.new('top')
    cam.type = 'ORTHO'
    cam.ortho_scale = 2.0
    co = bpy.data.objects.new('top', cam)
    co.location = (0, 0, 5)
    bpy.context.scene.collection.objects.link(co)
    bpy.context.scene.camera = co
    C.setup_cycles(64, denoise=False)
    C.set_resolution(RES, RES)
    out = []
    work = C.ensure_dir(C.OUT / 'verify')
    for key in ('default', 'morning', 'afternoon'):
        s = h.meta['sun'][key]
        variant = {'default': 'day', 'afternoon': 'afternoon'}.get(key)
        for source in ('lamp', 'sky'):
            if variant:
                C.set_variant(h, variant)
            else:  # 朝（8:30）はバリアントにないので直接設定
                C.set_variant(h, 'day')
                h.sky.sun_elevation = math.radians(s['elevation'])
                h.sky.sun_rotation = math.radians(s['azimuth'])
                h.sun.rotation_euler = C.sun_vector(s['azimuth'], s['elevation']).to_track_quat('Z', 'Y').to_euler()
            if source == 'lamp':
                h.background.inputs['Strength'].default_value = 0.0
                h.sun.hide_render = False
                h.sky.sun_disc = False
            else:
                h.background.inputs['Strength'].default_value = 1.0
                h.sun.hide_render = True
                h.sky.sun_disc = True
            path = work / f'sun_{key}_{source}.exr'
            C.render_to(path, 'EXR')
            az, el = _brightest_direction(C.load_float_image(path))
            daz = (az - s['azimuth'] + 180) % 360 - 180
            ok = abs(daz) < 2.0 and abs(el - s['elevation']) < 2.0
            r = {'check': 'sun', 'time': s['hours'], 'source': source, 'expected': [round(s['azimuth'], 2), round(s['elevation'], 2)],
                 'measured': [round(az, 2), round(el, 2)], 'ok': bool(ok)}
            C.log(f'太陽 {s["hours"]}h {source:4s}: 期待 方位 {s["azimuth"]:.1f}° 高度 {s["elevation"]:.1f}° / '
                  f'実測 {az:.1f}° {el:.1f}° → {"OK" if ok else "NG"}')
            out.append(r)
    return out


def verify_facade(samples: int) -> list[dict]:
    """南面・北面の外側（2F、FL+1.2 m）に外向きの鉛直プローブを置き、直射日光の寄与を比べる"""
    h = C.build_scene(variant='day')
    C.set_visibility(h)
    b = h.meta['building']
    P = b['plate']
    # 南：バルコニーのない区間（x=−18）のガラス面の 5 cm 外。北：コア外壁（外装パネル面 z0−0.06）の 5 cm 外
    probes = [('南面 2F ガラス外側', (-18.0, 1.2, P['z1'] + 0.05), (0, 0, 1)),
              ('北面 2F コア外壁', (0.0, 1.2, P['z0'] - 0.11), (0, 0, -1))]
    col = bpy.data.collections.new('Probe')
    bpy.context.scene.collection.children.link(col)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    s = 0.1
    for i, (_, pos, nrm) in enumerate(probes):
        c = C.three_to_bl(pos)
        n = C.three_to_bl(nrm)
        t = n.cross(Vector((0, 0, 1))).normalized()
        u = Vector((0, 0, 1))
        corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        vs = [bm.verts.new(c + t * dx * s + u * dy * s) for dx, dy in corners]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.dot(n) < 0:
            f.normal_flip()
        for loop in f.loops:
            k = vs.index(loop.vert)
            dx, dy = corners[k]
            loop[uv].uv = ((i * 16 + 2 + (dx + 1) / 2 * 12) / 32, (2 + (dy + 1) / 2 * 12) / 16)
    me = bpy.data.meshes.new('facade_probes')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials.new('probe'))
    me.materials[0].use_nodes = True
    ob = bpy.data.objects.new('facade_probes', me)
    col.objects.link(ob)
    vals = {}
    for variant in ('day', 'bake'):
        C.set_variant(h, variant)
        im = C.new_float_image('facade_probe', 32, 16, 0.0)
        C.bake_diffuse([ob], im, samples, 0)
        a = C.image_array(im)[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        bpy.data.images.remove(im)
        vals[variant] = [float(a[4:12, i * 16 + 4:i * 16 + 12].mean()) * math.pi * 1000 for i in range(len(probes))]
    sun = [d - k for d, k in zip(vals['day'], vals['bake'])]
    # 期待値：南面（法線 = 南）への直射 = E⊥ × cos(入射角)
    sd = h.meta['sun']['default']
    sv = C.sun_vector(sd['azimuth'], sd['elevation'])
    e_n, _ = C.sun_irradiance_rgb(sd['elevation'])
    cos_s = max(0.0, sv.dot(Vector((0, -1, 0))))
    expect_s = e_n * cos_s * 1000
    # 南面のプローブから太陽への線上にある周辺街区。あれば、この検査は街区を素通しにする仕組み（city_material）も試している
    origin = C.three_to_bl(probes[0][1])
    crossing = [o.name for o in h.city_blocks
                if o.ray_cast(o.matrix_world.inverted() @ origin, o.matrix_world.inverted().to_3x3() @ sv)[0]]
    # 素通しの円錐は set_variant が 'city' の 1 個にだけ設定するので、全街区がそれを共有していること
    mats = sorted({ms.material.name for o in h.city_blocks for ms in o.material_slots if ms.material})
    shared = mats == ['city']
    ok = sun[0] > 0.5 * expect_s and sun[1] < 0.02 * sun[0] and shared
    C.log(f'直射日光の寄与（10:30）：南面 {sun[0]:.0f} lx（ガラス・庇なしの理論値 {expect_s:.0f} lx）、北面 {sun[1]:.0f} lx'
          f'、南面から太陽への線上の周辺街区 {crossing or "なし"}、街区 {len(h.city_blocks)} 個のマテリアル {mats}'
          f' → {"OK" if ok else "NG"}')
    return [{'check': 'facade', 'probes': [p[0] for p in probes], 'day_lx': [round(v) for v in vals['day']],
             'sky_only_lx': [round(v) for v in vals['bake']], 'sun_lx': [round(v) for v in sun],
             'expected_south_sun_lx': round(expect_s), 'sun_path_city_blocks': crossing,
             'city_blocks': len(h.city_blocks), 'city_materials': mats, 'ok': bool(ok)}]


def verify_sky(samples: int) -> list[dict]:
    """
    室内の天空光に偏りがないか。ライトマップと同じ条件（'bake'、上階の代わりに蓋）で、机上高の水平プローブの
    天空光の寄与（bake − night の照度差）を 2 通りに求めて比べる：
      本番：天空の光源サンプリング（窓のポータル・ライトツリー）と BSDF サンプリングの MIS
      基準：BSDF サンプリングだけ（world の sampling_method = NONE、ポータルも外す。ポータルがあると NONE でも光源として
            サンプリングされる）。影の光線を使わないので、物体の影の可視性の設定に左右されない
    周辺街区が影の光線だけを素通りさせる（visible_shadow=False）と、本番だけが明るくなる（修正前の実測で 1.9〜3 倍）。
    街区がこの測定点の空を実際に遮っていることの参考に、街区を外した値も記録する。
    """
    h = C.build_scene(variant='bake')
    C.set_visibility(h, hide=('upper',))
    col = bpy.data.collections.new('Probe')
    bpy.context.scene.collection.children.link(col)
    probe, res = K.make_probes(col, SKY_PROBES)
    world = bpy.context.scene.world
    n = len(SKY_PROBES)
    C.set_variant(h, 'night')
    night = K.measure(probe, res, samples, n)
    C.set_variant(h, 'bake')

    def sky_term() -> list[float]:
        return [b - k for b, k in zip(K.measure(probe, res, samples, n), night)]

    prod = sky_term()
    method = world.cycles.sampling_method
    world.cycles.sampling_method = 'NONE'
    for p in h.portals:
        p.hide_render = True
    ref = sky_term()
    world.cycles.sampling_method = method
    for p in h.portals:
        p.hide_render = False
    C.set_visibility(h, hide=('upper', 'city'))
    no_city = sky_term()
    rel, absl = SKY_TOL
    ok = all(abs(a - b) <= max(rel * b, absl) for a, b in zip(prod, ref))
    for (name, *_), a, b, c in zip(SKY_PROBES, prod, ref, no_city):
        C.log(f'天空光 {name}：本番 {a:.0f} lx／基準（BSDF のみ）{b:.0f} lx（周辺街区なし {c:.0f} lx）')
    C.log(f'天空光の推定の一致 → {"OK" if ok else "NG"}')
    return [{'check': 'sky', 'probes': [p[0] for p in SKY_PROBES], 'samples': samples,
             'production_lx': [round(v) for v in prod], 'reference_bsdf_only_lx': [round(v) for v in ref],
             'city_hidden_lx': [round(v) for v in no_city], 'tolerance': {'relative': rel, 'lx': absl}, 'ok': bool(ok)}]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='sun,facade,sky,uv')
    ap.add_argument('--samples', type=int, default=256)
    ap.add_argument('--sky-samples', type=int, default=512)
    args = ap.parse_args(C.parse_args())
    which = args.only.split(',')
    res = []
    if 'sun' in which:
        res += verify_sun()
    if 'facade' in which:
        res += verify_facade(args.samples)
    if 'sky' in which:
        res += verify_sky(args.sky_samples)
    if 'uv' in which:
        import bake_lightmaps as B

        h = C.build_scene(upper=False, variant='night')
        res += [{'check': 'uv', **r} for r in B.verify_uv(h)]
    C.write_json(C.ensure_dir(C.OUT) / 'verify.json', res)
    bad = [r for r in res if not r['ok']]
    C.log(f'検証 {len(res) - len(bad)}/{len(res)} 件 OK')
    if bad:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
