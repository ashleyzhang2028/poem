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

扩展区（ExtB U+20000 起）的字 **Noto CJK 全系列都没有**（连 44810 字的
NotoSansCJKsc 也只覆盖到 10 个），需要另挂公开领域的**花園明朝**（HanaMin）：
    HanaMinB.otf / HanaMinC.otf  ← https://github.com/cjkvi/HanaMinAFDKO/releases
把它加到 SRC_EXT 里即可。注意它们也是 OTF/CFF，`graft()` 会按目的字体的
unitsPerEm 做缩放，不必手工换算。

另有一条**必须留意**：目的字体是 BMP 定向的 format 4 + UCS-4 的 format 12
两张子表并存。扩展区字符只能挂进 **format 12**（format 4 的 endCode 是
无符号 16 位，塞 ExtB 会直接 OverflowError）。挂错表的表现是字体能存下来、
页面却仍不显示这个字。
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

# 扩展区生僻字（ExtB 等）的源：花園明朝。Noto CJK 没有这些字形。
# 目录 / 文件名按本机实际情况改；文件不存在时自动跳过（不报错）。
SRC_EXT = [
    os.environ.get('SRC_HANAMIN_B', '/tmp/HanaMinB.otf'),
    os.environ.get('SRC_HANAMIN_C', '/tmp/HanaMinC.otf'),
]

TARGETS = [
    ('NotoSansSC-400', SRC_SANS, 400),
    ('NotoSansSC-600', SRC_SANS, 600),
    ('NotoSerifSC-400', SRC_SERIF, 400),
    ('NotoSerifSC-600', SRC_SERIF, 600),
]

# 站点用字的扫描口径。
# 必须带上扩展区（ExtB U+20000–U+2A6DF 等）——《昭明文选》里《子虚赋》《吴都赋》
# 那批鸟兽名、地名用的正是这些字；只扫 BMP 的话它们缺字形也查不出来，
# 页面上就成了空白（曾经正是这样漏过了 183 个缺字）。
CJK_RE = re.compile(
    r'[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef'
    r'\U00020000-\U0002FA1F]'
)

def strip_comments(src, fn):
    """剥掉注释再取字。

    注释里的字不会被渲染，却会被算成「站点用字」，逼着字体子集去覆盖
    注释里偶然出现的生僻字（曾出现：CSS 注释里一个词让 4 款字体全部报缺字）。
    口径与 test/theme.test.js 里那段扫描保持一致，否则两边算出的
    「站点用字」不相等，会出现「脚本说补齐了、测试还说缺」。
    """
    if fn.endswith(('.js', '.css')):
        src = re.sub(r'/\*[\s\S]*?\*/', ' ', src)
    if fn.endswith('.js'):
        src = re.sub(r'(?m)^\s*//.*$', ' ', src)
    if fn.endswith(('.html', '.css')):
        src = re.sub(r'<!--[\s\S]*?-->', ' ', src)
    return src

def site_chars():
    chars = set()
    for root, dirs, files in os.walk(ROOT):
        if any(x in root for x in ['.git', 'node_modules', 'fonts']):
            continue
        for f in files:
            if f.endswith(('.js', '.html', '.css', '.json', '.webmanifest')):
                txt = open(os.path.join(root, f), encoding='utf8').read()
                chars |= set(re.findall(CJK_RE, strip_comments(txt, f)))
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

    # 只挂 format 12（UCS-4）子表：format 4 是 BMP 专用，endCode 为无符号 16 位，
    # 塞扩展区字符（U+20000 起）会直接 OverflowError。
    unicode_cmaps = [t for t in dst['cmap'].tables if t.isUnicode() and t.format == 12]
    assert unicode_cmaps, '字体里没有 format 12 子表，扩展区字符无处安放'
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
        # 源字体与目的字体的 unitsPerEm 可能不同（Noto 1000 / 花園明朝 1000 或 2048），
        # 不缩放会把字形画得过大或过小。
        upem_dst = dst['head'].unitsPerEm
        upem_src = src['head'].unitsPerEm
        scale = upem_dst / upem_src
        for c, sname in items:
            width = src_hmtx[sname][0] * scale
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
            lsb = (src_hmtx[sname][1] * scale) if len(src_hmtx[sname]) > 1 else 0
            hmtx.metrics[tmp] = (int(round(width)), int(round(lsb)))
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
    # CID 重排后，charstrings / hmtx / vmtx 的键要与字形序列对齐；
    # 原字体本就稀疏，缺键会让 hmtx.compile() 直接 KeyError。
    for gn in new_order:
        if gn not in charstrings.charStrings:
            charstrings.charStrings[gn] = charstrings.charStrings.get('space')
        if gn not in hmtx.metrics:
            hmtx.metrics[gn] = hmtx.metrics.get('.notdef', (1000, 0))
        if 'vmtx' in dst and gn not in dst['vmtx'].metrics:
            dst['vmtx'].metrics[gn] = dst['vmtx'].metrics.get('.notdef', (1000, 0))
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
    # 扩展区字（ExtB U+20000 起）Noto CJK 没有，改由花園明朝兜底。
    # 放在 Noto 分片之后，只有 Noto 取不到的才轮到它。
    ext_files = [f for f in SRC_EXT if os.path.exists(f)]
    if not ext_files:
        print('提示：未找到花園明朝（SRC_EXT），扩展区生僻字将无从补入。'
              '下载见 https://github.com/cjkvi/HanaMinAFDKO/releases')
    for name, src_dir, weight in TARGETS:
        src_files = sorted(glob.glob(os.path.join(src_dir, '*-%d-normal.woff2' % weight)))
        src_files += ext_files
        dst_path = os.path.join(ROOT, 'fonts', name + '.woff2')
        added, left = graft(dst_path, src_files, chars)
        t = TTFont(dst_path)
        still = chars - set(chr(c) for c in t.getBestCmap())
        print('  %-18s 补入 %d 字；复核缺 %d %s'
              % (name, added, len(still), ''.join(sorted(still)) if still else ''))

main()
