import os, sys, re
from glob import glob
from zipfile import ZipFile, ZIP_STORED, ZIP_DEFLATED

resources = [
    "*.xul",
    "*.js",
    "icon*.png",
    "install.rdf", "chrome.manifest",
    "COPYING"
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

with ZipFile(destination, "w", ZIP_DEFLATED) as zp:
    for f in sorted(get_files(resources), key=str.lower):
        if f.endswith('.png'):
            zp.write(f, compress_type=ZIP_STORED)
        else:
            zp.write(f)
