#!/usr/bin/env python3
"""Safe V4.1 PAPER catalog release from existing WSL checkout.

Run through: git show FETCH_HEAD:scripts/release_v4_1.py |
             python3 - --manifest PATH --apply --acknowledge-proxy
Requires user consent (--apply), clean tracked files, verified pre-upgrade
source+PostgreSQL dump, and PAPER 500 EUR dashboard. It deliberately leaves
the scheduler PAUSED until 5-year backfill capacity is validated separately.

No real broker operations; no Yahoo requests; no deletion of existing candles.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from urllib.request import urlopen

ROOT=Path.cwd().resolve()
BRANCH="feature/v4-1-universe-collection"
API="http://127.0.0.1:3010"

def cmd(*args,capture=True,env=None,input_data=None):
    return subprocess.run(list(args),cwd=ROOT,capture_output=capture,
        input=input_data,check=True,env=env)

def git(*args):
    return cmd("git",*args).stdout.decode().strip()

def docker(*args):
    return cmd("docker","compose","-p","cto_weinstein",*args)

def dashboard():
    with urlopen(API+"/api/dashboard",timeout=12) as response:
        value=json.load(response)
    if value.get("mode")!="PAPER" or value.get("initial")!=500:
        raise RuntimeError("PAPER initial 500 EUR account is not healthy; release blocked")
    return value

def paper_fingerprint():
    sql="""SELECT md5(
      (SELECT COALESCE(string_agg(row_to_json(o)::text,'|' ORDER BY id),'') FROM orders o)
      || '#' ||
      (SELECT COALESCE(string_agg(row_to_json(r)::text,'|' ORDER BY instrument_id),'') FROM risk_stops r)
      || '#' ||
      (SELECT COALESCE(string_agg(row_to_json(s)::text,'|' ORDER BY key),'') FROM settings s)
    )"""
    return docker("exec","-T","db","psql","-At","-U","trader","-d","trader","-c",sql).stdout.decode().strip()

def read_release_manifest(path,ref):
    # Validate using the exact code from FETCH_HEAD before touching installed
    # sources or data. Archive is temporary and NEVER used to mutate the DB.
    with tempfile.TemporaryDirectory(prefix="cto_v41_verify_") as d:
        archive=cmd("git","archive","--format=tar",ref).stdout
        with tarfile.open(fileobj=__import__("io").BytesIO(archive),mode="r:") as tar:
            for x in tar.getmembers():
                if x.issym() or x.islnk() or x.name.startswith("/") or ".." in Path(x.name).parts:
                    raise ValueError("Unsafe release source archive")
            tar.extractall(d,filter="data")
        env=os.environ.copy()
        env["PYTHONPATH"]=d+"/scripts:"+d
        env["PYTHONDONTWRITEBYTECODE"]="1"
        result=subprocess.run([sys.executable,d+"/scripts/stage_v4_universe.py",str(path)],
                              cwd=d,env=env,capture_output=True,text=True)
        if result.returncode:
            raise RuntimeError("Manifest validation failed: "+(result.stderr or result.stdout)[-800:])
        parts=json.loads(Path(path).read_text(encoding="utf-8"))
        if parts.get("status")!="PREVIEWS_COMPLETE" or parts.get("total_rows")!=1105:
            raise RuntimeError("Expected exactly 503 S&P + 602 EXSA preview lines")
        if parts.get("validated_rows")!={"SP500":503,"STOXX600_ETF_PROXY":602}:
            raise RuntimeError("Source snapshot count mismatch")
        return parts

def guard_root():
    if not (ROOT/".git").exists() or not (ROOT/".env").is_file():
        raise RuntimeError("Must be run from existing WSL application checkout with .env")
    if Path(git("rev-parse","--show-toplevel")).resolve()!=ROOT:
        raise RuntimeError("Command must run from repository root")
    if git("status","--porcelain","--untracked-files=no"):
        raise RuntimeError("Tracked working tree has local modifications; no automatic overwrite")
    # Never allow checkout to overwrite an untracked file; Git itself will
    # enforce collisions on switch even when untracked files are present.
    # An explicit 'git fetch origin feature/...' is guaranteed to set
    # FETCH_HEAD, but is NOT guaranteed to update origin/feature/... .
    # Avoid incorrectly blocking users with single-ref fetch configurations.
    origin=git("remote","get-url","origin")
    if not (origin.startswith("https://github.com/besse79/cto-weinstein-trader") or
            origin.startswith("git@github.com:besse79/cto-weinstein-trader")):
        raise RuntimeError("Unrecognized GitHub origin: release source not trusted")
    target=git("rev-parse","FETCH_HEAD")
    branch_ref=subprocess.run(["git","rev-parse","--verify",
        "refs/remotes/origin/"+BRANCH],cwd=ROOT,capture_output=True,text=True)
    if branch_ref.returncode==0 and branch_ref.stdout.strip()!=target:
        raise RuntimeError("Origin tracking ref differs from FETCH_HEAD; fetch branch again")
    git("cat-file","-e",target+":scripts/stage_v4_universe.py")
    return target

def prior_backup():
    # Import the *currently deployed* backup implementation before switching
    # sources. No Git checkout until source+database archive has been verified.
    spec=importlib.util.spec_from_file_location("current_deploy",ROOT/"deploy_local.py")
    old=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)
    old.check_prerequisites()
    saved=old.backup()
    if not (saved/"postgres.dump").is_file():
        raise RuntimeError("Previous PostgreSQL backup absent: release blocked")
    import hashlib
    for line in (saved/"checksums.sha256").read_text().splitlines():
        expected,name=line.split("  ",1)
        h=hashlib.sha256((saved/name).read_bytes()).hexdigest()
        if expected!=h:raise RuntimeError("Verified backup checksum mismatch: "+name)
    return saved

def release(manifest,ref):
    previous_sha=git("rev-parse","HEAD")
    previous_branch=git("branch","--show-current") or "(detached)"
    was_running=bool(docker("--profile","automation","ps","-q","scheduler").stdout.strip())
    backup_dir=None
    switched=False
    try:
        docker("--profile","automation","stop","scheduler")
        original_paper=paper_fingerprint()
        backup_dir=prior_backup()
        state={"previous_sha":previous_sha,"previous_branch":previous_branch,
               "release_sha":ref,"manifest":str(manifest),"paper_sha256":original_paper,
               "scheduler_was_running":was_running,
               "at_utc":datetime.now(timezone.utc).isoformat()}
        note=backup_dir/"v4_1_release_state.json"
        note.write_text(json.dumps(state,indent=2),encoding="utf-8")
        note.chmod(0o600)
        docker("stop","web")
        # Unique local release branch, no reset, no force, no overwrite.
        name="v4-1-local-"+ref[:12]
        existing=subprocess.run(["git","show-ref","--verify","--quiet","refs/heads/"+name],
                                cwd=ROOT)
        if existing.returncode==0:
            if git("rev-parse",name)!=ref:
                raise RuntimeError("Conflicting release branch exists")
            git("switch",name)
        else:
            git("switch","-c",name,ref)
        switched=True
        env=os.environ.copy()
        # deploy_local starts the automation on normal WSL; explicitly leave
        # it PAUSED until the 1105-asset collector is proven under real load.
        env["GITHUB_ACTIONS"]="true"
        install=subprocess.run([sys.executable,"deploy_local.py"],cwd=ROOT,env=env,
                               capture_output=True,text=True)
        if install.returncode:
            raise RuntimeError("Application migration/start failure: "+install.stdout[-700:]+
                               install.stderr[-700:])
        dashboard()
        stage=subprocess.run([sys.executable,"scripts/stage_v4_universe.py",str(manifest),
                              "--apply","--acknowledge-proxy"],cwd=ROOT,
                             capture_output=True,text=True)
        if stage.returncode:
            raise RuntimeError("Atomic reference staging failed: "+stage.stderr[-900:]+
                               stage.stdout[-600:])
        coverage=json.load(urlopen(API+"/api/market/universe-coverage",timeout=30))
        indices={x["index_code"]:x["constituents"] for x in coverage.get("indices",[])}
        if indices.get("SP500")!=503 or indices.get("STOXX600_ETF_PROXY")!=602:
            raise RuntimeError("Observed database counts inconsistent: "+str(indices))
        if paper_fingerprint()!=original_paper:
            raise RuntimeError("PAPER orders, risk stops or settings changed unexpectedly; "+
                               "verified backup: "+str(backup_dir))
        dashboard()
        print(json.dumps({"status":"STAGED_PENDING_HISTORIES","git_sha":ref,
                          "index_rows":indices,"pre_upgrade_backup":str(backup_dir),
                          "scheduler":"PAUSED_INTENTIONALLY",
                          "next":"validate Yahoo year backfill in bounded batches"},indent=2))
        return 0
    except Exception as exc:
        print("V4.1 RELEASE BLOCKED: "+str(exc),file=sys.stderr)
        if backup_dir:
            print("Pre-upgrade verified backup retained: "+str(backup_dir),file=sys.stderr)
            print("Source before release: "+previous_branch+" "+previous_sha,file=sys.stderr)
        if not switched:
            try:docker("up","-d","web")
            except Exception:pass
            if was_running:
                try:docker("--profile","automation","up","-d","scheduler")
                except Exception:pass
        else:
            print("New code may be checked out. Scheduler is PAUSED: do not launch"+
                  " history jobs until recovery is reviewed.",file=sys.stderr)
        return 1

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--manifest",required=True,type=Path)
    ap.add_argument("--apply",action="store_true",help="Explicitly deploy and stage database catalogs")
    ap.add_argument("--acknowledge-proxy",action="store_true",help="EXSA holdings are NOT official index members")
    args=ap.parse_args()
    try:
        target=guard_root()
        manifest=args.manifest.expanduser().resolve(strict=True)
        data=read_release_manifest(manifest,target)
        print("V4.1 manifest validated:",data["total_rows"],"rows; release:",target)
        if not args.apply:
            print("DRY RUN ONLY: no checkout, database writes or scheduler changes")
            return 0
        if not args.acknowledge_proxy:
            raise RuntimeError("Explicit --acknowledge-proxy required")
        dashboard()
        return release(manifest,target)
    except Exception as exc:
        print("V4.1 RELEASE BLOCKED:",exc,file=sys.stderr)
        return 1

if __name__=="__main__":
    raise SystemExit(main())
