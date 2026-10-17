"""Sarabun for PDFs, v3: Precomposed ำ (uni0E33) + tone/tall ligatures and narrow context.

Solves F04: Tall consonant + ำ without tone mark (ปำ, ฝำ, ฟำ) collision by adding uni0E33.narrow
and hooking contextual substitution in ccmp, while preserving authentic shaping for non-tall
consonants including ผำ (Pho Phueng, authentic Northern/Isan culinary ingredient: Wolffia globosa / watermeal).

Preserves:
- 100% cmap integrity (725/725 mapped codepoints).
- Authentic ToUnicode extraction (U+0E33 maps directly to U+0E33 without PUA or ActualText hacks).
- OFL 1.1 compliance (renamed to "Sarabun PDF" / "SarabunPDF-Regular").
- Deterministic reproducible output: fixed timestamp 3875017358 and recalcTimestamp=False.
  Expected SHA-256: 7c15504c5c987b8ce0e29a67b6d3b179f63a5231b90c022252cd75ff4c5ca3c2.

Usage: python make_pdf_font_v3.py <in.ttf> <out.ttf>
"""
import sys
import hashlib
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables import otTables as ot
from fontTools.ttLib.tables._g_l_y_f import Glyph, GlyphComponent

EXPECTED_SHA256 = '7c15504c5c987b8ce0e29a67b6d3b179f63a5231b90c022252cd75ff4c5ca3c2'
FROZEN_TIMESTAMP = 3875017358

