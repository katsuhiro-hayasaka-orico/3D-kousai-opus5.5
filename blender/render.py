# -*- coding: utf-8 -*-
"""
Cycles の静止画・360° パノラマ（docs/GRAPHICS-PIPELINE.md §5）。

  .venv-blender/bin/python blender/render.py --shots all|id,id --quality preview|final [--samples N] [--scale S]
  .venv-blender/bin/python blender/render.py --list

  .venv-blender/bin/python blender/render.py --resave [--shots ...]   （PNG から JPEG を作り直すだけ）
  .venv-blender/bin/python blender/render.py --shots remaining --quality final   （中断からの再開：未完成のショットだけ）

  出力：Web 版に同梱する縮小版 src/assets/renders/<id>.jpg（静止画 1600 px 幅、パノラマ 3072 px 幅）と
        <id>_thumb.jpg（480 px 幅）、renders.json（部分実行でも追記・更新）。パノラマのファイル名は pano_<場所>.jpg。
        final 品質では原寸（1920×1080、パノラマ 4096×2048）を docs/renders/ にも保存する。
  中間の PNG（原寸）は blender/out/renders/。
"""

import argparse
import json
import math
import sys
import time
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import common as C  # noqa: E402

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

# 露出（EV）。室内は机上 750 lx の白い天板が明るめの中間調に、外観は晴天の直射面が白飛びしない程度に
EV_INTERIOR = 1.6
EV_EXTERIOR = -4.2
EV_DUSK = 0.3
#: レンズの滲み（室内・夕景の照明器具や明るい窓）
BLOOM = 0.12
#: カメラの目の前に立つ人を隠す半径（m）：静止画・パノラマ。パノラマは座っている人も 1.2 m 以内なら隠す
PEOPLE_RADIUS = {'still': 2.5, 'pano': 1.5}
SEATED_RADIUS_PANO = 1.2
#: 室内：上階インスタンスの代わりに 3F スラブの蓋（common.build_cap）
HIDE_INTERIOR = ('upper',)
#: 天井・庇・上階・周辺街区を外した見下ろし（アクソメ・平面図）
HIDE_CUTAWAY = ('ceiling', 'eaves', 'upper', 'cap', 'city')


@dataclass
class Shot:
    id: str
    title: str
    preset: str | None
    kind: str = 'still'  # still | pano | plan
    variant: str = 'day'
    ev: float = EV_INTERIOR
    two_point: bool = True
    exterior: bool = False
    hide: tuple = HIDE_INTERIOR
    pos: tuple | None = None  # パノラマの位置（three.js の x, z）
    bloom: float = BLOOM  # レンズの滲みの強さ（common.setup_compositor）。晴天の外観は 0
    tree_radius: float = 0.0  # カメラからこの距離（m）以内の樹木を隠す
    fov: float | None = None  # プリセットの縦画角を置き換える
    shift: float = 0.0  # 上下のレンズシフトの追加量（画像の高さ単位）
    note: str = ''


