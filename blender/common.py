# -*- coding: utf-8 -*-
"""
麹町弘済ビルディング 2F — Blender（Cycles）共通モジュール

  scene.glb / meta.json（scripts/export-scene.mjs の書き出し）から、フォトリアル用のシーンを組み立てる。

   1. 読み込み：factory settings（空）→ glTF 読み込み
   2. 構成：2F の内容（躯体・天井・庇・家具・人物）を 1 つのコレクションにまとめ、
      3F〜12F をコレクションインスタンスで積層。屋上スラブ・パラペット・塔屋・目隠しルーバーを追加。
      ゴースト（L_upper）の他階は非表示、周辺街区の箱だけ残して外装マテリアルを与える。
   3. マテリアル：three.js のマテリアルキー（'#rrggbb' の派生は除いたキー）で規則を引き、物理ベース化する。
      規則に当たらないものは glTF 読み込み時の Principled 設定のまま。
   4. 照明：Nishita 天空（太陽ディスクなし）＋ 太陽ランプ（meta.json の方位・高度）。窓面にポータル。
   5. カメラ（three.js 座標 → Blender 座標、fov は縦画角）と Cycles CPU 設定。

座標：three.js (x=東, y=上, z=南) → Blender (x, −z, y)。Blender の +Y が北。

単位（放射測光の約束）：放射照度 1.0 ≒ 1,000 lx、輝度 1.0 ≒ 1,000 cd/m²。
Nishita 天空の既定スケール（快晴・太陽高度 50° で水平面の天空照度 ≒ 9）に合わせた近似で、
室内照明・画面・太陽ランプの強さもこの単位で与える（値の根拠は blender/README.md）。
"""

from __future__ import annotations

import json
import math
import os
import sys
import time
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

# ------------------------------------------------------------
# パス
# ------------------------------------------------------------

ROOT = Path(__file__).resolve().parents[1]
BLENDER_DIR = ROOT / 'blender'
CACHE = BLENDER_DIR / 'cache'
GLB = CACHE / 'scene.glb'
META = CACHE / 'meta.json'
OUT = BLENDER_DIR / 'out'  # 中間ファイル（EXR・PNG・ログ）。git 管理外
BAKED_DIR = ROOT / 'src' / 'assets' / 'baked'
RENDERS_DIR = ROOT / 'src' / 'assets' / 'renders'

# ------------------------------------------------------------
# 照明の校正値（単位は冒頭の約束どおり。根拠と測定値は README）
# ------------------------------------------------------------

#: 天井 LED（light.panel）下向き発光面の輝度。机上面（0.75 m）照度 ≒ 750 lx になるよう calibrate.py で合わせた値
LED_RADIANCE = 30.0
#: 吊り下げ型ライン照明の上向き成分（下向きに対する比）
PENDANT_UPLIGHT = 0.35
#: 暖色の間接照明・ペンダント・デスクライト（light.warm）
WARM_RADIANCE = 8.0
#: 機器の状態表示 LED（light.led / ledBlue / ledRed）
STATUS_LED_RADIANCE = 4.0
#: 誘導灯（exitSign）
EXIT_SIGN_RADIANCE = 0.9
#: 画面の白の輝度：PC モニター、会議室ディスプレイ、SOC ビデオウォール、ロック画面
SCREEN_RADIANCE = {'code': 0.35, 'dash': 0.35, 'sheet': 0.35, 'video': 0.45, 'slide': 0.45, 'soc': 0.5, 'lock': 0.25}
#: 内照サイン・ラック前面・室名サインの発光
SIGN_RADIANCE = 0.35
RACK_RADIANCE = 0.25
PLATE_RADIANCE = 0.04
#: 周辺街区の窓（点灯している執務室）の輝度
CITY_WINDOW_RADIANCE = 0.12
#: 大気圏外の太陽照度（≒ 128 klx）
SUN_E0 = 128.0

# ------------------------------------------------------------
# 基本ユーティリティ
# ------------------------------------------------------------

_T0 = time.time()


def log(msg: str) -> None:
    print(f'[{time.time() - _T0:7.1f}s] {msg}', flush=True)


def load_meta() -> dict:
    with open(META, encoding='utf-8') as f:
        return json.load(f)


def three_to_bl(p) -> Vector:
    """three.js 座標 (x, y, z) → Blender 座標 (x, −z, y)"""
    return Vector((p[0], -p[2], p[1]))


def base_key(name: str) -> str:
    """'person.top#2f3b52' → 'person.top'（インスタンス色の派生を元のキーへ）"""
    return name.split('#', 1)[0]


def descendants(ob: bpy.types.Object) -> list[bpy.types.Object]:
    out = []
    stack = [ob]
    while stack:
        o = stack.pop()
        out.append(o)
        stack.extend(o.children)
    return out


def ensure_dir(p: Path) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    return p


def parse_args(argv_extra: list[str] | None = None) -> list[str]:
    """`python script.py -- args` と `python script.py args` の両方を受ける"""
    argv = sys.argv[1:] if argv_extra is None else argv_extra
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    return argv


# ------------------------------------------------------------
# 太陽（方位は北から時計回り、高度は地平から）
# ------------------------------------------------------------


def sun_vector(azimuth_deg: float, elevation_deg: float) -> Vector:
    """Blender 座標で「太陽へ向かう」単位ベクトル（+X=東, +Y=北, +Z=上）"""
    az = math.radians(azimuth_deg)
    el = math.radians(elevation_deg)
    return Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))


def air_mass(elevation_deg: float) -> float:
    """Kasten & Young (1989) の相対エアマス"""
    h = max(elevation_deg, 0.0)
    return 1.0 / (math.sin(math.radians(h)) + 0.50572 * (h + 6.07995) ** -1.6364)


def sun_irradiance_rgb(elevation_deg: float) -> tuple[float, tuple[float, float, float]]:
    """
    直達日射の法線面照度（単位：klx 相当）と色。
    レイリー散乱（τ=0.008735 λ^-4.08）＋ エアロゾル（Ångström β=0.04, α=1.3）を
    R/G/B の代表波長（610/550/465 nm）で評価した簡易モデル。
    """
    m = air_mass(elevation_deg)
    lam = (0.610, 0.550, 0.465)
    t = [math.exp(-m * (0.008735 * l ** -4.08 + 0.04 * l ** -1.3)) for l in lam]
    strength = SUN_E0 * t[1]
    color = tuple(c / t[1] for c in t)
    mx = max(color)
    return strength * mx, tuple(c / mx for c in color)


# ------------------------------------------------------------
# シーン構築
# ------------------------------------------------------------

LAYERS_2F = ('L_structure', 'L_ceiling', 'L_eaves', 'L_furniture', 'L_people')

#: 2F の内容を分けるサブコレクション（インスタンスにもそのまま入る）
SUB_OF_LAYER = {
    'L_structure': 'F2_structure',
    'L_ceiling': 'F2_ceiling',
    'L_eaves': 'F2_eaves',
    'L_furniture': 'F2_furniture',
    'L_people': 'F2_people',
}


