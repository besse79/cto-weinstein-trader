#!/usr/bin/env python3
"""Safe local WSL deployment: first install or update of the isolated paper application."""
import argparse
import hashlib
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent
PROJECT = "cto_weinstein"
BACKUPS = Path.home() / "cto-weinstein-backups"
PORT = 3010

def run(args, *, input_data=None, capture=False, check=True):
    return subprocess.run(args, cwd=ROOT, input=input_data, capture_output=capture, check=check)

def docker(*args, **kw):
    return run(["docker", "compose", "-p", PROJECT, *args], **kw)

def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as fp:
        for block in iter(lambda: fp.read(1048576), b""):
            h.update(block)
    return h.hexdigest()

def ensure_env():
    path = ROOT / ".env"
    if path.exists():
        mode = path.stat().st_mode & 0o777
        if mode & 0o077:
            path.chmod(0o600)
        data=path.read_text()
        if "CHANGE_ME" in data:
            raise RuntimeError("Existing .env contains placeholder secrets; refusing deployment")
        return
    values = [
        "POSTGRES_PASSWORD="+secrets.token_urlsafe(36),
        "APP_TOKEN="+secrets.token_urlsafe(48),
        "IBKR_GATEWAY_URL=",
        "IBKR_CONIDS_JSON={}",
        "IBKR_SYNC_SYMBOLS=",
        "PAPER_AUTOMATION_ENABLED=false",
    ]
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as fp:
        fp.write("\n".join(values)+"\n")

def project_exists():
    result = docker("ps", "-a", "--quiet", capture=True)
    return bool(result.stdout.strip())

def backup():
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    BACKUPS.chmod(0o700)
    suffix=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    folder=BACKUPS / suffix
    folder.mkdir(mode=0o700)
    tar_path=folder/"source.tar.gz"
    with tarfile.open(tar_path,"w:gz") as tar:
        for file in ROOT.rglob("*"):
            if file.is_symlink() or not file.is_file() or any(p in {".git","node_modules",".next"} for p in file.relative_to(ROOT).parts):
                continue
            tar.add(file,arcname=str(file.relative_to(ROOT)),recursive=False)
    archive_hash=digest(tar_path)
    with tarfile.open(tar_path,"r:gz") as tar:
        assert tar.getmembers(), "Empty source backup"
        assert all(m.isfile() and not m.name.startswith("/") and ".." not in Path(m.name).parts for m in tar.getmembers())
    if digest(tar_path)!=archive_hash: raise RuntimeError("Invalid source archive checksum")

    # A previously initialized PostgreSQL volume MUST be dumped before application start.
    if project_exists():
        docker("up","-d","--wait","db")
        result=docker("exec","-T","db","pg_dump","-U","trader","-d","trader","-Fc",capture=True)
        if not result.stdout: raise RuntimeError("Empty database dump")
        dump=folder/"postgres.dump"
        dump.write_bytes(result.stdout)
        verified=docker("exec","-T","db","pg_restore","--list",input_data=result.stdout,capture=True)
        if b"TABLE" not in verified.stdout: raise RuntimeError("PostgreSQL archive verification failed")
        (folder/"checksums.sha256").write_text(f"{digest(tar_path)}  source.tar.gz\n{digest(dump)}  postgres.dump\n")
    else:
        (folder/"checksums.sha256").write_text(f"{digest(tar_path)}  source.tar.gz\n")
    print("Verified backup:",folder)
    return folder

def check_prerequisites():
    if shutil.which("docker") is None: raise RuntimeError("Docker unavailable in WSL")
    run(["docker","info"],capture=True)
    run(["docker","compose","version"],capture=True)
    if not (ROOT/"docker-compose.yml").is_file(): raise RuntimeError("Missing compose configuration")
    print("Docker and Compose tooling: OK")

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--check",action="store_true",help="Check Docker only; no changes")
    args=parser.parse_args()
    try:
        check_prerequisites()
        if args.check: return 0
        ensure_env()
        docker("config","--quiet")
        backup()
        # Never start the opt-in automation profile. No real trading endpoints exist.
        docker("up","-d","--wait","db","web")
        url=f"http://127.0.0.1:{PORT}/api/dashboard"
        import time
        for _ in range(90):
            try:
                with urlopen(url,timeout=3) as response:
                    import json
                    body=json.load(response)
                    if response.status==200 and body.get("mode")=="PAPER":
                        print(f"READY: http://localhost:{PORT}  | paper capital: {body.get('initial')} EUR")
                        return 0
            except Exception: pass
            time.sleep(2)
        raise RuntimeError("Application did not respond with PAPER dashboard; inspect docker compose logs")
    except Exception as exc:
        print("DEPLOYMENT BLOCKED:",exc,file=sys.stderr)
        return 1

if __name__=="__main__":
    sys.exit(main())