SHOTS = [
    Shot('ext-se-day', '外観 南東から（10:30）', '南東から', variant='day', ev=EV_EXTERIOR, exterior=True, hide=(),
         bloom=0.0, shift=0.12, note='手前の周辺街区（概略の箱）は視線を遮るため非表示'),
    Shot('ext-se-dusk', '外観 南東から（夕景 17:18）', '南東から', variant='dusk', ev=EV_DUSK, exterior=True, hide=(),
         shift=0.12, note='手前の周辺街区（概略の箱）は視線を遮るため非表示'),
    Shot('ext-street', '新宿通り 歩道から', '新宿通り 歩道', variant='day', ev=EV_EXTERIOR, exterior=True, hide=(),
         bloom=0.0, two_point=False, tree_radius=7.0, note='カメラの目の前の街路樹（低ポリゴン）は非表示'),
    Shot('balcony', '2F 南面バルコニー', '2F バルコニー', variant='day', ev=EV_EXTERIOR + 0.6, exterior=True, hide=(),
         bloom=0.0),
    Shot('ev-hall', 'EVホール → 入口', 'EVホール → 入口'),
    Shot('entrance', 'エントランス・受付', 'エントランス受付'),
    Shot('lounge', 'コミュニケーションラウンジ', 'ラウンジ'),
    Shot('it-south', 'IT・システムG 執務エリア（南）', 'IT 執務（南）'),
    Shot('it-east', 'IT・システムG 執務エリア（東）', 'IT 執務（東）'),
    Shot('soc', 'セキュリティ監視室（SOC/CSIRT）', 'SOC', ev=EV_INTERIOR + 0.3),
    Shot('lab', '検証ラボ', '検証ラボ'),
    Shot('agile', 'アジャイル開発エリア', 'アジャイル開発'),
    Shot('risk-south', 'リスク管理G 執務エリア（南）', 'リスク管理 執務'),
    Shot('monitoring', 'モニタリングルーム', 'モニタリング室', ev=EV_INTERIOR + 0.3),
    Shot('meeting-a', '大会議室 A', '大会議室 A'),
    Shot('booths', '集中エリア・Webブース列（IT）', 'Webブース列'),
    Shot('axo', '全体アクソメ（天井・上階を外して俯瞰）', '全体俯瞰', ev=EV_EXTERIOR + 0.5, two_point=False, bloom=0.0,
         hide=HIDE_CUTAWAY, fov=30.0, note='天井・天井設備・庇・上階・周辺街区を非表示。画角はプリセット（45°）より狭い 30°'),
    Shot('plan', '平面図（真上からの正投影）', None, kind='plan', ev=EV_EXTERIOR + 0.5, hide=HIDE_CUTAWAY, bloom=0.0,
         note='天井・天井設備・庇・上階・周辺街区を非表示。画像の上が北'),
    # 360° パノラマ（目線 1.55 m、画像中央はプリセットの向き）
    Shot('pano-entrance', 'エントランス・受付 360°', 'エントランス受付', kind='pano', pos=(0.0, 6.4)),
    Shot('pano-lounge', 'コミュニケーションラウンジ 360°', 'ラウンジ', kind='pano', pos=(2.0, 13.5)),
    Shot('pano-it-south', 'IT・システムG 執務エリア（南）360°', 'IT 執務（南）', kind='pano', pos=(25.0, 14.5)),
    Shot('pano-soc', 'セキュリティ監視室（SOC/CSIRT）360°', 'SOC', kind='pano', pos=(20.8, -14.4), ev=EV_INTERIOR + 0.3),
    Shot('pano-risk-south', 'リスク管理G 執務エリア（南）360°', 'リスク管理 執務', kind='pano', pos=(-25.0, 14.5)),
    Shot('pano-meeting-a', '大会議室 A 360°', '大会議室 A', kind='pano', pos=(-32.4, 8.6)),
]

#: 品質：解像度（final 基準）、サンプル数、適応サンプリングの閾値。
#: final は CPU 4 コアで全ショット ≒ 13〜14 時間（実測に基づく見積もりは README §8）
QUALITY = {
    'preview': {'scale': 1 / 3, 'pano_scale': 0.25, 'samples': 32, 'pano_samples': 16, 'threshold': 0.05},
    'final': {'scale': 1.0, 'pano_scale': 1.0, 'samples': 160, 'pano_samples': 48, 'threshold': 0.02},
}
STILL_SIZE = (1920, 1080)
PANO_SIZE = (4096, 2048)
THUMB_W = 480
# Web 版（単一 HTML に data URI で埋め込む）の縮小幅と JPEG 品質
WEB_STILL_W, WEB_STILL_Q = 1600, 85
WEB_PANO_W, WEB_PANO_Q = 3072, 82
ORIGINALS_DIR = C.ROOT / 'docs' / 'renders'
#: 平面図：中心（three.js の x, y, z。南のバルコニーまで入るよう少し南寄り）と画像幅に写す範囲（m）
PLAN_CENTER = (0.0, 0.0, 1.2)
PLAN_WIDTH = 84.0


def camera_of(meta: dict, preset: str) -> dict:
    for c in meta['cameras']:
        if c['name'] == preset:
            return c
    raise KeyError(f'meta.json にプリセット {preset} がない')