class SceneHandles:
    """build_scene が返す、ショットごとの切り替えに使う参照一式"""

    def __init__(self) -> None:
        self.meta: dict = {}
        self.col: dict[str, bpy.types.Collection] = {}
        self.sun: bpy.types.Object | None = None
        self.sky: bpy.types.ShaderNodeTexSky | None = None
        self.background: bpy.types.ShaderNodeBackground | None = None
        self.city_blocks: list[bpy.types.Object] = []
        self.portals: list[bpy.types.Object] = []
        self.variant = ''
        self.material_stats: dict[str, int] = {}
        self.unmatched: list[str] = []


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb() -> None:
    t = time.time()
    bpy.ops.import_scene.gltf(filepath=str(GLB), loglevel=50)
    log(f'glTF 読み込み {time.time() - t:.1f}s（{len(bpy.data.objects)} objects）')


def _new_collection(name: str, parent: bpy.types.Collection) -> bpy.types.Collection:
    c = bpy.data.collections.new(name)
    parent.children.link(c)
    return c


def _move_tree(root: bpy.types.Object, col: bpy.types.Collection) -> None:
    for o in descendants(root):
        for uc in list(o.users_collection):
            uc.objects.unlink(o)
        col.objects.link(o)


def organize_collections(h: SceneHandles) -> None:
    """読み込んだ最上位ノードをコレクションへ振り分ける"""
    sc = bpy.context.scene
    master = sc.collection
    f2 = _new_collection('F2', master)
    h.col['F2'] = f2
    for layer, sub in SUB_OF_LAYER.items():
        c = _new_collection(sub, f2)
        h.col[sub] = c
        _move_tree(bpy.data.objects[layer], c)
    site = _new_collection('Site', master)
    h.col['Site'] = site
    _move_tree(bpy.data.objects['L_site'], site)
    # ゴースト：他階の半透明箱は捨て、周辺街区（ghost.city）だけ実体化する
    ghost = _new_collection('Ghost', master)
    h.col['Ghost'] = ghost
    _move_tree(bpy.data.objects['L_upper'], ghost)
    ghost.hide_render = True
    ghost.hide_viewport = True
    city = _new_collection('City', master)
    h.col['City'] = city
    for o in list(ghost.objects):
        if o.type == 'MESH' and o.data.materials and o.data.materials[0].name == 'ghost.city':
            h.city_blocks = split_city_blocks(o, city)
    for name in ('Upper', 'Roof', 'Lights'):
        h.col[name] = _new_collection(name, master)


def split_city_blocks(src: bpy.types.Object, col: bpy.types.Collection) -> list[bpy.types.Object]:
    """周辺街区（1 メッシュに複数の箱）を連結成分ごとの独立オブジェクトにする（ショットごとに隠せるように）"""
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bm.transform(src.matrix_world)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.faces.ensure_lookup_table()
    seen: set[int] = set()
    blocks = []
    for f in bm.faces:
        if f.index in seen:
            continue
        comp = []
        stack = [f]
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for e in g.edges:
                for n in e.link_faces:
                    if n.index not in seen:
                        seen.add(n.index)
                        stack.append(n)
        blocks.append(comp)
    mat = city_material()
    out = []
    for i, comp in enumerate(blocks):
        nb = bmesh.new()
        vmap = {}
        for f in comp:
            vs = []
            for v in f.verts:
                if v.index not in vmap:
                    vmap[v.index] = nb.verts.new(v.co)
                vs.append(vmap[v.index])
            nb.faces.new(vs)
        me = bpy.data.meshes.new(f'city.{i}')
        nb.to_mesh(me)
        nb.free()
        me.materials.append(mat)
        ob = bpy.data.objects.new(f'city.{i}', me)
        col.objects.link(ob)
        out.append(ob)
    bm.free()
    return out


def build_upper_floors(h: SceneHandles) -> None:
    """3F〜12F：2F コレクションのインスタンスを階高ごとに積む。偶数階は東西反転して変化を付ける"""
    meta = h.meta
    f2f = meta['building']['floorToFloor']
    top_floor = meta['building']['floors']
    for floor in range(3, top_floor + 1):
        e = bpy.data.objects.new(f'F{floor}', None)
        e.instance_type = 'COLLECTION'
        e.instance_collection = h.col['F2']
        e.location = (0, 0, (floor - 2) * f2f)
        if floor % 2 == 0:
            e.scale = (-1, 1, 1)
        h.col['Upper'].objects.link(e)


class BoxBuilder:
    """three.js 座標の軸平行ボックスをマテリアル別メッシュへまとめる"""

    def __init__(self) -> None:
        self.bms: dict[str, bmesh.types.BMesh] = {}

    def box(self, mat: str, x0: float, y0: float, z0: float, x1: float, y1: float, z1: float) -> None:
        bm = self.bms.setdefault(mat, bmesh.new())
        a, b = three_to_bl((x0, y0, z0)), three_to_bl((x1, y1, z1))
        lo = Vector((min(a.x, b.x), min(a.y, b.y), min(a.z, b.z)))
        hi = Vector((max(a.x, b.x), max(a.y, b.y), max(a.z, b.z)))
        res = bmesh.ops.create_cube(bm, size=1.0)
        for v in res['verts']:
            v.co = Vector((
                lo.x if v.co.x < 0 else hi.x,
                lo.y if v.co.y < 0 else hi.y,
                lo.z if v.co.z < 0 else hi.z,
            ))

    def build(self, prefix: str, col: bpy.types.Collection) -> None:
        for mat, bm in self.bms.items():
            me = bpy.data.meshes.new(f'{prefix}:{mat}')
            bm.normal_update()
            bm.to_mesh(me)
            bm.free()
            m = bpy.data.materials.get(mat)
            if m is None:
                raise KeyError(f'マテリアル {mat} が見つからない')
            me.materials.append(m)
            ob = bpy.data.objects.new(f'{prefix}:{mat}', me)
            col.objects.link(ob)
        self.bms.clear()