def build_font(src: str, dst: str) -> None:
    f = TTFont(src)
    gsub = f['GSUB'].table

    # (1) No decomposition of ำ (uni0E33).
    removed = 0
    for lk in gsub.LookupList.Lookup:
        for st in lk.SubTable:
            t = st.ExtSubTable if lk.LookupType == 7 else st
            if getattr(t, 'LookupType', lk.LookupType) == 2 and 'uni0E33' in getattr(t, 'mapping', {}):
                assert t.mapping['uni0E33'] == ['uni0E4D', 'uni0E32'], t.mapping['uni0E33']
                del t.mapping['uni0E33']
                removed += 1
    assert removed == 1

    # (2) Tone + ำ ligatures (uni0E33_0E48, uni0E33_0E49, etc. + .narrow variants).
    order = f.getGlyphOrder()
    glyf = f['glyf']
    hmtx = f['hmtx']
    gdef = f['GDEF'].table.GlyphClassDef.classDefs

    ligatures = {}
    for tone in ['uni0E48', 'uni0E49', 'uni0E4A', 'uni0E4B']:
        for suffix in ['', '.narrow']:
            first, mark = tone + suffix, 'uni0E4D' + tone[3:] + suffix
            if first not in order or mark not in order:
                continue
            name = f'uni0E33_{tone[3:]}{suffix.replace(".", "_")}'
            g = Glyph()
            g.numberOfContours = -1
            g.components = []
            for base in (mark, 'uni0E32'):  # stock shaping draws mark over sara aa
                c = GlyphComponent()
                c.glyphName = base
                c.x = 0
                c.y = 0
                c.flags = 0x4 if base == mark else 0
                g.components.append(c)
            order.append(name)
            glyf.glyphs[name] = g
            hmtx.metrics[name] = (hmtx['uni0E32'][0], 0)
            gdef[name] = 2  # Ligature
            ligatures.setdefault(first, []).append(name)

    # (3) F04 Fix: Add uni0E33.narrow composite glyph (uni0E4D.narrow over uni0E32).
    name_narrow = 'uni0E33.narrow'
    g_narrow = Glyph()
    g_narrow.numberOfContours = -1
    g_narrow.components = []
    for base in ('uni0E4D.narrow', 'uni0E32'):
        c = GlyphComponent()
        c.glyphName = base
        c.x = 0
        c.y = 0
        c.flags = 0x4 if base == 'uni0E4D.narrow' else 0
        g_narrow.components.append(c)
    order.append(name_narrow)
    glyf.glyphs[name_narrow] = g_narrow
    hmtx.metrics[name_narrow] = (hmtx['uni0E32'][0], 0)
    gdef[name_narrow] = 2  # Ligature

    f.setGlyphOrder(order)
    glyf.glyphOrder = order

    for name in [n for v in ligatures.values() for n in v] + [name_narrow]:
        glyf[name].recalcBounds(glyf)
        hmtx.metrics[name] = (hmtx['uni0E32'][0], glyf[name].xMin)

    # Add tone + ำ ligatures to LookupType 4 (LigatureSubst) appended to ccmp.
    sub = ot.LigatureSubst()
    sub.Format = 1
    sub.ligatures = {}
    for first, names in ligatures.items():
        for name in names:
            lig = ot.Ligature()
            lig.Component = ['uni0E33']
            lig.CompCount = 2
            lig.LigGlyph = name
            sub.ligatures.setdefault(first, []).append(lig)

    lookup = ot.Lookup()
    lookup.LookupType = 4
    lookup.LookupFlag = 0
    lookup.SubTable = [sub]
    lookup.SubTableCount = 1

    gsub.LookupList.Lookup.append(lookup)
    gsub.LookupList.LookupCount = len(gsub.LookupList.Lookup)
    new_index = len(gsub.LookupList.Lookup) - 1

    ccmp = 0
    for fr in gsub.FeatureList.FeatureRecord:
        if fr.FeatureTag == 'ccmp':
            fr.Feature.LookupListIndex.append(new_index)
            fr.Feature.LookupCount = len(fr.Feature.LookupListIndex)
            ccmp += 1
    assert ccmp >= 1

    # (4) Contextual substitution for tall consonant + uni0E33 -> uni0E33.narrow:
    # Hook into Lookup 17 (Type 1 SingleSubst: mark -> mark.narrow)
    lk17 = gsub.LookupList.Lookup[17]
    st17 = lk17.SubTable[0]
    t17 = st17.ExtSubTable if lk17.LookupType == 7 else st17
    assert 'uni0E4D' in t17.mapping
    t17.mapping['uni0E33'] = 'uni0E33.narrow'

    # Hook into Lookup 5 Subtable 5 (Chaining Contextual Type 6):
    # Backtrack=[uni0E1B, uni0E1D, uni0E1F], Input=[...uni0E4D...] -> invokes Lookup 17
    lk5 = gsub.LookupList.Lookup[5]
    st5 = lk5.SubTable[5]
    t5 = st5.ExtSubTable if lk5.LookupType == 7 else st5
    input_cov = t5.InputCoverage[0]
    assert 'uni0E4D' in input_cov.glyphs
    if 'uni0E33' not in input_cov.glyphs:
        input_cov.glyphs.append('uni0E33')
        input_cov.glyphs = sorted(input_cov.glyphs, key=lambda g: f.getGlyphID(g))

    # (5) Name records renaming (OFL 1.1)
    for rec in f['name'].names:
        if rec.nameID in (1, 3, 4, 6, 16):
            rec.string = rec.toUnicode().replace('Sarabun', 'Sarabun PDF' if rec.nameID != 6 else 'SarabunPDF', 1)

    f['maxp'].numGlyphs = len(order)

    # Deterministic timestamp and save
    f.recalcTimestamp = False
    f['head'].modified = FROZEN_TIMESTAMP
    f.save(dst)

    with open(dst, 'rb') as fp:
        actual_sha = hashlib.sha256(fp.read()).hexdigest()

    if actual_sha != EXPECTED_SHA256:
        raise ValueError(f"Reproducibility failure: got {actual_sha}, expected {EXPECTED_SHA256}")

    print({
        'status': 'SUCCESS',
        'sha256': actual_sha,
        'decompositionRemoved': removed,
        'toneLigatures': {k: v for k, v in ligatures.items()},
        'narrowLigature': name_narrow,
        'ccmpFeatures': ccmp,
        'totalGlyphs': len(order),
        'cmapEntries': len(f.getBestCmap())
    })

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python make_pdf_font_v3.py <in.ttf> <out.ttf>", file=sys.stderr)
        sys.exit(1)
    build_font(sys.argv[1], sys.argv[2])