def heading_of(cam: dict) -> float:
    """three.js の pos→target の水平方位（北から時計回り、度）"""
    dx = cam['target'][0] - cam['pos'][0]
    dz = cam['target'][2] - cam['pos'][2]
    return math.degrees(math.atan2(dx, -dz)) % 360.0


def clearance(pos3) -> float:
    """パノラマ位置の周囲の空き（水平 24 方向 × 3 仰角のレイで最も近い面まで、m）"""
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    p = C.three_to_bl(pos3)
    best = 99.0
    for k in range(24):
        a = 2 * math.pi * k / 24
        for dz in (0.0, -0.5, 0.5):
            ok, loc, *_ = sc.ray_cast(dg, p, Vector((math.cos(a), math.sin(a), dz)).normalized(), distance=10.0)
            if ok:
                best = min(best, (loc - p).length)
    return best


def setup_shot(h: C.SceneHandles, s: Shot, q: dict, samples: int, scale: float) -> dict:
    """カメラ・表示・露出・解像度を整え、renders.json 用の情報を返す"""
    meta = h.meta
    C.set_variant(h, s.variant)
    info: dict = {}
    if s.kind == 'plan':
        C.set_visibility(h, hide=s.hide)
        C.make_ortho_top('cam_plan', PLAN_CENTER, PLAN_WIDTH)
        w, hh = STILL_SIZE
        info['ortho'] = {'center': [PLAN_CENTER[0], PLAN_CENTER[2]], 'width': PLAN_WIDTH,
                         'height': round(PLAN_WIDTH * hh / w, 3), 'up': '北（three.js −Z）'}
    elif s.kind == 'pano':
        cam = camera_of(meta, s.preset)
        pos3 = (s.pos[0], 1.55, s.pos[1])
        heading = heading_of(cam)
        C.set_visibility(h, hide=s.hide, camera_pos=C.three_to_bl(pos3), people_radius=PEOPLE_RADIUS['pano'],
                         seated_radius=SEATED_RADIUS_PANO)
        C.make_pano_camera('cam_pano', pos3, heading)
        clr = clearance(pos3)
        if clr < 0.35:
            C.log(f'警告：{s.id} の位置 {pos3} は周囲との空きが {clr:.2f} m しかない')
        w, hh = PANO_SIZE
        info.update({'pos': list(pos3), 'heading': round(heading, 2), 'clearance': round(clr, 2),
                     'mapping': '正距円筒。画像中央 = heading（北から時計回り）、右へ時計回り、上端 = 天頂'})
    else:
        cam = camera_of(meta, s.preset)
        cp = C.three_to_bl(cam['pos'])
        C.set_visibility(h, hide=s.hide, camera_pos=cp, clear_view=s.exterior,
                         people_radius=0.0 if s.exterior else PEOPLE_RADIUS['still'], tree_radius=s.tree_radius)
        fov = s.fov or cam['fov']
        C.make_camera('cam_still', cam['pos'], cam['target'], fov, two_point=s.two_point, extra_shift=s.shift)
        w, hh = STILL_SIZE
        info['camera'] = {'pos': cam['pos'], 'target': cam['target'], 'fov': fov, 'twoPoint': s.two_point,
                          'shiftY': round(bpy.data.objects['cam_still'].data.shift_y, 4)}
        hidden = [o.name for o in h.city_blocks if o.hide_render]
        if hidden:
            info['hiddenCityBlocks'] = len(hidden)
    rs = scale * (q['pano_scale'] if s.kind == 'pano' else q['scale'])
    rw, rh = max(16, round(w * rs)), max(8, round(hh * rs))
    C.set_resolution(rw, rh)
    C.setup_color_management(s.ev)
    C.setup_cycles(samples, threshold=q['threshold'], ev=s.ev)
    C.setup_compositor(s.bloom, s.ev)
    return {**info, 'w': rw, 'h': rh}


def full_size(s: Shot) -> tuple[int, int]:
    """final・等倍でのレンダー解像度"""
    return PANO_SIZE if s.kind == 'pano' else STILL_SIZE


