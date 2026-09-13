#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
给自托管字体子集「补字」（只增不减）。

背景
----
`fonts/` 下四款字体是按站点用字做过的子集。每次新增诗词 / 译文，都可能带来
字体里没有的字，表现是页面上那个字被吃掉半边（笔画缺失），而不是显示成方块。

用法
----
    # 1. 先在 PATH 里准备好完整的 Noto 源字体（约 76MB，只用于取字形）
    npm i @fontsource/noto-sans-sc @fontsource/noto-serif-sc
    # 2. 改下面两个 SRC_* 常量指向 node_modules 里的 files/ 目录
    # 3. 执行
    python3 scripts/supplement-fonts.py

依赖：pip install fonttools brotli

做法
----
不做整份重建（那样会改动全部字形的 hinting 与字宽），而是：

  1. 扫描 `data/` 与全部页面 / 脚本 / 样式，汇总站点实际用字
  2. 逐个字体算出缺哪些字
  3. 从 Noto 源字体逐片取这些字的轮廓，用 T2CharStringPen 重画
     （源是 glyf 二次曲线，目标是 CFF 三次曲线，经 Cu2QuPen 升阶）
  4. 追加进 CharStrings / hmtx / vmtx / cmap
  5. 因为目标是 CID-keyed CFF，字形名必须是 cidNNNNN 且 ≤ 65535：
     原字体 CID 稀疏（最大已到 65530），直接往上排会溢出，
     所以补完后把全部字形重排成连续编号，`.notdef` 固定留在 0 号

补完务必跑 `node test/theme.test.js`：它会用 fontTools 直接读 cmap，
拿站点全部用字逐字校验覆盖度。

注意：极少数生僻异体字（如「煣」）Noto CJK 本身就没有，脚本会明确列出这类
「源字体也缺」的字，需要改用通用字或另找字源。
"""
import glob, os, re
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.cu2quPen import Cu2QuPen

# 完整的 Noto 源字体分片目录（按本机实际情况改）
SRC_SANS = os.environ.get('SRC_SANS', 'node_modules/@fontsource/noto-sans-sc/files')
SRC_SERIF = os.environ.get('SRC_SERIF', 'node_modules/@fontsource/noto-serif-sc/files')
# 仓库根目录（脚本放在 scripts/ 下，默认取上一级）
ROOT = os.environ.get('POEM_ROOT', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TARGETS = [
    ('NotoSansSC-400', SRC_SANS, 400),
    ('NotoSansSC-600', SRC_SANS, 600),
    ('NotoSerifSC-400', SRC_SERIF, 400),
    ('NotoSerifSC-600', SRC_SERIF, 600),
]

def site_chars():
    chars = set()
    for root, dirs, files in os.walk(ROOT):
        if any(x in root for x in ['.git', 'node_modules', 'fonts']):
            continue
        for f in files:
            if f.endswith(('.js', '.html', '.css', '.json', '.webmanifest')):
                txt = open(os.path.join(root, f), encoding='utf8').read()
                chars |= set(re.findall(r'[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]', txt))
    chars |= set('跬步·—…「」《》（）？！、。；：')
    return chars

def graft(dst_path, src_files, chars):
    dst = TTFont(dst_path)
    have = set(chr(c) for c in dst.getBestCmap())
    missing = set(chars) - have
    if not missing:
        return 0, set()
    # 逐片找源字形
    src_map, remaining = {}, set(missing)
    for sf in src_files:
        if not remaining:
            break
        cmap = TTFont(sf, lazy=True).getBestCmap()
        for c in list(remaining):
            if ord(c) in cmap:
                src_map[c] = (sf, cmap[ord(c)])
                remaining.discard(c)
    if not src_map:
        return 0, missing

    by_src = {}
    for c, (sf, gname) in src_map.items():
        by_src.setdefault(sf, []).append((c, gname))

    unicode_cmaps = [t for t in dst['cmap'].tables if t.isUnicode()]
    hmtx = dst['hmtx']
    cff = dst['CFF '].cff
    top = cff[cff.fontNames[0]]
    charstrings = top.CharStrings
    priv = top.FDArray[0].Private if "FDArray" in top.rawDict else top.Private
    is_cid = 'FDArray' in top.rawDict

    added = 0
    for sf, items in by_src.items():
        src = TTFont(sf)
        gs = src.getGlyphSet()
        src_hmtx = src['hmtx']
        for c, sname in items:
            width = src_hmtx[sname][0]
            rec = RecordingPen()
            gs[sname].draw(rec)
            pen = T2CharStringPen(width, None)
            rec.replay(Cu2QuPen(pen, 1.0))     # 二次 → 三次
            cs = pen.getCharString(private=priv)
            # 先挂一个临时名，稍后统一重排 CID
            tmp = 'tmp-%04X' % ord(c)
            if charstrings.charStringsAreIndexed:
                charstrings.charStrings[tmp] = len(charstrings.charStringsIndex)
                charstrings.charStringsIndex.append(cs)
            else:
                charstrings.charStrings[tmp] = cs
            lsb = src_hmtx[sname][1] if len(src_hmtx[sname]) > 1 else 0
            hmtx.metrics[tmp] = (width, lsb)
            # 竖排字体带 vmtx，新字形也要补上，否则表长度对不上会读崩
            if 'vmtx' in dst and 'vmtx' in src:
                dst['vmtx'].metrics[tmp] = src['vmtx'][sname]
            for t in unicode_cmaps:
                t.cmap[ord(c)] = tmp
            added += 1
        src.close()

    # 重排 CID：.notdef 留在 0，其余按原顺序连续编号
    raw_order = list(charstrings.charStrings.keys())
    assert raw_order[0] == '.notdef'
    if is_cid:
        remap = {'.notdef': '.notdef'}
        for i, old in enumerate(raw_order[1:], start=1):
            remap[old] = 'cid%05d' % i
        charstrings.charStrings = {remap[k]: v for k, v in charstrings.charStrings.items()}
        for t in unicode_cmaps:
            t.cmap = {u: remap.get(g, g) for u, g in t.cmap.items()}
        hmtx.metrics = {remap.get(k, k): v for k, v in hmtx.metrics.items()}
        if 'vmtx' in dst:
            dst['vmtx'].metrics = {remap.get(k, k): v for k, v in dst['vmtx'].metrics.items()}
        new_order = [remap[o] for o in raw_order]
    else:
        new_order = raw_order
    dst.setGlyphOrder(new_order)
    dst['maxp'].numGlyphs = len(new_order)
    if is_cid:
        top.charset = new_order
        fdsel = getattr(top, 'FDSelect', None)
        if fdsel is not None:
            fdsel.gidArray = [0] * len(new_order)
    dst.flavor = 'woff2'
    dst.save(dst_path)
    return added, remaining

def main():
    chars = site_chars()
    print('站点用字：%d 个' % len(chars))
    for name, src_dir, weight in TARGETS:
        src_files = sorted(glob.glob(os.path.join(src_dir, '*-%d-normal.woff2' % weight)))
        dst_path = os.path.join(ROOT, 'fonts', name + '.woff2')
        added, left = graft(dst_path, src_files, chars)
        t = TTFont(dst_path)
        still = chars - set(chr(c) for c in t.getBestCmap())
        print('  %-18s 补入 %d 字；复核缺 %d %s'
              % (name, added, len(still), ''.join(sorted(still)) if still else ''))

main()
