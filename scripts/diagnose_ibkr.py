#!/usr/bin/env python3
"""Safe WSL diagnostic. Queries only the local CTO web API.
Never prints APP_TOKEN, credentials, conids or account identifiers.
No configuration changes and no broker orders.
"""
import json
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
APP_URL = "http://127.0.0.1:3010"

def environment():
    result = {}
    file = ROOT / ".env"
    if not file.exists():
        return result
    for line in file.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip()
    return result

def request(path, token=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["x-app-token"] = token
    req = Request(APP_URL + path, headers=headers)
    try:
        with urlopen(req, timeout=10) as response:
            return response.status, json.load(response)
    except HTTPError as err:
        return err.code, {}
    except (URLError, OSError, TimeoutError, ValueError):
        return None, {}

def main():
    print("=== CTO Weinstein Trader : diagnostic local, lecture seule ===")
    env = environment()
    status, dashboard = request("/api/dashboard")
    if status != 200 or dashboard.get("mode") != "PAPER":
        print("APPLICATION : INDISPONIBLE ou mode PAPER non confirmé")
        print("Vérifier Docker Desktop et les conteneurs du projet CTO (port 3010).")
        return 1
    print("APPLICATION : OK | Mode PAPER | Capital initial :",
          dashboard.get("initial"), "EUR")
    enabled = env.get("PAPER_AUTOMATION_ENABLED") == "true"
    print("PLANIFICATEUR :", "ACTIVÉ — vérification nécessaire" if enabled else "DÉSACTIVÉ")
    gateway = env.get("IBKR_GATEWAY_URL", "")
    if not gateway:
        print("GATEWAY IBKR : NON CONFIGURÉE (.env local)")
        print("Étape suivante : installer Client Portal Gateway puis renseigner IBKR_GATEWAY_URL.")
        return 0

    # Never print URL: it might contain credentials accidentally supplied by a user.
    token = env.get("APP_TOKEN", "")
    if not token:
        print("APP_TOKEN : ABSENT dans .env local")
        return 1
    code, body = request("/api/ibkr", token)
    if code == 401:
        print("CONTRÔLE IBKR : jeton local rejeté (APP_TOKEN incohérent)")
        return 1
    if code != 200:
        print("CONTRÔLE IBKR : API non disponible (code", code, ")")
        return 1
    ibkr = body.get("ibkr") or {}
    if body.get("realOrdersEnabled") is not False:
        print("CONTRÔLE DE SÉCURITÉ : ÉCHEC — indicateur realOrdersEnabled non désactivé")
        return 1
    if ibkr.get("connected") is True and ibkr.get("authenticated") is True:
        print("SESSION IBKR : AUTHENTIFIÉE (diagnostic serveur)")
        print("Étape suivante : résoudre et vérifier les contrats, puis importer l'historique.")
    else:
        print("SESSION IBKR : NON AUTHENTIFIÉE ou gateway inaccessible")
        reason = str(ibkr.get("reason", "Authentification non établie"))
        print("DIAGNOSTIC :", reason[:200])
        print("Vérifier la gateway locale, son certificat TLS et la connexion navigateur.")
    print("Aucun ordre réel ou fictif n'a été envoyé par ce diagnostic.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