def build_roof(h: SceneHandles) -> None:
    """
    屋上：13F レベルのスラブ（12F の天井を閉じる）、パラペット、塔屋（最高高さ 62.166 m）と
    設備目隠しルーバー、冷却塔。外装マテリアル（facade.*・alu*）を使う。
    """
    b = h.meta['building']
    P, C = b['plate'], b['core']
    f2f = b['floorToFloor']
    e = 1.2  # 庇の出（spec.ts CW.eave）
    roof = (b['floors'] + 1 - 2) * f2f  # 13F 相当の床レベル（three y）
    top = b['heightFromGround'] + b['groundY']
    bb = BoxBuilder()
    # 屋上スラブと防水押えコンクリート
    bb.box('floor.slabEdge', P['x0'], roof - 0.32, P['z0'], P['x1'], roof - 0.005, P['z1'])
    bb.box('floor.concrete', P['x0'], roof - 0.005, P['z0'], P['x1'], roof + 0.15, P['z1'])
    # パラペット（庇の外周に立ち上げ）
    x0, x1, z0, z1 = P['x0'] - e, P['x1'] + e, P['z0'] - e, P['z1'] + e
    ph = roof + 1.1
    t = 0.25
    for (a0, b0, a1, b1) in ((x0, z0, x1, z0 + t), (x0, z1 - t, x1, z1), (x0, z0, x0 + t, z1), (x1 - t, z0, x1, z1)):
        bb.box('facade.panel', a0, roof - 0.12, b0, a1, ph, b1)
        bb.box('alu', a0 - 0.02, ph, b0 - 0.02, a1 + 0.02, ph + 0.05, b1 + 0.02)
    # 塔屋（コア上部）：外装パネル＋スパンドレル帯、頂部で最高高さ
    px0, px1, pz0, pz1 = C['x0'] + 2, C['x1'] - 2, C['z0'] + 1, C['z1'] - 3
    bb.box('facade.panel', px0, roof, pz0, px1, top - 0.6, pz1)
    bb.box('facade.spandrel', px0 - 0.03, roof + 2.2, pz0 - 0.03, px1 + 0.03, roof + 3.4, pz1 + 0.03)
    bb.box('alu', px0 - 0.15, top - 0.6, pz0 - 0.15, px1 + 0.15, top, pz1 + 0.15)
    # 設備スペースの目隠しルーバー（塔屋の南側、屋上中央）
    sx0, sx1, sz0, sz1 = -24.0, 24.0, pz1 + 1.6, 12.8
    sh = 4.2
    for x in (sx0, sx1):
        bb.box('alu.dark', x - 0.1, roof, sz0, x + 0.1, roof + sh, sz1)
    for z in (sz0, sz1):
        bb.box('alu.dark', sx0, roof, z - 0.1, sx1, roof + sh, z + 0.1)
    # ルーバー羽根（南面・東西面の外側に水平材）
    y = roof + 0.35
    while y < roof + sh - 0.1:
        bb.box('alu', sx0 - 0.25, y, sz1 + 0.1, sx1 + 0.25, y + 0.09, sz1 + 0.25)
        bb.box('alu', sx0 - 0.25, y, sz0, sx0 - 0.1, y + 0.09, sz1 + 0.25)
        bb.box('alu', sx1 + 0.1, y, sz0, sx1 + 0.25, y + 0.09, sz1 + 0.25)
        y += 0.3
    # 冷却塔・室外機（ルーバー内）
    for i, x in enumerate(range(-20, 21, 8)):
        bb.box('steelDoor', x - 3.0, roof + 0.15, sz0 + 1.5, x + 3.0, roof + 2.4 + (i % 2) * 0.6, sz0 + 5.5)
        bb.box('plastic.gray', x - 2.4, roof + 0.15, sz1 - 4.5, x + 2.4, roof + 1.8, sz1 - 1.5)
    bb.build('roof', h.col['Roof'])


def add_portals(h: SceneHandles) -> None:
    """2F の各カーテンウォール面に天空光のポータル（室内側向き）を置く"""
    b = h.meta['building']
    P, C = b['plate'], b['core']
    top = b['ceiling']
    runs = [
        # (中心 three x, z)、内向き（three）、幅
        (((P['x0'] + P['x1']) / 2, P['z1']), (0, 0, -1), P['x1'] - P['x0']),  # 南
        ((P['x1'], (P['z0'] + P['z1']) / 2), (-1, 0, 0), P['z1'] - P['z0']),  # 東
        ((P['x0'], (P['z0'] + P['z1']) / 2), (1, 0, 0), P['z1'] - P['z0']),  # 西
        (((P['x0'] + C['x0']) / 2, P['z0']), (0, 0, 1), C['x0'] - P['x0']),  # 北西
        (((C['x1'] + P['x1']) / 2, P['z0']), (0, 0, 1), P['x1'] - C['x1']),  # 北東
    ]
    for i, ((cx, cz), inward, width) in enumerate(runs):
        L = bpy.data.lights.new(f'portal.{i}', 'AREA')
        L.shape = 'RECTANGLE'
        L.size = width
        L.size_y = top - 0.05
        L.cycles.is_portal = True
        ob = bpy.data.objects.new(f'portal.{i}', L)
        d = three_to_bl(inward)
        ob.location = three_to_bl((cx, (top + 0.05) / 2, cz)) + d * 0.02
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        h.col['Lights'].objects.link(ob)
        h.portals.append(ob)


def build_scene(*, upper: bool = True, variant: str = 'day') -> SceneHandles:
    """シーン一式を構築して参照を返す"""
    h = SceneHandles()
    h.meta = load_meta()
    reset_scene()
    import_glb()
    organize_collections(h)
    if upper:
        build_upper_floors(h)
        build_roof(h)
    upgrade_materials(h)
    add_portals(h)
    setup_world(h)
    set_variant(h, variant)
    setup_color_management()
    log(f'シーン構築完了（マテリアル規則 {sum(h.material_stats.values())} 件適用、未対応 {len(h.unmatched)} 件）')
    return h


# ------------------------------------------------------------
# マテリアル
# ------------------------------------------------------------


def _nodes(mat: bpy.types.Material):
    nt = mat.node_tree
    p = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
    return nt, p, out


def _find_tex(sock: bpy.types.NodeSocket):
    """ソケットの上流をたどって最初の画像テクスチャノードを返す"""
    stack = [sock]
    while stack:
        s = stack.pop()
        for l in s.links:
            n = l.from_node
            if n.type == 'TEX_IMAGE':
                return n
            stack.extend(i for i in n.inputs if i.is_linked)
    return None


def _set(p, **kw) -> None:
    names = {
        'roughness': 'Roughness', 'metallic': 'Metallic', 'ior': 'IOR', 'spec': 'Specular IOR Level',
        'coat': 'Coat Weight', 'coat_rough': 'Coat Roughness', 'sheen': 'Sheen Weight', 'sheen_rough': 'Sheen Roughness',
        'sss': 'Subsurface Weight', 'sss_scale': 'Subsurface Scale', 'transmission': 'Transmission Weight',
        'emission_strength': 'Emission Strength', 'alpha': 'Alpha',
    }
    for k, v in kw.items():
        p.inputs[names[k]].default_value = v


def _base_color(p) -> tuple[float, float, float]:
    return tuple(p.inputs['Base Color'].default_value[:3])


def _bump_from_base(nt, p, strength: float, distance: float) -> None:
    """ベースカラーの画像から微細なバンプ（カーペットの織り目、木目、舗装の目地）"""
    tex = _find_tex(p.inputs['Base Color'])
    if tex is None:
        return
    bw = nt.nodes.new('ShaderNodeRGBToBW')
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = strength
    bump.inputs['Distance'].default_value = distance
    nt.links.new(tex.outputs['Color'], bw.inputs[0])
    nt.links.new(bw.outputs[0], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])


