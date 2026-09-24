#!/bin/bash
# Install from any working directory; never announce success after a failed step.
set -euo pipefail
SCRIPT_PATH="${BASH_SOURCE[0]}"
SCRIPT_DIR="${SCRIPT_PATH%/*}"
if [ "$SCRIPT_DIR" = "$SCRIPT_PATH" ]; then SCRIPT_DIR=.; fi
ROOT="$(cd -- "$SCRIPT_DIR" && pwd)"
cd "$ROOT"
PYTHON_BIN="${PYTHON_BIN:-python}"
trap 'status=$?; echo "[ERROR] Installation stopped at line $LINENO (exit $status). Fix the error above and rerun this installer." >&2; exit "$status"' ERR

check_froniner() {
  "$PYTHON_BIN" - "$1" <<'PY'
import importlib
from pathlib import Path
import struct
import sys

errors = []
data = {}
for name in ('zstd_dict.candidate.bin', 'proto/_descriptor_set.pb'):
    try:
        data[name] = Path(name).read_bytes()
        if not data[name]:
            raise ValueError('file is empty')
        print('[OK] ' + name + ': ' + str(len(data[name])) + ' bytes')
    except (OSError, ValueError) as exc:
        errors.append(name + ': ' + str(exc))
raw = data.get('zstd_dict.candidate.bin')
if raw:
    if len(raw) < 8 or raw[:4] != b'\x37\xa4\x30\xec':
        errors.append('zstd_dict.candidate.bin: invalid dictionary header')
    elif struct.unpack('<I', raw[4:8])[0] != 315060143:
        errors.append('zstd_dict.candidate.bin: expected dictionary ID 315060143')

if sys.argv[1] != 'files':
    if raw:
        try:
            import zstandard as zstd
            dictionary = zstd.ZstdCompressionDict(raw)
            if dictionary.dict_id() != 315060143:
                raise ValueError('expected dictionary ID 315060143')
            sample = b'froniner installer decoder self-test'
            frame = zstd.ZstdCompressor(dict_data=dictionary).compress(sample)
            if zstd.ZstdDecompressor(dict_data=dictionary).decompress(frame) != sample:
                raise ValueError('dictionary round-trip failed')
            print('[OK] FRONINER Zstandard dictionary ID 315060143; round-trip passed')
        except Exception as exc:
            errors.append('Zstandard decoder: ' + type(exc).__name__ + ': ' + str(exc))
    if data.get('proto/_descriptor_set.pb'):
        try:
            from google.protobuf import descriptor_pb2, descriptor_pool, message_factory
            fdset = descriptor_pb2.FileDescriptorSet()
            fdset.ParseFromString(data['proto/_descriptor_set.pb'])
            pool = descriptor_pool.DescriptorPool()
            pending = list(fdset.file)
            loaded = set()
            while pending:
                progressed = False
                for item in pending[:]:
                    if all(dep in loaded for dep in item.dependency):
                        pool.Add(item)
                        loaded.add(item.name)
                        pending.remove(item)
                        progressed = True
                if not progressed:
                    raise ValueError('unresolved protobuf dependencies in descriptor file')
            for name in ('StartResponse', 'CommandResponse', 'TransitRoundResponse', 'ResumeResponse'):
                desc = pool.FindMessageTypeByName('pb.api.kobetu_battle.' + name)
                cls = (message_factory.GetMessageClass(desc) if hasattr(message_factory, 'GetMessageClass')
                       else message_factory.MessageFactory(pool).GetPrototype(desc))
                cls()
            print('[OK] FRONINER protobuf Start/Command/Transit/Resume classes loaded')
        except Exception as exc:
            errors.append('Protobuf decoder: ' + type(exc).__name__ + ': ' + str(exc))
    if sys.argv[1] == 'all':
        for name in ('requests', 'colorama', 'bs4', 'orator', 'pendulum', 'Crypto', 'Cryptodome', 'prompt_toolkit', 'wcwidth'):
            try:
                importlib.import_module(name)
            except Exception as exc:
                errors.append(name + ': ' + type(exc).__name__ + ': ' + str(exc))
for error in errors:
    print('[ERROR] ' + error, file=sys.stderr)
if errors:
    print('[ERROR] Required runtime files/libraries are not ready. No game account was opened.', file=sys.stderr)
    raise SystemExit(1)
print('[OK] FRONINER ' + ('package files present' if sys.argv[1] == 'files' else 'decoder ready (offline check only)'))
PY
}

case "${1:-}" in
  --check-froniner) check_froniner decoder; exit 0 ;;
  --check-froniner-files) check_froniner files; exit 0 ;;
  '') ;;
  *) echo "Usage: bash install_termux.sh [--check-froniner|--check-froniner-files]" >&2; exit 2 ;;
esac

echo "========================================"
echo "   DokkanBot - Install Termux"
echo "========================================"
check_froniner files

echo "[1/4] Install System Packages..."
pkg update -y
pkg install -y libandroid-support openssl sqlcipher termux-api clang make pkg-config python-pip
echo "NOTE: To open a browser automatically, also install the Termux:API Android app."

echo "[2/4] Install Python Packages..."
# Termux manages pip through python-pip. Do not use pip install --upgrade pip.
# Use the same interpreter that started setup.py / setup.pyc.
"$PYTHON_BIN" -m pip install requests colorama beautifulsoup4 pycryptodome pycryptodomex prompt_toolkit wcwidth
"$PYTHON_BIN" -m pip install zstandard
"$PYTHON_BIN" -m pip install protobuf

# Optional Python SQLCipher binding; the bot also supports the system CLI.
"$PYTHON_BIN" -m pip install sqlcipher3-binary 2>/dev/null || "$PYTHON_BIN" -m pip install sqlcipher3 2>/dev/null || echo "Note: Python sqlcipher3 not installed (CLI will be used)"

# Preserve the legacy Orator dependency choices used by this bot.
"$PYTHON_BIN" -m pip install Pygments blinker cleo==0.6.8 inflection==0.3.1 lazy-object-proxy pyaml==16.12.2 backpack faker==0.8.18 pytz pytzdata tzlocal==1.5.1 python-dateutil wrapt "pendulum>=1.4,<2.0"
"$PYTHON_BIN" -m pip install orator --no-deps

echo "[3/4] Checking bundled pysqlsimplecipher..."
# This is a bundled module, not an editable pip project (no setup.py/pyproject.toml).
if [ ! -f "pysqlsimplecipher/__init__.py" ]; then
  echo "[ERROR] Missing bundled pysqlsimplecipher/__init__.py. Recopy the full bot package." >&2
  exit 1
fi

echo "[4/4] Checking installed libraries and FRONINER decoder..."
check_froniner all
sqlcipher --version
echo "========================================"
echo "INSTALLATION COMPLETE!"
echo "========================================"
if [ -f launcher.py ]; then
  echo "Run bot: $PYTHON_BIN launcher.py"
else
  echo "Run bot: $PYTHON_BIN launcher.pyc"
fi
