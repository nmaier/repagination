# vim: set nosmartindent et ts=4 sw=4 :

import os, sys, re
from glob import glob
from zipfile import ZipFile, ZIP_STORED, ZIP_DEFLATED

resources = [
    "install.rdf",
    "chrome.manifest",
    "*.xul",
    "*.js", "*.jsm",
    "*/*.dtd",
    "*/*.properties",
    "defaults/preferences/prefs.js",
    "icon.png", "icon64.png",
    "LICENSE"
    ]
destination = "repagination.xpi"

def get_files(resources):
    for r in resources:
        if os.path.isfile(r):
            yield r
        else:
            for g in glob(r):
                yield g

if os.path.exists(destination):
    print >>sys.stderr, destination, "is in the way"
    sys.exit(1)

class ZipOutFile(ZipFile):
    def __init__(self, zfile):
        ZipFile.__init__(self, zfile, "w", ZIP_STORED)
    def __enter__(self):
        return self
    def __exit__(self, type, value, traceback):
        self.close()

with ZipOutFile(destination) as zp:
    for f in sorted(get_files(resources), key=str.lower):
        zp.write(f)
