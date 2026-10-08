# stack/: the real Laya / Reflex / KatGPT-rs stack (engineering only, loopback only)

Nothing here is used by the app. The report is `docs/evidence/real-stack-report.md`; pins are in
`pins.json`.

Installs live **outside** the repo, in `C:/pzm/stack`:

| Path | What |
|---|---|
| `reflex-v0.2.4/bin/reflex.exe` | Release binary; SHA-256 verified |
| `models/laya-<rev>/` | English checkpoint; SHA-256 verified |
| `models/riir-laya/english/` | Hard links for Reflex's Rust Laya lane |
| `laya-venv/` | Python 3.14 venv; `laya/requirements.lock.txt` |
| `src/` | Upstream sources at their pinned commits |
| `secrets/laya.key` | API key; never committed |

## Run

```bash
# Laya (English only, 127.0.0.1:7340, key required)
LAYA_API_KEY_FILE=C:/pzm/stack/secrets/laya.key C:/pzm/stack/laya-venv/Scripts/python.exe -I stack/laya/serve_pinned.py

# Reflex (127.0.0.1:7331) with the PZM rulebook; add RIIR_REFLEX_LAYA=1 LAYA_WEIGHTS_DIR=C:/pzm/stack/models/riir-laya
# ONLY for the Rust/Python parity run — normal operation loads one Laya copy, not two
RIIR_REFLEX_BIND=127.0.0.1:7331 RIIR_REFLEX_CORPUS=stack/reflex/rulebook C:/pzm/stack/reflex-v0.2.4/bin/reflex.exe

node stack/scripts/reflex-validate.mjs   # Step 2: endpoint checks (run with the Laya lane OFF)
node stack/scripts/ask-bench.mjs         # Steps 4, 6, 7, 9: arms A–G, parity, services-dead, resources
```

Never bind either service off loopback, never set `RIIR_REFLEX_ALLOWED_ORIGIN`, and never send
production data here without an owner decision.
