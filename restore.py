#!/usr/bin/env python3
"""Verify an installer backup or explicitly restore the paper PostgreSQL database."""
import argparse
from datetime import datetime,timezone
import secrets
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
        # Always restore into a NEW database first. Attempting --clean on
        # an existing database can fail on foreign-key dependencies and leave
        # a partially restored dataset. The old trader DB must remain intact.
        scheduler_was_running=bool(docker("--profile","automation","ps","-q","scheduler").stdout.strip())
        docker("--profile","automation","stop","scheduler")
        docker("stop","web")
        docker("up","-d","db")
        docker("exec","-T","db","pg_restore","--list",input_data=dump.read_bytes())
        nonce=secrets.token_hex(3)
        suffix=datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")+"_"+nonce
        scratch="trader_restore_"+suffix
        previous="trader_previous_"+suffix
        def sql(command,database="postgres"):
            return docker("exec","-T","db","psql","-v","ON_ERROR_STOP=1",
                          "-U","trader","-d",database,"-c",command).stdout
        swapped=False
        try:
            sql("CREATE DATABASE "+scratch+" OWNER trader")
            docker("exec","-T","db","pg_restore","--exit-on-error",
                   "--no-owner","--no-acl","-U","trader","-d",scratch,
                   input_data=dump.read_bytes())
            mode=sql("SELECT value FROM settings WHERE key='paper_only'",scratch).decode()
            capital=sql("SELECT value FROM settings WHERE key='initial_cash'",scratch).decode()
            if "true" not in mode or "500" not in capital:
                raise RuntimeError("Scratch restore is not a valid 500 EUR PAPER account")
            # End existing database sessions before renaming. Both web and
            # scheduler have already been stopped.
            sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                "WHERE datname='trader' AND pid <> pg_backend_pid()")
            sql("ALTER DATABASE trader RENAME TO "+previous)
            try:
                sql("ALTER DATABASE "+scratch+" RENAME TO trader")
                swapped=True
            except Exception:
                sql("ALTER DATABASE "+previous+" RENAME TO trader")
                raise
        except Exception:
            if not swapped:
                try:
                    sql("DROP DATABASE IF EXISTS "+scratch+" WITH (FORCE)")
                except Exception: pass
            try:docker("up","-d","web")
            except Exception:pass
            if scheduler_was_running:
                try:docker("--profile","automation","up","-d","scheduler")
                except Exception:pass
            raise
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
        if scheduler_was_running:
            docker("--profile","automation","up","-d","scheduler")
        print("Restored database and source from",folder)
        print("PREVIOUS DATABASE RETAINED:",previous)
        return 0
    except Exception as exc:
        print("RESTORE FAILED:",exc,file=sys.stderr)
        return 1

if __name__=="__main__":sys.exit(main())
