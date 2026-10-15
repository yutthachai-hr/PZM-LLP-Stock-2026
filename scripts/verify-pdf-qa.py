import os
import sys
import glob
import json
import pymupdf

QA_DIR = r"C:/Users/Yutthachai/pzm-recovery-20261015/pdf-qa/generated"

def verify_and_render_all():
    pdf_files = sorted(glob.glob(os.path.join(QA_DIR, "*.pdf")))
    if not pdf_files:
        print(f"Error: No PDF files found in {QA_DIR}")
        sys.exit(1)

    report = {
        "verified_files_count": len(pdf_files),
        "files": []
    }

    for pdf_path in pdf_files:
        base_name = os.path.splitext(os.path.basename(pdf_path))[0]
        doc = pymupdf.open(pdf_path)
        page_count = len(doc)
        file_info = {
            "name": base_name,
            "path": pdf_path,
            "page_count": page_count,
            "pages": [],
            "issues": [],
            "checks": {
                "page_dimensions_valid": True,
                "glyph_bounds_within_page": True,
                "metadata_leading_safe": True,
                "table_below_metadata": True,
                "controlled_data_present": True
            }
        }

        # Check data presence in entire doc for matrix files
        full_text = ""
        for page in doc:
            full_text += page.get_text()

        if "matrix" in base_name and ("th" in base_name or "en" in base_name):
            if "PZS-01-06-001" not in full_text:
                file_info["checks"]["controlled_data_present"] = False
                file_info["issues"].append("Missing expected SKU PZS-01-06-001")
            # 350.2203 formatted via fmtQty is "350.22"
            if "350.22" not in full_text:
                file_info["checks"]["controlled_data_present"] = False
                file_info["issues"].append("Missing expected quantity 350.22 (from 350.2203)")

        # Inspect and render pages (first page and continuation pages)
        for page_idx in range(page_count):
            page = doc[page_idx]
            rect = page.rect
            # Expected A4 landscape pt: ~841.89 x 595.28
            if abs(rect.width - 841.89) > 1.0 or abs(rect.height - 595.28) > 1.0:
                file_info["checks"]["page_dimensions_valid"] = False
                file_info["issues"].append(f"Page {page_idx+1} invalid dimensions: {rect.width}x{rect.height}")

            # Check bounding boxes of text blocks
            blocks = page.get_text("blocks")
            header_blocks = [b for b in blocks if abs(b[0] - 40.0) < 0.5]
            table_blocks = [b for b in blocks if b[0] >= 43.5]

            for b in blocks:
                x0, y0, x1, y1, text, block_no, block_type = b
                # Text clipping check: margins are 40pt, printable up to 801.89 x 555.28
                if x0 < 35.0 or y0 < 20.0 or x1 > rect.width - 20.0 or y1 > rect.height - 20.0:
                    file_info["checks"]["glyph_bounds_within_page"] = False
                    file_info["issues"].append(f"Page {page_idx+1} text overflows boundary: ({x0:.1f}, {y0:.1f}, {x1:.1f}, {y1:.1f})")

            # Metadata baseline and separation check on page 1
            if page_idx == 0 and len(header_blocks) >= 2:
                words = page.get_text("words")
                left_words = [w for w in words if abs(w[0] - 40.0) < 0.5]
                # Sort by y0
                left_words.sort(key=lambda w: w[1])
                for i in range(1, len(left_words)):
                    step = left_words[i][1] - left_words[i-1][1]
                    # Consecutive lines should have baseline step >= 14.5 pt (nominal 16pt, minimum 15pt)
                    if 1.0 < step < 14.5:
                        file_info["checks"]["metadata_leading_safe"] = False
                        file_info["issues"].append(f"Header leading too small between line {i-1} and {i}: step={step:.1f}")

                # Check table is below header
                if header_blocks and table_blocks:
                    max_header_y = max((b[3] for b in header_blocks), default=0)
                    min_table_y = min((b[1] for b in table_blocks), default=999)
                    if min_table_y < max_header_y:
                        file_info["checks"]["table_below_metadata"] = False
                        file_info["issues"].append(f"Table overlaps header: min_table_y={min_table_y:.1f} < max_header_y={max_header_y:.1f}")

            # Rasterize page to PNG for visual proof (first 2 pages of each doc)
            if page_idx < 2:
                png_name = f"{base_name}-page-{page_idx+1}.png"
                png_path = os.path.join(QA_DIR, png_name)
                # 150 DPI render
                pix = page.get_pixmap(dpi=150)
                pix.save(png_path)
                file_info["pages"].append({
                    "page": page_idx + 1,
                    "png": png_name,
                    "rendered_dpi": 150,
                    "width_px": pix.width,
                    "height_px": pix.height
                })

        report["files"].append(file_info)

    report_path = os.path.join(QA_DIR, "qa-report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"Verified {len(pdf_files)} PDF files.")
    all_ok = True
    for fi in report["files"]:
        status = "OK" if not fi["issues"] else f"FAIL ({len(fi['issues'])} issues)"
        if fi["issues"]:
            all_ok = False
        print(f" - {fi['name']} ({fi['page_count']} pages): {status}")
        for iss in fi["issues"]:
            print(f"     * {iss}")

    if not all_ok:
        print("QA Verification FAILED!")
        sys.exit(1)
    else:
        print("ALL QA VERIFICATIONS PASSED!")

if __name__ == "__main__":
    verify_and_render_all()
