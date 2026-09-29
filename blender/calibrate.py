# -*- coding: utf-8 -*-
"""
照度の校正：机上面（FL+0.75 m）などに小さな水平プローブ面を置き、Diffuse をベイクして照度を測る。
  照度 E = π × ベイク値（単位 1.0 ≒ 1,000 lx。common.py 冒頭の約束）

  .venv-blender/bin/python blender/calibrate.py [--samples 512] [--variants night,bake,day]

night（室内照明のみ）で LED_RADIANCE を「執務エリア中央の机上 ≒ 750 lx」に合わせ、
bake（天空光＋室内照明）と day（＋直射日光）は参考値として README に記録する。
"""

import argparse
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as C  # noqa: E402

import bpy  # noqa: E402
import bmesh  # noqa: E402

#: 測定点（three.js の x, z）と高さ、名前
PROBES = [
    ('IT南 中央 机上', 25.0, 14.5, 0.75),
    ('IT南 通路 机上高', 19.6, 14.0, 0.75),
    ('IT南 窓から 1 m 机上高', 25.0, 18.2, 0.75),
    ('IT東 中央 机上', 31.0, -4.0, 0.75),
    ('リスク南 中央 机上', -25.0, 14.5, 0.75),
    ('リスク西 中央 机上', -31.0, -4.0, 0.75),
    ('ラウンジ 中央', 0.0, 14.0, 0.75),
    ('エントランス 床', 0.0, 6.0, 0.02),
    ('SOC 中央 机上', 20.8, -15.8, 0.75),
    ('IT南 中央 床', 25.0, 14.5, 0.02),
]
CELL = 16  # 1 プローブあたりの画素（一辺）
SIZE = 0.12  # プローブ面の一辺（m）


def make_probes(col: bpy.types.Collection, probes: list[tuple]) -> tuple[bpy.types.Object, int]:
    """probes（名前, three の x, z, 高さ）ごとに上向きの小さな正方形を置き、1 枚の画像にセルを並べた UV を張る"""
    grid = math.ceil(math.sqrt(len(probes)))
    res = grid * CELL
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    for i, (_, x, z, y) in enumerate(probes):
        c = C.three_to_bl((x, y, z))
        vs = [bm.verts.new((c.x + dx * SIZE / 2, c.y + dy * SIZE / 2, c.z)) for dx, dy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        f = bm.faces.new(vs)
        gx, gy = i % grid, i // grid
        for loop, (dx, dy) in zip(f.loops, ((-1, -1), (1, -1), (1, 1), (-1, 1))):
            # セルの内側 1 px を残して UV を張る（縁の補間を避ける）
            u = (gx * CELL + 1 + (dx + 1) / 2 * (CELL - 2)) / res
            v = (gy * CELL + 1 + (dy + 1) / 2 * (CELL - 2)) / res
            loop[uv].uv = (u, v)
    me = bpy.data.meshes.new('probes')
    bm.to_mesh(me)
    bm.free()
    m = bpy.data.materials.new('probe')
    m.use_nodes = True
    me.materials.append(m)
    ob = bpy.data.objects.new('probes', me)
    col.objects.link(ob)
    return ob, res


def measure(probe: bpy.types.Object, res: int, samples: int, count: int) -> list[float]:
    """make_probes で作った count 個のプローブの照度（lx）"""
    im = C.new_float_image('probe_bake', res, res, 0.0)
    dt = C.bake_diffuse([probe], im, samples, margin=0)
    a = C.image_array(im)
    bpy.data.images.remove(im)
    grid = math.ceil(math.sqrt(count))
    out = []
    for i in range(count):
        gx, gy = i % grid, i // grid
        cell = a[gy * CELL + 2:(gy + 1) * CELL - 2, gx * CELL + 2:(gx + 1) * CELL - 2, :3]
        lum = cell @ [0.2126, 0.7152, 0.0722]
        out.append(float(lum.mean()) * math.pi * 1000.0)  # lx
    C.log(f'  ベイク {dt:.1f}s')
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--samples', type=int, default=1024)
    ap.add_argument('--variants', default='night,bake,day')
    args = ap.parse_args(C.parse_args())
    h = C.build_scene(variant='night')
    C.set_visibility(h, hide=('upper',))
    probe_col = bpy.data.collections.new('Probe')
    bpy.context.scene.collection.children.link(probe_col)
    probe, res = make_probes(probe_col, PROBES)
    table = {}
    for v in args.variants.split(','):
        C.set_variant(h, v)
        table[v] = measure(probe, res, args.samples, len(PROBES))
    names = [p[0] for p in PROBES]
    print('\n照度（lx）  LED_RADIANCE=%.1f' % C.LED_RADIANCE)
    print('%-22s' % '測定点' + ''.join('%10s' % v for v in table))
    for i, n in enumerate(names):
        print('%-22s' % n + ''.join('%10.0f' % table[v][i] for v in table))
    out = {'led_radiance': C.LED_RADIANCE, 'samples': args.samples,
           'probes': [{'name': n, 'x': p[1], 'z': p[2], 'y': p[3], **{v: round(table[v][i]) for v in table}}
                      for i, (n, p) in enumerate(zip(names, PROBES))]}
    C.write_json(C.ensure_dir(C.OUT) / 'calibration.json', out)


if __name__ == '__main__':
    main()