def _replace_surface(nt, out, shader_socket) -> None:
    nt.links.new(shader_socket, out.inputs['Surface'])


def _thin_glass(nt, out, tint, ior: float, rough: float) -> None:
    """
    薄板ガラス：Fresnel で透過（Transparent）と鏡面反射（Glossy）を混ぜる。
    屈折を追わないので影の光線が素通りし、窓越しの直射日光・天空光が室内に届く（ガラス箱 2 面で透過率 ≒ tint²×0.92）。
    """
    fres = nt.nodes.new('ShaderNodeFresnel')
    fres.inputs['IOR'].default_value = ior
    gl = nt.nodes.new('ShaderNodeBsdfGlossy')
    gl.distribution = 'GGX'
    gl.inputs['Roughness'].default_value = rough
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    tr.inputs['Color'].default_value = (*tint, 1.0)
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(fres.outputs['Fac'], mix.inputs['Fac'])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(gl.outputs[0], mix.inputs[2])
    _replace_surface(nt, out, mix.outputs[0])


def _frosted_film(nt, out) -> None:
    """すりガラス調フィルム：拡散透過が主、わずかに素通し、表面はやや粗い鏡面"""
    fres = nt.nodes.new('ShaderNodeFresnel')
    fres.inputs['IOR'].default_value = 1.5
    gl = nt.nodes.new('ShaderNodeBsdfGlossy')
    gl.inputs['Roughness'].default_value = 0.25
    tl = nt.nodes.new('ShaderNodeBsdfTranslucent')
    tl.inputs['Color'].default_value = (0.86, 0.88, 0.88, 1)
    df = nt.nodes.new('ShaderNodeBsdfDiffuse')
    df.inputs['Color'].default_value = (0.82, 0.84, 0.84, 1)
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    m1 = nt.nodes.new('ShaderNodeMixShader')
    m1.inputs['Fac'].default_value = 0.35  # 拡散反射 : 拡散透過
    nt.links.new(tl.outputs[0], m1.inputs[1])
    nt.links.new(df.outputs[0], m1.inputs[2])
    m2 = nt.nodes.new('ShaderNodeMixShader')
    m2.inputs['Fac'].default_value = 0.12  # 素通し
    nt.links.new(m1.outputs[0], m2.inputs[1])
    nt.links.new(tr.outputs[0], m2.inputs[2])
    m3 = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(fres.outputs['Fac'], m3.inputs['Fac'])
    nt.links.new(m2.outputs[0], m3.inputs[1])
    nt.links.new(gl.outputs[0], m3.inputs[2])
    _replace_surface(nt, out, m3.outputs[0])


def _translucent_mix(nt, p, out, amount: float, tint_from_base: bool = True, transparent: float = 0.0) -> None:
    """Principled に拡散透過（葉・ブラインド生地）と、必要なら素通し（開口率）を混ぜる"""
    tl = nt.nodes.new('ShaderNodeBsdfTranslucent')
    if tint_from_base and p.inputs['Base Color'].is_linked:
        nt.links.new(p.inputs['Base Color'].links[0].from_socket, tl.inputs['Color'])
    else:
        c = _base_color(p)
        tl.inputs['Color'].default_value = (*c, 1)
    mix = nt.nodes.new('ShaderNodeMixShader')
    mix.inputs['Fac'].default_value = amount
    nt.links.new(p.outputs[0], mix.inputs[1])
    nt.links.new(tl.outputs[0], mix.inputs[2])
    shader = mix.outputs[0]
    if transparent > 0:
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        m2 = nt.nodes.new('ShaderNodeMixShader')
        m2.inputs['Fac'].default_value = transparent
        nt.links.new(shader, m2.inputs[1])
        nt.links.new(tr.outputs[0], m2.inputs[2])
        shader = m2.outputs[0]
    _replace_surface(nt, out, shader)


def _facing_emission(nt, p, radiance: float, down: float = 1.0, up: float = 0.0, side: float = 0.0) -> None:
    """
    面の向きで発光量を変える（天井照明の箱は下面だけ光らせる）。
    world 法線 Z から：下向き×down、上向き×up、側面×side。
    """
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['True Normal'], sep.inputs[0])

    def clamp01(sock, mul):
        m = nt.nodes.new('ShaderNodeMath')
        m.operation = 'MULTIPLY'
        m.use_clamp = True
        nt.links.new(sock, m.inputs[0])
        m.inputs[1].default_value = mul
        return m.outputs[0]

    dn = clamp01(sep.outputs['Z'], -1.0)  # max(−Nz, 0)
    upv = clamp01(sep.outputs['Z'], 1.0)  # max(Nz, 0)
    # 側面 = 1 − |Nz|
    ab = nt.nodes.new('ShaderNodeMath')
    ab.operation = 'ABSOLUTE'
    nt.links.new(sep.outputs['Z'], ab.inputs[0])
    sd = nt.nodes.new('ShaderNodeMath')
    sd.operation = 'SUBTRACT'
    sd.inputs[0].default_value = 1.0
    nt.links.new(ab.outputs[0], sd.inputs[1])
    acc = None
    for sock, w in ((dn, down), (upv, up), (sd.outputs[0], side)):
        if w <= 0:
            continue
        m = nt.nodes.new('ShaderNodeMath')
        m.operation = 'MULTIPLY'
        nt.links.new(sock, m.inputs[0])
        m.inputs[1].default_value = w * radiance
        if acc is None:
            acc = m.outputs[0]
        else:
            a = nt.nodes.new('ShaderNodeMath')
            a.operation = 'ADD'
            nt.links.new(acc, a.inputs[0])
            nt.links.new(m.outputs[0], a.inputs[1])
            acc = a.outputs[0]
    nt.links.new(acc, p.inputs['Emission Strength'])


# ---- 規則（キー → 関数）。引数：(material, node_tree, principled, output, key) ----


def r_glass_clear(m, nt, p, out, key):
    _thin_glass(nt, out, (0.955, 0.975, 0.97), 1.52, 0.0)


def r_glass_cw(m, nt, p, out, key):
    # Low-E 複層ガラス（1 枚の箱で表現）：やや青緑、反射強め
    _thin_glass(nt, out, (0.84, 0.91, 0.9), 1.85, 0.0)


def r_rail_glass(m, nt, p, out, key):
    _thin_glass(nt, out, (0.93, 0.965, 0.955), 1.52, 0.0)


def r_glass_film(m, nt, p, out, key):
    _frosted_film(nt, out)


def r_water(m, nt, p, out, key):
    _set(p, transmission=1.0, roughness=0.02, ior=1.33, alpha=1.0, metallic=0.0)
    p.inputs['Base Color'].default_value = (0.85, 0.94, 1.0, 1)


def r_led_panel(m, nt, p, out, key):
    p.inputs['Base Color'].default_value = (0.9, 0.9, 0.9, 1)
    _set(p, roughness=0.4)
    _facing_emission(nt, p, LED_RADIANCE, down=1.0)
    m.cycles.emission_sampling = 'FRONT'