def preset_size(s: Shot, q: dict) -> tuple[int, int]:
    """品質プリセットの既定の解像度（setup_shot と同じ丸め）"""
    w, hh = full_size(s)
    rs = q['pano_scale'] if s.kind == 'pano' else q['scale']
    return max(16, round(w * rs)), max(8, round(hh * rs))


def save_outputs(png: Path, s: Shot, original: bool) -> dict:
    """PNG → Web 用の縮小 JPEG と 480 px 幅のサムネイル。original=True なら原寸 JPEG q92 を docs/renders/ にも保存"""
    from PIL import Image

    base = s.id.replace('pano-', 'pano_') if s.kind == 'pano' else s.id
    out = C.ensure_dir(C.RENDERS_DIR)
    im = Image.open(png).convert('RGB')
    ww, wq = (WEB_PANO_W, WEB_PANO_Q) if s.kind == 'pano' else (WEB_STILL_W, WEB_STILL_Q)
    web = im if im.width <= ww else im.resize((ww, round(im.height * ww / im.width)), Image.LANCZOS)
    web.save(out / f'{base}.jpg', 'JPEG', quality=wq, optimize=True, progressive=True)
    tw = THUMB_W
    th = round(im.height * tw / im.width)
    im.resize((tw, th), Image.LANCZOS).save(out / f'{base}_thumb.jpg', 'JPEG', quality=88, optimize=True)
    res = {'file': f'{base}.jpg', 'thumb': f'{base}_thumb.jpg', 'webW': web.width, 'webH': web.height}
    if original:
        im.save(C.ensure_dir(ORIGINALS_DIR) / f'{base}.jpg', 'JPEG', quality=92, optimize=True, progressive=True, subsampling=0)
        res['original'] = f'docs/renders/{base}.jpg'
    return res


def resave(shots: list[Shot]) -> None:
    """レンダーし直さずに、中間 PNG から JPEG と renders.json のファイル項目を作り直す"""
    path = C.RENDERS_DIR / 'renders.json'
    cur = {e['id']: e for e in json.loads(path.read_text(encoding='utf-8'))} if path.exists() else {}
    entries = []
    for s in shots:
        png = C.OUT / 'renders' / f'{s.id}.png'
        if s.id not in cur or not png.exists():
            C.log(f'{s.id}: PNG または renders.json の項目がないので飛ばす')
            continue
        from PIL import Image

        with Image.open(png) as im:
            size = im.size
        if size != (cur[s.id].get('w'), cur[s.id].get('h')):
            # renders.json だけ git で戻した後などは、中間 PNG が別のレンダーのものになっている
            C.log(f'{s.id}: 中間 PNG の寸法 {size} が renders.json の {cur[s.id].get("w")}×{cur[s.id].get("h")} と違うので飛ばす')
            continue
        e = dict(cur[s.id])
        new = save_outputs(png, s, original=e.get('quality') == 'final' and size == full_size(s))
        if 'original' not in new:
            e.pop('original', None)
        e.update(new)  # 既存のキーの並びは保つ
        entries.append(e)
        C.log(f'{s.id}: 保存し直し → {e["file"]}（{e["webW"]}×{e["webH"]}）')
    if entries:
        update_json(entries)


def update_json(entries: list[dict]) -> Path:
    """renders.json を id 単位で更新し、並びはショット表の順にそろえる"""
    path = C.RENDERS_DIR / 'renders.json'
    cur = []
    if path.exists():
        cur = json.loads(path.read_text(encoding='utf-8'))
    by_id = {e['id']: e for e in cur}
    for e in entries:
        by_id[e['id']] = e
    order = {s.id: i for i, s in enumerate(SHOTS)}
    C.write_json(path, sorted(by_id.values(), key=lambda e: order.get(e['id'], 1e9)))
    return path


