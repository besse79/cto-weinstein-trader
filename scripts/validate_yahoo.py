#!/usr/bin/env python3
"""Diagnostic Yahoo via l'application CTO locale, sans afficher APP_TOKEN."""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
BASE = "http://127.0.0.1:3010"
TIMEOUT = 130


def read_token():
    path = ROOT / ".env"
    if not path.is_file():
        raise RuntimeError("Fichier .env local absent : lancer deploy_local.py")
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("APP_TOKEN="):
            token = line.split("=", 1)[1].strip().strip('"').strip("'")
            if len(token) < 20:
                raise RuntimeError("APP_TOKEN local absent ou trop court")
            return token
    raise RuntimeError("APP_TOKEN non trouvé dans .env local")


def request(path, *, token=None, body=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["x-app-token"] = token
    if body is not None:
        headers["Content-Type"] = "application/json"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers=headers,
                                 method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT if body is not None else 12) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            data = json.load(exc)
        except (ValueError, OSError):
            data = {"error": "HTTP " + str(exc.code)}
        return exc.code, data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--import", dest="do_import", action="store_true",
                        help="Télécharger les historiques Yahoo sur demande explicite")
    args = parser.parse_args()
    try:
        _, initial = request("/api/dashboard")
        if initial.get("mode") != "PAPER" or initial.get("initial") != 500:
            raise RuntimeError("Mode fictif ou capital initial inattendu ; opération bloquée")
        initial_orders = len(initial.get("orders") or [])
        print("APPLICATION : PAPER, capital initial 500 EUR")
        if args.do_import:
            token = read_token()
            print("YAHOO : import manuel demandé, sans accès IBKR")
            status, result = request("/api/market/sync", token=token, body={"all": True})
            if status != 200 or not result.get("ok"):
                reason = result.get("detail") or result.get("error") or "erreur inconnue"
                print("YAHOO : IMPORT REFUSÉ (" + str(status) + ") : " + str(reason))
                print("Aucun contournement ni changement de fournisseur effectué.")
                return 2
            print("YAHOO : IMPORT RÉUSSI ; " + str(result.get("total")) + " bougies")
            for item in result.get("results", []):
                print("  {symbol} : {count} séances, {first} → {last}".format(**item))
        status, scanner = request("/api/scanner")
        if status != 200 or not isinstance(scanner.get("results"), list):
            raise RuntimeError("Scanner indisponible")
        print("SCANNER :")
        for item in scanner["results"]:
            print("  {symbol}: {signal} | dernier cours {date} | éligible={eligible}".format(
                symbol=item.get("symbol"), signal=item.get("signal"),
                date=(item.get("last") or {}).get("day", "absent"),
                eligible=bool(item.get("eligible"))))
        _, after = request("/api/dashboard")
        if (after.get("mode") != "PAPER" or after.get("initial") != 500
                or len(after.get("orders") or []) != initial_orders):
            raise RuntimeError("Anomalie : le mode paper ou les ordres ont changé")
        print("SÉCURITÉ : mode PAPER inchangé, aucun ordre créé par le diagnostic")
        if not args.do_import:
            print("Pour importer volontairement : python3 scripts/validate_yahoo.py --import")
        return 0
    except (RuntimeError, urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
        print("DIAGNOSTIC BLOQUÉ : " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