def r_led_pendant(m, nt, p, out, key):
    p.inputs['Base Color'].default_value = (0.9, 0.9, 0.9, 1)
    _set(p, roughness=0.4)
    _facing_emission(nt, p, LED_RADIANCE, down=1.0, up=PENDANT_UPLIGHT)
    m.cycles.emission_sampling = 'FRONT'


def r_light_warm(m, nt, p, out, key):
    _set(p, emission_strength=WARM_RADIANCE, roughness=0.4)


def r_status_led(m, nt, p, out, key):
    _set(p, emission_strength=STATUS_LED_RADIANCE, roughness=0.3)


def r_exit_sign(m, nt, p, out, key):
    _set(p, emission_strength=EXIT_SIGN_RADIANCE, roughness=0.3)


def r_screen(m, nt, p, out, key):
    kind = ''.join(ch for ch in key.split('.', 1)[1] if ch.isalpha())
    _set(p, emission_strength=SCREEN_RADIANCE.get(kind, 0.35), roughness=0.22, spec=0.6)


def r_screen_off(m, nt, p, out, key):
    p.inputs['Base Color'].default_value = (0.004, 0.004, 0.005, 1)
    _set(p, metallic=0.0, roughness=0.06, spec=0.7)


def r_sign(m, nt, p, out, key):
    _set(p, emission_strength=SIGN_RADIANCE)


def r_rack_front(m, nt, p, out, key):
    _set(p, emission_strength=RACK_RADIANCE)


def r_plate(m, nt, p, out, key):
    _set(p, emission_strength=PLATE_RADIANCE, roughness=0.35)


def r_carpet(m, nt, p, out, key):
    _set(p, roughness=1.0, spec=0.25, sheen=0.35, sheen_rough=0.5)
    _bump_from_base(nt, p, 0.35, 0.004)


def r_wood_furniture(m, nt, p, out, key):
    # 突板・化粧板：ウレタン塗装のクリアコート
    _set(p, roughness=0.5, coat=0.45, coat_rough=0.12)
    _bump_from_base(nt, p, 0.06, 0.002)


def r_wood_plain(m, nt, p, out, key):
    _set(p, roughness=0.55)
    _bump_from_base(nt, p, 0.08, 0.002)


def r_floor_wood(m, nt, p, out, key):
    _set(p, roughness=0.42, coat=0.3, coat_rough=0.18)
    _bump_from_base(nt, p, 0.1, 0.002)


def r_floor_deck(m, nt, p, out, key):
    _set(p, roughness=0.75)
    _bump_from_base(nt, p, 0.25, 0.004)


def r_stone(m, nt, p, out, key):
    # 本磨きの石：低い粗さ＋薄いコート
    _set(p, roughness=0.14, spec=0.5, coat=0.25, coat_rough=0.05, metallic=0.0)


def r_tile(m, nt, p, out, key):
    _set(p, roughness=0.26, spec=0.5, metallic=0.0)
    _bump_from_base(nt, p, 0.12, 0.002)


def r_vinyl(m, nt, p, out, key):
    _set(p, roughness=0.38, spec=0.45)


def r_top_white(m, nt, p, out, key):
    _set(p, roughness=0.32, coat=0.15, coat_rough=0.2)


def r_top_stone(m, nt, p, out, key):
    _set(p, roughness=0.12, coat=0.3, coat_rough=0.05)


def _metal(p, color, rough):
    p.inputs['Base Color'].default_value = (*color, 1)
    _set(p, metallic=1.0, roughness=rough)


def r_alu(m, nt, p, out, key):
    _metal(p, (0.80, 0.81, 0.82), 0.32)


def r_alu_dark(m, nt, p, out, key):
    _metal(p, (0.11, 0.115, 0.12), 0.36)


def r_stainless(m, nt, p, out, key):
    _metal(p, (0.66, 0.65, 0.63), 0.22)


def r_chrome(m, nt, p, out, key):
    _metal(p, (0.78, 0.79, 0.80), 0.05)


def r_frame_silver(m, nt, p, out, key):
    _metal(p, (0.70, 0.71, 0.72), 0.3)


def r_mirror(m, nt, p, out, key):
    _metal(p, (0.93, 0.94, 0.94), 0.0)


def r_painted_metal(m, nt, p, out, key):
    # 焼付塗装（スチール家具・扉・フレーム）：誘電体＋薄いコート
    _set(p, metallic=0.0, roughness=0.38, coat=0.2, coat_rough=0.25)


def r_fabric(m, nt, p, out, key):
    _set(p, roughness=1.0, spec=0.2, sheen=0.7, sheen_rough=0.35, metallic=0.0)


def r_leather(m, nt, p, out, key):
    _set(p, roughness=0.45, spec=0.4, coat=0.1, coat_rough=0.3)


def r_skin(m, nt, p, out, key):
    _set(p, roughness=0.5, sss=0.15, sss_scale=0.006, spec=0.4)
    p.inputs['Subsurface Radius'].default_value = (1.0, 0.35, 0.2)


def r_hair(m, nt, p, out, key):
    _set(p, roughness=0.45, spec=0.5, sheen=0.3, sheen_rough=0.3)


def r_eye(m, nt, p, out, key):
    _set(p, roughness=0.08, coat=0.8, coat_rough=0.02)


def r_leaf(m, nt, p, out, key):
    _set(p, roughness=0.55, spec=0.4)
    _translucent_mix(nt, p, out, 0.3)


def r_moss(m, nt, p, out, key):
    _set(p, roughness=1.0, spec=0.2, sheen=0.4)
    _bump_from_base(nt, p, 0.5, 0.01)


def r_blind(m, nt, p, out, key):
    # ロールスクリーン（開口率 5% 程度のスクリーン生地）：拡散透過＋わずかな素通し
    _set(p, roughness=1.0, spec=0.15, alpha=1.0)
    if p.inputs['Alpha'].is_linked:
        nt.links.remove(p.inputs['Alpha'].links[0])
    _translucent_mix(nt, p, out, 0.45, transparent=0.06)


def r_ceramic(m, nt, p, out, key):
    _set(p, roughness=0.06, coat=0.6, coat_rough=0.02, spec=0.5)


def r_whiteboard(m, nt, p, out, key):
    _set(p, roughness=0.12, coat=0.6, coat_rough=0.04)


def r_plastic(m, nt, p, out, key):
    _set(p, roughness=0.42, spec=0.5, metallic=0.0)


def r_paint_wall(m, nt, p, out, key):
    # つや消し塗装（EP）
    _set(p, roughness=0.88, spec=0.35, metallic=0.0)


def r_facade_panel(m, nt, p, out, key):
    # アルミ複合パネル（フッ素樹脂焼付）
    _set(p, metallic=0.0, roughness=0.34, coat=0.35, coat_rough=0.1)