def main() -> None:
    ap = argparse.ArgumentParser(description='Cycles 静止画・パノラマ')
    ap.add_argument('--shots', default='all',
                    help='all、id のカンマ区切り、または remaining（renders.json で --quality の品質になっていないものだけ。中断からの再開用）')
    ap.add_argument('--quality', choices=QUALITY, default='preview')
    ap.add_argument('--samples', type=int, help='全ショット共通のサンプル数（既定は品質プリセット）')
    ap.add_argument('--scale', type=float, default=1.0, help='品質プリセットの解像度にさらに掛ける倍率')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--resave', action='store_true', help='レンダーせず、中間 PNG から JPEG を作り直す')
    args = ap.parse_args(C.parse_args())
    if args.list:
        for s in SHOTS:
            print(f'{s.id:18s} {s.kind:6s} {s.variant:6s} EV{s.ev:+.1f}  {s.title}')
        return
    if args.shots == 'all':
        ids = [s.id for s in SHOTS]
    elif args.shots == 'remaining':
        path = C.RENDERS_DIR / 'renders.json'
        q = QUALITY[args.quality]
        by_id = {s.id: s for s in SHOTS}
        # その品質の既定の解像度で描き終えたものだけを済みとする
        done = {e['id'] for e in json.loads(path.read_text(encoding='utf-8'))
                if e.get('quality') == args.quality and e['id'] in by_id
                and (e.get('w'), e.get('h')) == preset_size(by_id[e['id']], q)} if path.exists() else set()
        ids = [s.id for s in SHOTS if s.id not in done]
        C.log(f'残り {len(ids)} ショット（{args.quality} 済み {len(done)}）: {",".join(ids)}')
        if not ids:
            return
    else:
        ids = [x.strip() for x in args.shots.split(',') if x.strip()]
    unknown = [i for i in ids if i not in {s.id for s in SHOTS}]
    if unknown:
        raise SystemExit(f'不明なショット: {unknown}（--list で一覧）')
    shots = [s for s in SHOTS if s.id in ids]
    if args.resave:
        resave(shots)
        return
    # 同じバリアント・表示状態を続けて描くと永続データ（BVH）を使い回せる
    shots.sort(key=lambda s: (s.variant, s.hide, s.kind))
    q = QUALITY[args.quality]
    # 試し描き：解像度の倍率やサンプル数を品質プリセットから変えたもの。同梱画像・renders.json・原寸は更新しない
    trial = args.scale != 1.0 or (args.samples is not None
                                  and any(args.samples != (q['pano_samples'] if s.kind == 'pano' else q['samples'])
                                          for s in shots))
    if trial:
        C.log('試し描き（--scale／--samples がプリセットと違う）：blender/out/renders/trial/ に PNG だけを書く')
    h = C.build_scene(variant=shots[0].variant)
    png_dir = C.ensure_dir(C.OUT / 'renders')
    t_all = time.time()
    for s in shots:
        samples = args.samples or (q['pano_samples'] if s.kind == 'pano' else q['samples'])
        info = setup_shot(h, s, q, samples, args.scale)
        png = C.ensure_dir(png_dir / 'trial') / f'{s.id}.png' if trial else png_dir / f'{s.id}.png'
        C.log(f'{s.id}: {info["w"]}×{info["h"]}、{samples} spp、{s.variant}、EV {s.ev:+.1f} …')
        sec = C.render_to(png)
        if trial:
            C.log(f'{s.id}: {sec:.1f}s → {png}（試し描き）')
            continue
        # 原寸（docs/renders/）は final を原寸で描いたときだけ
        saved = save_outputs(png, s, original=args.quality == 'final' and (info['w'], info['h']) == full_size(s))
        file = saved['file']
        entry = {
            'id': s.id, 'kind': 'pano' if s.kind == 'pano' else 'still', 'title': s.title, 'preset': s.preset,
            **saved, 'w': info.pop('w'), 'h': info.pop('h'),
            'samples': samples, 'seconds': round(sec, 1),
            'sunHours': h.meta['sun'][C.VARIANTS[s.variant]['sun']]['hours'], 'note': s.note,
            'variant': s.variant, 'ev': s.ev, 'quality': args.quality, **info,
        }
        update_json([entry])
        C.log(f'{s.id}: {sec:.1f}s → {file}')
    C.log(f'全 {len(shots)} ショット {time.time() - t_all:.0f}s' + ('（試し描き）' if trial else f' → {C.RENDERS_DIR / "renders.json"}'))


if __name__ == '__main__':
    main()
