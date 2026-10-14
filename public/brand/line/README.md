# LINE share artwork

Unmodified official LINE Social Plugins sample images, not app-generated logos.

- Design guide: https://developers.line.biz/en/docs/line-social-plugins/resources/design-guide/
- Usage guidelines: https://developers.line.biz/en/docs/line-social-plugins/general/guidelines/
- EN archive: https://developers.line.biz/media/line-social-plugins/en/buttons_en_v3.zip
- TH archive: https://developers.line.biz/media/line-social-plugins/th/buttons_th_v3.zip
- `share-{lang}.png`: archive `wide-default.png`; `share-{lang}-grey.png`: `wide-grey.png`.
- EN downloaded from the guide's English “Download image” button on 14 Oct 2026.
  SHA-256: default `739fe6e2713774779e2351a548501730cc193adada914f04c9439ab0d154f946`;
  grey `3f2a1ef3293abbd624d89dbc2868e30e0e853d74690d7d8a183b731bdd29c49f`.
- TH retained byte-for-byte from commit `c9b53510affce19490e5eecc17908315fa332c86`.

The guide says source images are double resolution. TH is 136×60, EN is 180×60.
The existing control stays 68×30 CSS pixels. `object-contain` keeps the official
English image proportional inside that footprint (68×22.67 with vertical space),
without cropping, recoloring or editing either file. Grey is the supplied disabled
variant. The button—not the decorative image—provides the translated accessible name.