def r_spandrel(m, nt, p, out, key):
    # スパンドレルガラス（不透明の濃色ガラス）：強い鏡面
    p.inputs['Base Color'].default_value = (0.018, 0.022, 0.026, 1)
    _set(p, metallic=0.0, roughness=0.04, spec=1.0, coat=1.0, coat_rough=0.02)


def r_facade_stone(m, nt, p, out, key):
    _set(p, roughness=0.55, spec=0.4)


def r_soffit(m, nt, p, out, key):
    _set(p, roughness=0.6)
    _bump_from_base(nt, p, 0.08, 0.002)


def r_asphalt(m, nt, p, out, key):
    _set(p, roughness=0.92, spec=0.3)
    _bump_from_base(nt, p, 0.4, 0.01)


def r_paving(m, nt, p, out, key):
    _set(p, roughness=0.8, spec=0.35)
    _bump_from_base(nt, p, 0.35, 0.006)


def r_concrete(m, nt, p, out, key):
    _set(p, roughness=0.85, spec=0.3)


def r_matte(m, nt, p, out, key):
    _set(p, roughness=0.9, spec=0.3, metallic=0.0)


RULES_EXACT = {
    'glass': r_glass_clear,
    'glass.cw': r_glass_cw,
    'rail.glass': r_rail_glass,
    'glass.film': r_glass_film,
    'water': r_water,
    'light.panel': r_led_panel,
    'light.warm': r_light_warm,
    'light.led': r_status_led,
    'light.ledBlue': r_status_led,
    'light.ledRed': r_status_led,
    'exitSign': r_exit_sign,
    'screen.off': r_screen_off,
    'sign.text': r_sign,
    'rack.front': r_rack_front,
    'rack.body': r_painted_metal,
    'floor.wood': r_floor_wood,
    'floor.deck': r_floor_deck,
    'floor.stone': r_stone,
    'floor.stoneDark': r_stone,
    'floor.tile': r_tile,
    'floor.vinyl': r_vinyl,
    'floor.concrete': r_concrete,
    'floor.slabEdge': r_concrete,
    'wall.white': r_paint_wall,
    'wall.core': r_paint_wall,
    'wall.movable': r_paint_wall,
    'wall.wood': r_wood_plain,
    'wall.moss': r_moss,
    'wall.acoustic': r_fabric,
    'wall.wcTile': r_tile,
    'ceiling': r_matte,
    'door.wood': r_wood_furniture,
    'wood.light': r_wood_furniture,
    'wood.mid': r_wood_furniture,
    'wood.dark': r_wood_furniture,
    'top.white': r_top_white,
    'top.stone': r_top_stone,
    'alu': r_alu,
    'alu.dark': r_alu_dark,
    'steel': r_painted_metal,
    'steelDoor': r_painted_metal,
    'stainless': r_stainless,
    'chrome': r_chrome,
    'frame.white': r_painted_metal,
    'frame.black': r_painted_metal,
    'frame.silver': r_frame_silver,
    'locker': r_painted_metal,
    'locker.side': r_painted_metal,
    'mirror': r_mirror,
    'ceramic': r_ceramic,
    'pot.white': r_ceramic,
    'whiteboard.plain': r_whiteboard,
    'mesh.black': r_fabric,
    'leather.black': r_leather,
    'person.skin': r_skin,
    'person.hair': r_hair,
    'person.hairFixed': r_hair,
    'person.eye': r_eye,
    'person.top': r_fabric,
    'person.bottom': r_fabric,
    'chair.fabric': r_fabric,
    'leaf': r_leaf,
    'leaf.dark': r_leaf,
    'hedge': r_leaf,
    'grass': r_matte,
    'blind': r_blind,
    'facade.panel': r_facade_panel,
    'facade.spandrel': r_spandrel,
    'facade.stone': r_facade_stone,
    'facade.soffit': r_soffit,
    'asphalt': r_asphalt,
    'paving': r_paving,
    'ground': r_matte,
}

#: 前方一致（長いものから評価）
RULES_PREFIX = [
    ('floor.carpet', r_carpet),
    ('screen.', r_screen),
    ('whiteboard', r_whiteboard),
    ('fabric.', r_fabric),
    ('felt.', r_fabric),
    ('plastic.', r_plastic),
    ('plate.', r_plate),
    ('light.panel.pendant', r_led_pendant),
]


def rule_for(key: str):
    if key in RULES_EXACT:
        return RULES_EXACT[key]
    for pre, fn in sorted(RULES_PREFIX, key=lambda t: -len(t[0])):
        if key.startswith(pre):
            return fn
    return None


def split_pendant_material() -> None:
    """吊り下げ型ライン照明だけ上向き成分を持たせるため、専用マテリアルに差し替える"""
    src = bpy.data.materials.get('light.panel')
    if src is None:
        return
    pend = src.copy()
    pend.name = 'light.panel.pendant'
    for o in bpy.data.objects:
        if o.type == 'MESH' and 'linearPendant' in (o.parent.name if o.parent else '') + o.name:
            for i, m in enumerate(o.data.materials):
                if m == src:
                    o.data.materials[i] = pend


def upgrade_materials(h: SceneHandles) -> None:
    split_pendant_material()
    for m in bpy.data.materials:
        if not m.use_nodes or m.name.startswith('ghost') or m.name == 'city':
            continue
        key = base_key(m.name)
        fn = rule_for(key)
        if fn is None:
            h.unmatched.append(m.name)
            continue
        nt, p, out = _nodes(m)
        if p is None or out is None:
            h.unmatched.append(m.name)
            continue
        fn(m, nt, p, out, key)
        h.material_stats[fn.__name__] = h.material_stats.get(fn.__name__, 0) + 1
    if h.unmatched:
        log('規則なし（読み込み時の設定のまま）: ' + ', '.join(sorted(h.unmatched)))


