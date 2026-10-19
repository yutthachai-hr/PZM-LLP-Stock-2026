"""Portable generator for synthetic 5-column, 31-row OCR test fixtures.

Owner spec (FIXTURE-31-SPEC.md):
- 2 pages, exactly 31 ingredient/order rows (18 on p1, 13 on p2)
- 5 columns: ชื่อวัตถุดิบ | หน่วย | คงเหลือ | จำนวนสั่ง | เรียกเข้า
- Ordered quantity (จำนวนสั่ง): 28 numeric, 1 '-', 2 'ตาม'
- Dates: 20-Oct / 23-Oct
- Page 2 has NO header
- Portable: generates small text PDF, scanned PDF, and groundtruth JSON.
"""

import json
import os
import sys
import pymupdf


def find_font():
  candidates = [
      'C:/Windows/Fonts/tahoma.ttf',
      'C:/Windows/Fonts/segoeui.ttf',
      '/usr/share/fonts/truetype/tlwg/TlwgTypo.ttf',
      '/usr/share/fonts/truetype/thai/Garuda.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
  ]
  for c in candidates:
    if os.path.exists(c):
      return c
  return None


# 31 synthetic ingredient items (no business data)
ITEMS = [
    (
        'Mozzarella Cheese Block (Anchor 20kg/ctn)',
        'Carton',
        '3.0',
        '5.0',
        '2.0',
    ),
    (
        'แป้งสาลีสำหรับทำพิซซ่า ตรายานอวกาศ (Pizza Flour 25kg)',
        'Bag',
        '12.0',
        '10.0',
        '5.0',
    ),
    ('Italian Peeled Tomato Polpa in Juice 2.5kg', 'Can', '8.0', '12.0', '6.0'),
    (
        'ไส้กรอกหมูคูโรบูตะรมควันสไลซ์ (Smoked Kurobuta Pork)',
        'Pack',
        '4.5',
        '8.0',
        '4.0',
    ),
    ('Extra Virgin Olive Oil 5L (Monini)', 'Tin', '2.0', '3.0', '1.0'),
    ('แฮมสไลซ์เกรดพรีเมียม (Cooked Ham Slice 1kg)', 'Pack', '5.0', '6.0', '3.0'),
    ('Dry Yeast 500g (Saf-Instant Red)', 'Pack', '6.0', '4.0', '2.0'),
    ('ใบโหระพาอิตาเลียนสด (Fresh Sweet Basil)', 'KG', '1.2', '2.5', '1.0'),
    (
        'พริกหวานสามสีรวม (Mixed Bell Peppers Tri-color)',
        'KG',
        '4.0',
        '-',
        '0.0',
    ),  # row 9: manual '-'
    ('Mushroom Champignon Fresh Brown 1kg', 'Pack', '3.0', '7.0', '3.0'),
    ('พริกชี้ฟ้าแดงสดคัดเกรด (Red Chili Fresh)', 'KG', '0.8', '1.5', '0.5'),
    (
        'Black Olives Pitted Sliced in Brine 3kg',
        'Can',
        '2.0',
        '4.0',
        '2.0',
    ),
    ('หัวหอมใหญ่ปอกเปลือก (Peeled Yellow Onion)', 'KG', '15.0', '20.0', '10.0'),
    ('กระเทียมจีนกลีบใหญ่ปอก (Peeled Garlic Cloves)', 'KG', '6.0', '5.0', '2.0'),
    ('Gorgonzola Piccante Cheese DOP 1.5kg', 'Pack', '1.5', '2.0', '1.0'),
    ('Pepperoni Slices 1kg (Pork Sausage)', 'Pack', '7.0', '15.0', '5.0'),
    (
        'พาร์มาแฮมบ่ม 18 เดือน (Prosciutto di Parma 18m)',
        'Pack',
        '2.0',
        'ตาม',
        '1.0',
    ),  # row 17: manual 'ตาม'
    ('Sea Salt Fine Grain 1kg (เกลือสมุทร)', 'Pack', '10.0', '8.0', '4.0'),
    # Page 2 starts (13 rows, no header)
    ('Bacon Bits Smoked 1kg (เบคอนบิทส์)', 'Pack', '5.0', '6.0', '2.0'),
    ('สับปะรดหั่นชิ้นในน้ำเชื่อม (Pineapple Tidbits 3kg)', 'Can', '4.0', '4.0', '2.0'),
    ('Oregano Dried Flakes 500g', 'Pack', '3.0', '2.0', '1.0'),
    ('ผักร็อกเก็ตป่าสด (Fresh Wild Rocket)', 'KG', '0.9', '3.0', '1.5'),
    ('ชีสพาร์เมซานขูดผง (Grated Parmesan Cheese 1kg)', 'Pack', '4.0', '6.0', '2.0'),
    ('White Truffle Oil 250ml (น้ำมันเห็ดทรัฟเฟิลขาว)', 'Bottle', '1.0', '2.0', '1.0'),
    ('เนยสดชนิดจืด (Unsalted Butter 5kg)', 'Block', '2.0', '3.0', '1.0'),
    (
        'ครีมชีสแท้ (Cream Cheese Philadelphia 2kg)',
        'Pack',
        '1.0',
        'ตาม',
        '0.5',
    ),  # row 26: manual 'ตาม'
    ('หอยลายต้มสุกแช่แข็ง (Frozen Clam Meat 1kg)', 'Pack', '3.0', '5.0', '2.0'),
    ('กุ้งขาวแกะเปลือกไว้หาง (Frozen White Shrimp 1kg)', 'Pack', '6.0', '8.0', '4.0'),
    ('ปลาหมึกวงแช่แข็ง (Frozen Squid Ring 1kg)', 'Pack', '4.0', '6.0', '3.0'),
    ('น้ำตาลทรายขาวบริสุทธิ์ (Pure Refined Sugar 1kg)', 'Pack', '15.0', '10.0', '5.0'),
    ('ซอสมะเขือเทศเข้มข้น (Tomato Paste Tin 800g)', 'Can', '6.0', '12.0', '4.0'),
]


