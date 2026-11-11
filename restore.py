#!/usr/bin/env python3
"""Verify an installer backup or explicitly restore the paper PostgreSQL database."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import sys
import tarfile

PROJECT="cto_weinstein"
ROOT=Path(__file__).resolve().parent

def sha256(path):
    h=hashlib.sha256()
    with open(path,"rb") as fp:
        for block in iter(lambda:fp.read(1048576),b""):h.update(block)
    return h.hexdigest()

def verify(folder):
    manifest=(folder/"checksums.sha256").read_text()
    for line in manifest.splitlines():
        expected,name=line.split("  ",1)
        target=folder/name
        if not target.is_file() or sha256(target)!=expected:raise RuntimeError("Checksum mismatch: "+name)
    with tarfile.open(folder/"source.tar.gz","r:gz") as tar:
        members=tar.getmembers()
        if not members or any(not m.isfile() or m.name.startswith("/") or ".." in Path(m.name).parts for m in members):
            raise RuntimeError("Unsafe or empty source backup")
    print("Verified:",folder)

def docker(*args,input_data=None):
    return subprocess.run(["docker","compose","-p",PROJECT,*args],cwd=ROOT,input=input_data,check=True,capture_output=True)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("backup",type=Path)
    p.add_argument("--apply",action="store_true",help="Restore database and backed-up source after explicit confirmation")
    args=p.parse_args()
    folder=args.backup.expanduser().resolve()
    try:
        verify(folder)
        if not args.apply:return 0
        dump=folder/"postgres.dump"
        if not dump.exists():raise RuntimeError("No pre-existing database dump in this first-install backup")
        if input("Type RESTORE to overwrite local paper DB and source: ")!="RESTORE":
            raise RuntimeError("Restore cancelled")
        docker("stop","web")
        docker("up","-d","db")
        docker("exec","-T","db","pg_restore","--list",input_data=dump.read_bytes())
        # The restore is destructive and intentionally never called automatically.
        docker("exec","-T","db","pg_restore","--clean","--if-exists","--no-owner","-U","trader","-d","trader",input_data=dump.read_bytes())
        with tarfile.open(folder/"source.tar.gz","r:gz") as tar:
            for member in tar.getmembers():
                if member.name.startswith("/") or ".." in Path(member.name).parts or not member.isfile():
                    raise RuntimeError("Unsafe archive member")
                dest=ROOT/member.name
                dest.parent.mkdir(parents=True,exist_ok=True)
                with tar.extractfile(member) as src, open(dest,"wb") as dst:
                    import shutil
                    shutil.copyfileobj(src,dst)
        docker("up","-d","web")
        print("Restored database and source from",folder)
        return 0
    except Exception as exc:
        print("RESTORE FAILED:",exc,file=sys.stderr)
        return 1

if __name__=="__main__":sys.exit(main())