def city_material() -> bpy.types.Material:
    """
    周辺街区の外装：ワールド座標から階（3.8 m）とマリオン（1.5 m）の格子を作り、
    スパンドレル帯・濃色ガラス・一部点灯した窓・屋上面を塗り分ける。
    """
    m = bpy.data.materials.new('city')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    N = nt.nodes.new
    L = nt.links.new
    out = N('ShaderNodeOutputMaterial')
    geo = N('ShaderNodeNewGeometry')
    pos = N('ShaderNodeSeparateXYZ')
    nrm = N('ShaderNodeSeparateXYZ')
    L(geo.outputs['Position'], pos.inputs[0])
    L(geo.outputs['True Normal'], nrm.inputs[0])

    def math(op, a, b=None, clamp=False):
        n = N('ShaderNodeMath')
        n.operation = op
        n.use_clamp = clamp
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L(v, n.inputs[i])
        return n.outputs[0]

    # 面に沿った水平座標 u = x|ny| + y|nx|
    u = math('ADD', math('MULTIPLY', pos.outputs['X'], math('ABSOLUTE', nrm.outputs['Y'])),
             math('MULTIPLY', pos.outputs['Y'], math('ABSOLUTE', nrm.outputs['X'])))
    zf = math('DIVIDE', math('ADD', pos.outputs['Z'], 5.6), 3.8)
    uf = math('DIVIDE', u, 1.5)
    band = math('LESS_THAN', math('FRACT', zf), 0.32)  # 1 = スパンドレル帯
    mull = math('LESS_THAN', math('FRACT', uf), 0.06)  # 1 = マリオン
    opaque = math('MAXIMUM', band, mull)
    roof = math('GREATER_THAN', nrm.outputs['Z'], 0.5)
    # 窓ごとの乱数で点灯を決める
    cell = N('ShaderNodeCombineXYZ')
    L(math('FLOOR', uf), cell.inputs['X'])
    L(math('FLOOR', zf), cell.inputs['Y'])
    L(math('ROUND', math('MULTIPLY', nrm.outputs['X'], 3.0)), cell.inputs['Z'])
    wn = N('ShaderNodeTexWhiteNoise')
    wn.noise_dimensions = '3D'
    L(cell.outputs[0], wn.inputs['Vector'])
    lit = math('GREATER_THAN', wn.outputs['Value'], 0.45)

    glass = N('ShaderNodeBsdfPrincipled')
    glass.inputs['Base Color'].default_value = (0.02, 0.03, 0.035, 1)
    glass.inputs['Roughness'].default_value = 0.05
    glass.inputs['Specular IOR Level'].default_value = 1.0
    glass.inputs['Coat Weight'].default_value = 1.0
    glass.inputs['Emission Color'].default_value = (1.0, 0.93, 0.82, 1)
    L(math('MULTIPLY', lit, CITY_WINDOW_RADIANCE), glass.inputs['Emission Strength'])
    wall = N('ShaderNodeBsdfPrincipled')
    wall.inputs['Base Color'].default_value = (0.55, 0.54, 0.51, 1)
    wall.inputs['Roughness'].default_value = 0.55
    top = N('ShaderNodeBsdfPrincipled')
    top.inputs['Base Color'].default_value = (0.35, 0.35, 0.34, 1)
    top.inputs['Roughness'].default_value = 0.9
    m1 = N('ShaderNodeMixShader')
    L(opaque, m1.inputs['Fac'])
    L(glass.outputs[0], m1.inputs[1])
    L(wall.outputs[0], m1.inputs[2])
    m2 = N('ShaderNodeMixShader')
    L(roof, m2.inputs['Fac'])
    L(m1.outputs[0], m2.inputs[1])
    L(top.outputs[0], m2.inputs[2])
    L(m2.outputs[0], out.inputs['Surface'])
    return m


# ------------------------------------------------------------
# 照明（天空・太陽）とバリアント
# ------------------------------------------------------------

#: バリアント：meta.sun のキー、天空の強さ、太陽ランプの有無
VARIANTS = {
    'day': {'sun': 'default', 'sky': 1.0, 'lamp': True},
    'afternoon': {'sun': 'afternoon', 'sky': 1.0, 'lamp': True},
    # 夕景（17:18、太陽高度 1.6°）：天空を暗めにして室内照明を主役にする
    'dusk': {'sun': 'dusk', 'sky': 0.18, 'lamp': True},
    # ライトマップ用：天空光のみ（直達日射はブラウザ側でリアルタイムに与える）。天空の分布は 10:30
    'bake': {'sun': 'default', 'sky': 1.0, 'lamp': False},
}


def setup_world(h: SceneHandles) -> None:
    sc = bpy.context.scene
    w = bpy.data.worlds.new('sky')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    sky = nt.nodes.new('ShaderNodeTexSky')
    sky.sky_type = 'NISHITA'
    sky.sun_disc = False
    sky.altitude = 40.0
    sky.air_density = 1.0
    sky.dust_density = 1.0
    sky.ozone_density = 1.0
    nt.links.new(sky.outputs['Color'], bg.inputs['Color'])
    h.sky, h.background = sky, bg
    L = bpy.data.lights.new('sun', 'SUN')
    L.angle = math.radians(0.53)
    ob = bpy.data.objects.new('sun', L)
    h.col['Lights'].objects.link(ob)
    h.sun = ob


def set_variant(h: SceneHandles, variant: str) -> None:
    v = VARIANTS[variant]
    s = h.meta['sun'][v['sun']]
    az, el = s['azimuth'], s['elevation']
    # Nishita の sun_rotation は北（+Y）から東回りの方位そのもの（verify.py で確認済み）
    h.sky.sun_elevation = math.radians(el)
    h.sky.sun_rotation = math.radians(az)
    h.background.inputs['Strength'].default_value = v['sky']
    h.sun.hide_render = not v['lamp']
    strength, color = sun_irradiance_rgb(el)
    h.sun.data.energy = strength
    h.sun.data.color = color
    # ランプの −Z を太陽から来る向きへ（+Z が太陽方向）
    h.sun.rotation_euler = sun_vector(az, el).to_track_quat('Z', 'Y').to_euler()
    h.variant = variant
    log(f'バリアント {variant}: 方位 {az:.1f}° 高度 {el:.1f}°、太陽 {strength:.1f} klx {tuple(round(c, 3) for c in color)}'
        f'{"" if v["lamp"] else "（ランプなし）"}、天空 ×{v["sky"]}')


# ------------------------------------------------------------
# 表示の切り替え
# ------------------------------------------------------------


def set_visibility(h: SceneHandles, *, hide: tuple[str, ...] = (), camera_pos: Vector | None = None) -> None:
    """
    hide：'ceiling'（天井面・天井設備）, 'eaves', 'upper'（3F 以上）, 'roof', 'people', 'furniture', 'site', 'city'
    camera_pos：この点を含む街区の箱は隠す（外観カメラが周辺街区の中に入る場合）
    """
    names = {
        'ceiling': ['F2_ceiling'], 'eaves': ['F2_eaves'], 'upper': ['Upper'], 'roof': ['Roof'],
        'people': ['F2_people'], 'furniture': ['F2_furniture'], 'site': ['Site'], 'city': ['City'],
    }
    for key, cols in names.items():
        for c in cols:
            h.col[c].hide_render = key in hide
    for ob in h.city_blocks:
        inside = False
        if camera_pos is not None:
            bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
            lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
            hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
            inside = all(lo[i] - 2.0 <= camera_pos[i] <= hi[i] + 2.0 for i in range(3))
        ob.hide_render = inside


# ------------------------------------------------------------
# カメラ
# ------------------------------------------------------------


