"""Step 1: serve the owner-selected Laya ENGLISH checkpoint on loopback, pinned and authenticated.

    LAYA_API_KEY_FILE=C:/pzm/stack/secrets/laya.key  python -I stack/laya/serve_pinned.py

What this adds to `laya.serve` (laya 0.4.0, NandhaKishorM/laya @ 3cf26cb):
  * the checkpoint is the verified local copy of convaiinnovations/laya (weights identical at the
    runtime's reviewed pin 55cf4c4 and at 7b928d8); its SHA-256 is checked before anything loads;
  * HF_HUB_OFFLINE=1: nothing is downloaded, so nothing can change under us;
  * every request is answered by `english`. Laya would otherwise route non-Latin script (Thai) to
    the multilingual checkpoint; the owner selected English, so that swap is refused here and the
    multilingual checkpoint is only ever measured as a separate, proposed addition;
  * bind is 127.0.0.1 whatever the environment says; an API key is required (read from a file
    outside Git), so /v1/systemone is never open even to other local users.
"""
import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PINS = json.loads((HERE.parent / "pins.json").read_text(encoding="utf-8"))
# english = the owner's checkpoint (default). multilingual = the owner-approved ADDITIONAL model,
# served by its own process on its own port, never swapped in for english.
CKPT = os.environ.get("PZM_LAYA_CHECKPOINT", "english")
if CKPT not in ("english", "multilingual"):
    sys.exit("PZM_LAYA_CHECKPOINT must be english or multilingual")
EN = PINS["laya"]["checkpoints"][CKPT]
DIR = Path(os.environ.get("PZM_LAYA_DIR", EN["localDir"]))


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    key_file = os.environ.get("LAYA_API_KEY_FILE")
    if not key_file or not Path(key_file).is_file():
        sys.exit("LAYA_API_KEY_FILE must name a file holding the API key (kept outside Git)")
    key = Path(key_file).read_text(encoding="utf-8").strip()
    if len(key) < 32:
        sys.exit("API key too short")
    for rel, want in EN["sha256"].items():
        got = sha256(DIR / rel)
        if got != want:
            sys.exit(f"{rel}: sha256 {got} != pinned {want}; refusing to load")
    print(f"[pzm-laya] verified {len(EN['sha256'])} artifacts in {DIR}", flush=True)

    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["LAYA_API_KEY"] = key
    os.environ["LAYA_HOST"] = "127.0.0.1"
    os.environ.setdefault("LAYA_PORT", "7340" if CKPT == "english" else "7341")
    os.environ.setdefault("LAYA_THREADS", "6")  # physical cores on the i5-10400
    os.environ["LAYA_MODELS"] = CKPT

    from laya import serve
    from laya.router import Router

    class OneCheckpoint(Router):
        """This process's checkpoint for every request; a caller cannot select another."""

        def predict(self, state, questions, *args, **kwargs):
            kwargs["model"] = CKPT
            return super().predict(state, questions, *args, **kwargs)

    def build():
        serve._apply_thread_limit()
        r = OneCheckpoint(models={CKPT: str(DIR)}, default=CKPT, max_loaded=1, device="cpu")
        r.preload([CKPT])
        return r

    serve.build_router = build
    serve.main()


if __name__ == "__main__":
    main()
