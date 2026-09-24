"""
Compat layer for Termux compiled builds.

`commands.py` imports `decryptor` as:
    from pysqlsimplecipher import decryptor

In some Termux packages, `decryptor` may be compiled as a top-level extension module
(`decryptor.cpython-*.so`) instead of `pysqlsimplecipher/decryptor.cpython-*.so`.
Expose it here so the import keeps working.
"""

try:
    import decryptor as decryptor  # type: ignore
except Exception:  # pragma: no cover
    decryptor = None  # type: ignore

try:
    import encryptor as encryptor  # type: ignore
except Exception:  # pragma: no cover
    encryptor = None  # type: ignore

try:
    import util as util  # type: ignore
except Exception:  # pragma: no cover
    util = None  # type: ignore