def make_camera(name: str, pos3, tgt3, fov_deg: float, *, two_point: bool = False) -> bpy.types.Object:
    """
    three.js のカメラ（pos/target、縦画角 fov）から Blender のカメラを作る。
    two_point=True：カメラを水平に据え、上下はレンズシフトで合わせる（建築写真の 2 点透視）。
    """
    sc = bpy.context.scene
    cam = bpy.data.cameras.get(name) or bpy.data.cameras.new(name)
    ob = bpy.data.objects.get(name)
    if ob is None:
        ob = bpy.data.objects.new(name, cam)
        sc.collection.objects.link(ob)
    cam.type = 'PERSP'
    cam.sensor_fit = 'VERTICAL'
    cam.sensor_height = 24.0
    cam.lens = cam.sensor_height / 2 / math.tan(math.radians(fov_deg) / 2)
    cam.clip_start = 0.05
    cam.clip_end = 2000.0
    p = three_to_bl(pos3)
    d = three_to_bl(tgt3) - p
    cam.shift_x = cam.shift_y = 0.0
    if two_point:
        horiz = Vector((d.x, d.y, 0.0))
        pitch = math.atan2(d.z, horiz.length)
        # シフト量（縦フィットでは画像の高さ単位）：tan(pitch) = 2·shift·tan(fov/2)
        cam.shift_y = math.tan(pitch) / (2 * math.tan(math.radians(fov_deg) / 2))
        d = horiz
    ob.location = p
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = ob
    return ob


def make_ortho_top(name: str, center3, width_m: float, height_z: float = 60.0) -> bpy.types.Object:
    """真上からの正投影（画像の上 = 北）。center3 は three.js 座標の (x, y, z)"""
    sc = bpy.context.scene
    cam = bpy.data.cameras.get(name) or bpy.data.cameras.new(name)
    ob = bpy.data.objects.get(name)
    if ob is None:
        ob = bpy.data.objects.new(name, cam)
        sc.collection.objects.link(ob)
    cam.type = 'ORTHO'
    cam.sensor_fit = 'HORIZONTAL'
    cam.ortho_scale = width_m
    cam.clip_start = 0.1
    cam.clip_end = 500.0
    c = three_to_bl(center3)
    ob.location = (c.x, c.y, height_z)
    ob.rotation_euler = (0.0, 0.0, 0.0)
    sc.camera = ob
    return ob


def make_pano_camera(name: str, pos3, heading_deg: float) -> bpy.types.Object:
    """
    正距円筒パノラマ。画像中央 = 方位 heading_deg（北から時計回り）、右へ行くほど時計回り（内側から見た向き）、上端 = 天頂。
    Cycles の正距円筒はカメラのローカル −Z… ではなく +X を中央に取るため、verify.py で確かめた回転を与える。
    """
    sc = bpy.context.scene
    cam = bpy.data.cameras.get(name) or bpy.data.cameras.new(name)
    ob = bpy.data.objects.get(name)
    if ob is None:
        ob = bpy.data.objects.new(name, cam)
        sc.collection.objects.link(ob)
    cam.type = 'PANO'
    cam.panorama_type = 'EQUIRECTANGULAR'
    cam.clip_start = 0.05
    cam.clip_end = 2000.0
    cam.shift_x = cam.shift_y = 0.0
    ob.location = three_to_bl(pos3)
    ob.rotation_euler = pano_rotation(heading_deg)
    sc.camera = ob
    return ob


def pano_rotation(heading_deg: float):
    """正距円筒カメラの回転（画像中央を heading、上を +Z に向ける）"""
    # Cycles の正距円筒：カメラ空間の +X が画像中央、+Z が上端、+Y が画像の左 1/4
    # → ワールドでは中央方向 f、上 +Z、左 = f を反時計回りに 90° 回した向き
    f = sun_vector(heading_deg, 0.0)
    up = Vector((0.0, 0.0, 1.0))
    left = up.cross(f)
    m = Matrix((f, left, up)).transposed()
    return m.to_euler()


# ------------------------------------------------------------
# レンダー設定
# ------------------------------------------------------------


def setup_color_management(ev: float = 0.0, look: str = 'AgX - Medium High Contrast') -> None:
    vs = bpy.context.scene.view_settings
    bpy.context.scene.display_settings.display_device = 'sRGB'
    vs.view_transform = 'AgX'
    vs.look = look
    vs.exposure = ev
    vs.gamma = 1.0


def setup_cycles(samples: int, *, threshold: float = 0.02, denoise: bool = True, ev: float = 0.0,
                 clamp_display: float = 30.0, guiding: bool = True) -> None:
    """
    Cycles CPU。clamp_display は露出後（表示基準）の間接光クランプ値：
    シーン単位では clamp_display × 2^(−EV)。露出の違う屋内外で同じ効き方になる。
    """
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    c = sc.cycles
    c.device = 'CPU'
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = threshold
    c.adaptive_min_samples = 0
    c.use_denoising = denoise
    c.denoiser = 'OPENIMAGEDENOISE'
    c.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    c.denoising_prefilter = 'ACCURATE'
    c.denoising_quality = 'HIGH'
    c.use_light_tree = True
    c.max_bounces = 12
    c.diffuse_bounces = 4
    c.glossy_bounces = 4
    c.transmission_bounces = 8
    c.transparent_max_bounces = 32
    c.volume_bounces = 0
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.blur_glossy = 1.0
    c.sample_clamp_direct = 0.0
    c.sample_clamp_indirect = clamp_display * 2.0 ** (-ev)
    c.use_guiding = guiding
    c.use_surface_guiding = guiding
    c.use_volume_guiding = False
    c.use_auto_tile = True
    c.tile_size = 1024
    c.seed = 7
    sc.render.use_persistent_data = True
    sc.render.film_transparent = False
    sc.render.filter_size = 1.5
    sc.render.threads_mode = 'AUTO'
    sc.render.use_motion_blur = False


def set_resolution(w: int, h: int) -> None:
    r = bpy.context.scene.render
    r.resolution_x = w
    r.resolution_y = h
    r.resolution_percentage = 100
    r.pixel_aspect_x = r.pixel_aspect_y = 1.0


def render_to(path: Path, fmt: str = 'PNG') -> float:
    """現在のカメラでレンダーして保存。所要秒を返す"""
    sc = bpy.context.scene
    s = sc.render.image_settings
    if fmt == 'EXR':
        s.file_format = 'OPEN_EXR'
        s.color_depth = '32'
        s.exr_codec = 'ZIP'
    else:
        s.file_format = 'PNG'
        s.color_depth = '8'
        s.color_mode = 'RGB'
        s.compression = 15
    sc.render.filepath = str(path)
    t = time.time()
    bpy.ops.render.render(write_still=True)
    return time.time() - t


def load_exr(path: Path):
    """EXR を numpy (h, w, 4) float32 で読む（行 0 = 画像の下端、Blender 流）"""
    import numpy as np

    im = bpy.data.images.load(str(path), check_existing=False)
    w, hh = im.size
    a = np.empty(w * hh * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    bpy.data.images.remove(im)
    return a.reshape(hh, w, 4)


def write_json(path: Path, data) -> None:
    ensure_dir(path.parent)
    tmp = path.with_suffix(path.suffix + '.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
    os.replace(tmp, path)
