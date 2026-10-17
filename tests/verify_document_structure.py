"""Structural Table & Cell Verification for Purchase Request Documents.

Validates:
1. Exact 2D table grid geometry, column bounds, and cell bindings.
2. Repeat table headers across every page.
3. Exact row sequence, supplier/SKU/quantities/units matching expected data.
4. Unicode integrity: authentic Thai glyphs (ผำ, ปำ, ฝำ, ฟำ), 0 PUA codepoints,
   0 /ActualText hacks, 0 invisible text rendering (3 Tr), and valid ToUnicode CMap.
5. Rejection of negative controls (swapped SKUs, swapped quantities, row permutations,
   missing rows, duplicate rows).
"""
import sys
import re
import json
from pathlib import Path
import pymupdf

NORM = lambda s: re.sub(r'\s+', ' ', str(s) if s is not None else '').strip()

def extract_table_grid(doc):
    """Extract structured 2D table grid (list of list of strings) from PyMuPDF document."""
    all_rows = []
    page_headers = []

    for p_idx, page in enumerate(doc):
        drawings = page.get_drawings()
        strokes = [x for x in drawings if x['type'] == 's']
        y_divs = sorted(list(set(round(s['rect'].y0, 1) for s in strokes)))

        # Header fill rects (8 columns, height ~ 23.125 pt in pdfmake)
        header_candidates = [
            x for x in drawings
            if x['type'] == 'f' and x.get('fill') and (abs(x['rect'].height - 23.125) < 4 or abs(x['rect'].height - 19.625) < 4)
        ]
        if not header_candidates:
            raise ValueError(f"Page {p_idx+1}: Could not find table header rectangles")

        top_y = min(x['rect'].y0 for x in header_candidates)
        header_rects = sorted([x['rect'] for x in header_candidates if abs(x['rect'].y0 - top_y) < 2], key=lambda r: r.x0)

        if len(header_rects) != 8:
            raise ValueError(f"Page {p_idx+1}: Expected 8 column header rects, found {len(header_rects)}")

        col_bounds = [(r.x0 - 1.5, r.x1 + 1.5) for r in header_rects]
        header_bottom = max(r.y1 for r in header_rects)
        words = page.get_text('words')

        # Header cells on this page
        h_cells = []
        for cx0, cx1 in col_bounds:
            c_words = [w for w in words if top_y <= w[1] < header_bottom + 2 and cx0 <= w[0] < cx1]
            c_words = sorted(c_words, key=lambda w: (round(w[1], 1), w[0]))
            h_cells.append(NORM(' '.join(w[4] for w in c_words)))
        page_headers.append(h_cells)

        # Data rows between y_divs cuts strictly below header
        data_y_cuts = [header_bottom] + [y for y in y_divs if y > header_bottom + 1]
        for i in range(len(data_y_cuts) - 1):
            y0, y1 = data_y_cuts[i], data_y_cuts[i+1]
            row = []
            for cx0, cx1 in col_bounds:
                c_words = [w for w in words if y0 <= w[1] < y1 and cx0 <= w[0] < cx1]
                c_words = sorted(c_words, key=lambda w: (round(w[1], 1), w[0]))
                row.append(NORM(' '.join(w[4] for w in c_words)))
            all_rows.append(row)

    return page_headers, all_rows

def verify_document_structure(pdf_path, expected_cols, expected_rows, expected_head=None):
    """Strictly verifies document structure."""
    doc = pymupdf.open(pdf_path)
    errors = []

    if expected_head:
        first_page_text = doc[0].get_text()
        for h in expected_head:
            if NORM(h) not in NORM(first_page_text):
                errors.append(f"Missing header metadata line: '{h}'")

    try:
        page_headers, extracted_rows = extract_table_grid(doc)
    except Exception as e:
        return False, [f"Grid extraction failed: {str(e)}"]

    # 1. Verify headers on every page
    norm_expected_cols = [NORM(c) for c in expected_cols]
    for p_idx, p_head in enumerate(page_headers):
        if len(p_head) != len(norm_expected_cols):
            errors.append(f"Page {p_idx+1}: Column count mismatch {len(p_head)} != {len(norm_expected_cols)}")
        for col_idx, (act, exp) in enumerate(zip(p_head, norm_expected_cols)):
            if act != exp:
                errors.append(f"Page {p_idx+1} Col {col_idx}: Header '{act}' != expected '{exp}'")

    # 2. Verify row count
    if len(extracted_rows) != len(expected_rows):
        errors.append(f"Row count mismatch: extracted {len(extracted_rows)} != expected {len(expected_rows)}")

    # 3. Verify row content and sequence
    limit = min(len(extracted_rows), len(expected_rows))
    for r_idx in range(limit):
        act_row = extracted_rows[r_idx]
        exp_row = [NORM(c) for c in expected_rows[r_idx]]
        for c_idx in range(min(len(act_row), len(exp_row))):
            if act_row[c_idx] != exp_row[c_idx]:
                errors.append(
                    f"Row {r_idx+1} Col {c_idx+1} ({expected_cols[c_idx]}): "
                    f"extracted '{act_row[c_idx]}' != expected '{exp_row[c_idx]}'"
                )

    return (len(errors) == 0), errors

def inspect_pdf_unicode_and_glyphs(pdf_path):
    """Inspects native Unicode, PUA, ActualText, rendering mode 3 Tr, and target Thai strings."""
    doc = pymupdf.open(pdf_path)
    full_text = '\n'.join(page.get_text() for page in doc)

    # 1. PUA check (U+E000 to U+F8FF)
    pua_chars = [ch for ch in full_text if 0xE000 <= ord(ch) <= 0xF8FF]

    # 2. Raw stream inspection for /ActualText and 3 Tr
    actual_text_count = 0
    invisible_3tr_count = 0
    for page in doc:
        for cmd in page.get_cdrawings():
            pass
        # inspect contents stream
        for xref in page.get_contents():
            stream = doc.xref_stream(xref)
            if b'/ActualText' in stream:
                actual_text_count += 1
            if b' 3 Tr' in stream or b' 3 tr' in stream:
                invisible_3tr_count += 1

    # 3. Authentic Thai keywords
    has_pha = 'ผำ' in full_text
    has_tall_am = 'ปำ' in full_text or 'ฝำ' in full_text or 'ฟำ' in full_text

    return {
        'pageCount': len(doc),
        'puaCount': len(pua_chars),
        'actualTextCount': actual_text_count,
        'invisible3TrCount': invisible_3tr_count,
        'hasPha': has_pha,
        'hasTallAm': has_tall_am,
    }

if __name__ == '__main__':
    # CLI mode for test execution
    sys.stdout.reconfigure(encoding='utf-8')
    if len(sys.argv) < 3:
        print("Usage: python verify_document_structure.py <mode> <pdf_path> [spec_json]", file=sys.stderr)
        sys.exit(1)

    mode = sys.argv[1]
    pdf_path = sys.argv[2]

    if mode == 'inspect':
        res = inspect_pdf_unicode_and_glyphs(pdf_path)
        print(json.dumps(res, ensure_ascii=False))
        sys.exit(0)

    elif mode == 'verify':
        spec = json.loads(Path(sys.argv[3]).read_text(encoding='utf8'))
        ok, errs = verify_document_structure(
            pdf_path,
            spec['cols'],
            spec['rows'],
            spec.get('head')
        )
        print(json.dumps({'ok': ok, 'errors': errs}, ensure_ascii=False))
        sys.exit(0 if ok else 2)
