#!/usr/bin/env python3
"""Read-only diagnostics for CTO Weinstein and local IBKR Client Portal Gateway.
No credentials are requested or printed. No network access except localhost.
"""
import json
import os
from pathlib import Path
import socket
import ssl
import sys
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

HOME=Path.home()
ROOT=Path(__file__).resolve().parent
def local_env():
    file=ROOT/'.env'
    values={}
    if file.exists():
        for line in file.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key,val=line.split('=',1)
                values[key]=val.strip()
    return values
def check_http(url, method='GET'):
    try:
        with urlopen(Request(url,method=method),timeout=4) as response:
            raw=response.read(200000)
            try: return response.status,json.loads(raw)
            except Exception: return response.status,None
    except HTTPError as err: return err.code,None
    except (URLError,TimeoutError,OSError) as err: return None,type(err).__name__
def check_gateway(port):
    try:
        with socket.create_connection(('127.0.0.1',port),timeout=3):
            return True
    except OSError: return False
def main():
    env=local_env()
    print('CTO Weinstein — diagnostic local (sans secrets)')
    app,body=check_http('http://127.0.0.1:3010/api/dashboard')
    if app==200 and isinstance(body,dict) and body.get('mode')=='PAPER':
        print('APPLICATION : OK · PAPER · capital initial',body.get('initial'),'EUR')
    else:
        print('APPLICATION : INDISPONIBLE OU NON PAPER')
    print('AUTOMATISATION :', 'ACTIVE — à contrôler' if env.get('PAPER_AUTOMATION_ENABLED')=='true' else 'DÉSACTIVÉE')
    url=env.get('IBKR_GATEWAY_URL','')
    if not url:
        print('IBKR : NON CONFIGURÉ — aucune gateway déclarée dans .env')
        print('Documentation : https://www.interactivebrokers.com/campus/trading-lessons/launching-and-authenticating-the-gateway/')
        return 0
    from urllib.parse import urlparse
    p=urlparse(url)
    if p.hostname not in ('localhost','127.0.0.1','host.docker.internal') or p.scheme not in ('https','http'):
        print('IBKR : URL REFUSÉE (gateway locale uniquement)')
        return 1
    port=p.port or (443 if p.scheme=='https' else 80)
    print('IBKR : gateway configurée sur',p.hostname,'port',port,'; validation TLS requise')
    if not check_gateway(port):
        print('IBKR : aucun service détecté sur le port local',port)
        return 0
    if p.scheme=='https':
        try:
            ctx=ssl.create_default_context()
            with socket.create_connection(('127.0.0.1',port),timeout=4) as sock:
                with ctx.wrap_socket(sock,server_hostname='localhost'):
                    pass
            print('IBKR : service joignable, certificat TLS approuvé')
        except ssl.SSLError:
            print('IBKR : service présent, mais certificat non approuvé (aucune désactivation TLS effectuée)')
            return 0
        except OSError:
            print('IBKR : TLS inaccessible')
            return 0
    code,reply=check_http('http://127.0.0.1:3010/api/dashboard')
    print('APPLICATION API :', 'OK' if code==200 and isinstance(reply,dict) and reply.get('mode')=='PAPER' else 'ANOMALIE')
    print('Pour contrôler l’authentification IBKR, utiliser le panneau dans Trades du matin et votre jeton APP_TOKEN local.')
    return 0

if __name__=='__main__':
    sys.exit(main())