def generate(out_dir: str):
  os.makedirs(out_dir, exist_ok=True)
  font_path = find_font()

  groundtruth = {
      'metadata': {
          'title': 'ใบสั่งซื้อวัตถุดิบ (Synthetic Test Fixture)',
          'columns': [
              'ชื่อวัตถุดิบ',
              'หน่วย',
              'คงเหลือ',
              'จำนวนสั่ง',
              'เรียกเข้า',
          ],
          'totalRows': len(ITEMS),
          'page1Rows': 18,
          'page2Rows': 13,
          'numericRows': 28,
          'manualRows': [9, 17, 26],
          'dates': {'deliveryDate': '20-Oct-2026', 'requestDate': '23-Oct-2026'},
      },
      'rows': [
          {
              'index': idx + 1,
              'name': item[0],
              'unit': item[1],
              'stock': item[2],
              'orderQty': item[3],
              'inbound': item[4],
              'isManual': item[3] in ('-', 'ตาม'),
          }
          for idx, item in enumerate(ITEMS)
      ],
  }

  gt_file = os.path.join(out_dir, 'synthetic-31-groundtruth.json')
  with open(gt_file, 'w', encoding='utf-8') as f:
    json.dump(groundtruth, f, ensure_ascii=False, indent=2)

  doc = pymupdf.open()
  cols = [35, 320, 380, 440, 510]  # x positions for 5 cols

  def render_page(items, page_num, total_pages):
    p = doc.new_page(width=595, height=842)
    font_arg = {}
    if font_path:
      p.insert_font(fontname='th', fontfile=font_path)
      font_arg = {'fontname': 'th'}

    if page_num == 1:
      # Header block on page 1 only
      p.insert_text(
          (35, 45),
          'ใบสั่งซื้อวัตถุดิบ / Purchase Order (Synthetic Test Fixture)',
          fontsize=13,
          **font_arg
      )
      p.insert_text(
          (35, 65),
          'สาขา: Pizza Mania สุขุมวิท    วันที่สั่ง: 20-Oct-2026    กำหนดส่ง:'
          ' 23-Oct-2026',
          fontsize=9,
          **font_arg
      )
      p.insert_text(
          (35, 80), 'เลขที่เอกสาร: PO-SYNTH-20261020-001', fontsize=9, **font_arg
      )

      # 5 column header on page 1
      y = 105
      headers = [
          'ชื่อวัตถุดิบ',
          'หน่วย',
          'คงเหลือ',
          'จำนวนสั่ง',
          'เรียกเข้า',
      ]
      for x, h in zip(cols, headers):
        p.insert_text((x, y), h, fontsize=9, **font_arg)
      p.draw_line((35, y + 4), (565, y + 4))
      y += 18
    else:
      # Page 2 has NO header block and NO column headers
      y = 45

    for item in items:
      # item: (name, unit, stock, orderQty, inbound)
      name, unit, stock, qty, inbound = item
      # Wrap long names if > 42 chars
      if len(name) > 42:
        p.insert_text((cols[0], y), name[:42], fontsize=8, **font_arg)
        p.insert_text((cols[0], y + 10), name[42:], fontsize=8, **font_arg)
        p.insert_text((cols[1], y), unit, fontsize=8, **font_arg)
        p.insert_text((cols[2], y), stock, fontsize=8, **font_arg)
        p.insert_text((cols[3], y), qty, fontsize=8, **font_arg)
        p.insert_text((cols[4], y), inbound, fontsize=8, **font_arg)
        y += 22
      else:
        p.insert_text((cols[0], y), name, fontsize=8, **font_arg)
        p.insert_text((cols[1], y), unit, fontsize=8, **font_arg)
        p.insert_text((cols[2], y), stock, fontsize=8, **font_arg)
        p.insert_text((cols[3], y), qty, fontsize=8, **font_arg)
        p.insert_text((cols[4], y), inbound, fontsize=8, **font_arg)
        y += 18

    p.insert_text(
        (500, 825), f'หน้า {page_num}/{total_pages}', fontsize=8, **font_arg
    )

  render_page(ITEMS[:18], 1, 2)
  render_page(ITEMS[18:], 2, 2)

  text_pdf = os.path.join(out_dir, 'synthetic-31-text.pdf')
  doc.save(text_pdf)

  # Render small scanned image-only PDF equivalent
  scan_small_pdf = os.path.join(out_dir, 'synthetic-31-scan.pdf')
  scan_small = pymupdf.open()
  for pg in doc:
    pix = pg.get_pixmap(dpi=72)
    im = scan_small.new_page(width=pg.rect.width, height=pg.rect.height)
    im.insert_image(im.rect, stream=pix.tobytes('jpeg', jpg_quality=65))
  scan_small.save(scan_small_pdf, deflate=True)

  # If --large flag passed, generate uncompressed 4.3MB 150dpi scan outside git / test time
  if '--large' in sys.argv:
    large_scan_pdf = os.path.join(out_dir, 'synthetic-31-scan-large-4.3mb.pdf')
    scan_large = pymupdf.open()
    for pg in doc:
      pix = pg.get_pixmap(dpi=150, colorspace=pymupdf.csGRAY)
      im = scan_large.new_page(width=pg.rect.width, height=pg.rect.height)
      im.insert_image(im.rect, stream=pix.tobytes('png'))
    scan_large.save(large_scan_pdf)
    print(f'  scan-large-4.3mb: {os.path.getsize(large_scan_pdf)} bytes')

  print(f'Generated fixtures in {out_dir}:')
  print(f'  text-pdf: {os.path.getsize(text_pdf)} bytes')
  print(f'  scan-pdf: {os.path.getsize(scan_small_pdf)} bytes')
  print(f'  groundtruth: {os.path.getsize(gt_file)} bytes')


if __name__ == '__main__':
  target_dir = (
      sys.argv[1]
      if len(sys.argv) > 1
      else os.path.join(os.path.dirname(__file__))
  )
  generate(target_dir)
