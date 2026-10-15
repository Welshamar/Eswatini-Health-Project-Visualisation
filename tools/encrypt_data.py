"""Encrypt the TB patient rows into assets/tb-data.enc.js for the website.

The website never holds readable patient data: the rows are encrypted with
AES-256-GCM using a key derived from a password (PBKDF2-SHA256), and the
browser decrypts them only after someone types that password.

Usage:
    pip install cryptography
    python tools/encrypt_data.py rows.json                 # asks for the password
    python tools/encrypt_data.py rows.json -o assets/tb-data.enc.js

rows.json is a JSON array of rows, one per patient, in this order:
    0 area, 1 constituency, 2 region, 3 MDR-TB (0/1), 4 HIV positive (0/1),
    5 sex, 6 age (years), 7 died (0/1), 8 lat, 9 lon,
    10 spread lat, 11 spread lon   (where to draw it when stacked points are spread)

Keep rows.json and the password OUT of this repository.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import sys

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 250_000
MIN_PASSWORD_LENGTH = 12


def check_rows(rows) -> None:
    if not isinstance(rows, list) or not rows:
        raise ValueError("expected a non-empty JSON array of rows")
    for i, r in enumerate(rows):
        if not isinstance(r, list) or len(r) != 12:
            raise ValueError(f"row {i}: expected 12 fields, got {r!r:.80}")
        if r[3] not in (0, 1) or r[4] not in (0, 1) or r[7] not in (0, 1):
            raise ValueError(f"row {i}: MDR, HIV and died must be 0 or 1")
        for k in (6, 8, 9, 10, 11):
            if not isinstance(r[k], (int, float)) or isinstance(r[k], bool):
                raise ValueError(f"row {i}: field {k} must be a number")
        if not (-28 <= r[8] <= -25 and 30 <= r[9] <= 33):
            raise ValueError(f"row {i}: coordinates {r[8]}, {r[9]} are outside Eswatini")


def encrypt(rows, password: str) -> dict:
    salt = os.urandom(16)
    iv = os.urandom(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS)
    key = kdf.derive(password.encode("utf-8"))
    plain = json.dumps(rows, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    data = AESGCM(key).encrypt(iv, plain, None)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return {"salt": b64(salt), "iv": b64(iv), "data": b64(data), "iterations": ITERATIONS}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("rows", help="JSON file with the patient rows")
    ap.add_argument("-o", "--output", default="assets/tb-data.enc.js")
    ap.add_argument("--password-env", metavar="VAR", help="read the password from this environment variable instead of asking")
    args = ap.parse_args(argv)

    with open(args.rows, encoding="utf-8") as fh:
        rows = json.load(fh)
    check_rows(rows)

    if args.password_env:
        password = os.environ.get(args.password_env, "")
    else:
        password = getpass.getpass("Password: ")
        if getpass.getpass("Repeat password: ") != password:
            print("Passwords do not match.", file=sys.stderr)
            return 1
    if len(password) < MIN_PASSWORD_LENGTH:
        # The encrypted file is public on the website, so a short password can
        # be guessed offline no matter how many PBKDF2 iterations it has.
        print(f"Use a password of at least {MIN_PASSWORD_LENGTH} characters.", file=sys.stderr)
        return 1

    payload = encrypt(rows, password)
    with open(args.output, "w", encoding="utf-8") as fh:
        fh.write("window.ENCRYPTED_PAYLOAD = " + json.dumps(payload) + ";\n")
    print(f"Wrote {len(rows)} encrypted rows to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
