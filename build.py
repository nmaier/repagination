# vim: set nosmartindent et ts=4 sw=4 :

import os
import re
import sys

from contextlib import contextmanager as ctx
from glob import glob

from zipfile import ZipFile, ZIP_STORED, ZIP_DEFLATED

resources = [
    "manifest.json",
    "_locales/*/messages.json",
    "icon.png", "icon32.png", "icon64.png",
    "LICENSE.txt",
    "*.js", "options.html"
    ]
destination = "repagination.xpi"


try:
    from xpisign.context import ZipFileMinorCompression as Minor
except ImportError:
    from warnings import warn
    warn("No optimal compression available; install xpisign")

    @ctx
    def Minor():
        yield


def get_files(resources):
    for r in resources:
        if os.path.isfile(r):
            yield r
            continue
        for g in glob(r):
            yield g


class ZipOutFile(ZipFile):
    def __init__(self, zfile):
        ZipFile.__init__(self, zfile, "w", ZIP_DEFLATED)

    def __enter__(self):
        return self

    def __exit__(self, type, value, traceback):
        self.close()


# if os.path.exists(destination):
    # print >>sys.stderr, destination, "is in the way"
    # sys.exit(1)

with Minor(), ZipOutFile(destination) as zp:
    for f in sorted(get_files(resources), key=str.lower):
        compress_type = ZIP_STORED if f.endswith(".png") else ZIP_DEFLATED
        zp.write(f, compress_type=compress_type)
