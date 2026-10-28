"""ORIENTech — serveur de l'app + API des sessions de classe (Python standard, aucune dépendance).

Lancer :  python serveur.py            (port 8000, accessible depuis les autres appareils du réseau)
          python serveur.py 8080       (autre port)

API (JSON) :
  POST /api/sessions                                  -> prof crée une session : {code, token}
  GET  /api/sessions/<code>?token=...                 -> prof lit l'état de la classe
  POST /api/sessions/<code>/lancer      {token}       -> prof lance la session
  POST /api/sessions/<code>/terminer    {token}       -> prof termine la session
  POST /api/sessions/<code>/eleves      {prenom}      -> élève rejoint : {id, token, phase}
  GET  /api/sessions/<code>/eleves/<id>?token=...     -> élève lit la phase (attente / direct / termine)
  POST /api/sessions/<code>/eleves/<id>/progression   {token, ...} -> élève envoie où il en est

Les sessions sont gardées en mémoire et sauvegardées dans data/sessions.json (survivent à un redémarrage).
"""
import json
import re
import secrets
import socket
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

DOSSIER = Path(__file__).resolve().parent
FICHIER = DOSSIER / "data" / "sessions.json"
LETTRES = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # sans 0/O, 1/I/L
MAX_ELEVES = 60
DUREE_VIE = 24 * 3600  # une session est oubliée 24 h après sa création

verrou = threading.Lock()
sessions = {}


def charger():
    global sessions
    try:
        sessions = json.loads(FICHIER.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        sessions = {}


def sauver():
    maintenant = time.time()
    for code in [c for c, s in sessions.items() if maintenant - s["cree"] > DUREE_VIE]:
        del sessions[code]
    FICHIER.write_text(json.dumps(sessions, ensure_ascii=False), encoding="utf-8")


def nouveau_code():
    while True:
        code = "".join(secrets.choice(LETTRES) for _ in range(6))
        if code not in sessions:
            return code


def vue_eleve(e):
    """Ce que le prof voit d'un élève (sans son token)."""
    return {k: v for k, v in e.items() if k != "token"}


# ---------- Nettoyage des données envoyées par les élèves

def entier(v, mini, maxi, defaut=0):
    return max(mini, min(maxi, int(v))) if isinstance(v, (int, float)) and not isinstance(v, bool) else defaut


def reel(v):
    return max(0.0, min(1.0, float(v))) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def texte(v, maxi):
    return str(v)[:maxi] if isinstance(v, str) else ""


def progression_propre(d):
    top3 = [{"id": texte(t.get("id"), 10), "p": reel(t.get("p"))}
            for t in (d.get("top3") or [])[:3] if isinstance(t, dict)]
    derniers = [{"texte": texte(r.get("texte"), 300), "oui": bool(r.get("oui"))}
                for r in (d.get("derniers") or [])[:4] if isinstance(r, dict)]
    return {
        "nbQuestions": entier(d.get("nbQuestions"), 0, 100),
        "confiance": reel(d.get("confiance")),
        "top3": top3,
        "derniers": derniers,
        "fini": bool(d.get("fini")),
        "metier": texte(d.get("metier"), 10),
        "affinite": entier(d.get("affinite"), 0, 100),
    }


# ---------- Routes

class Erreur(Exception):
    def __init__(self, statut, message):
        self.statut, self.message = statut, message


def session_prof(code, token):
    s = sessions.get(code)
    if not s:
        raise Erreur(404, "Session inconnue")
    if not token or not secrets.compare_digest(token, s["token"]):
        raise Erreur(403, "Accès refusé")
    return s


def eleve_de(code, eid, token):
    s = sessions.get(code)
    e = s and next((e for e in s["eleves"] if e["id"] == eid), None)
    if not e:
        raise Erreur(404, "Élève inconnu")
    if not token or not secrets.compare_digest(token, e["token"]):
        raise Erreur(403, "Accès refusé")
    return s, e


def router(methode, chemin, query, corps):
    parts = [p for p in chemin.split("/") if p][1:]  # sans le "api" de tête
    if parts[:1] != ["sessions"]:
        raise Erreur(404, "Route inconnue")
    code = parts[1].upper() if len(parts) > 1 else None
    tok_q = query.get("token", [""])[0]

    with verrou:
        if methode == "POST" and len(parts) == 1:
            code = nouveau_code()
            sessions[code] = {"code": code, "token": secrets.token_urlsafe(16), "phase": "attente",
                              "cree": time.time(), "eleves": []}
            sauver()
            return 201, {"code": code, "token": sessions[code]["token"]}

        if methode == "GET" and len(parts) == 2:
            s = session_prof(code, tok_q)
            return 200, {"code": code, "phase": s["phase"], "eleves": [vue_eleve(e) for e in s["eleves"]]}

        if methode == "POST" and len(parts) == 3 and parts[2] in ("lancer", "terminer"):
            s = session_prof(code, corps.get("token"))
            if parts[2] == "lancer" and s["phase"] == "attente":
                s["phase"] = "direct"
                for e in s["eleves"]:
                    e["statut"] = "jeu"
            elif parts[2] == "terminer":
                s["phase"] = "termine"
                for e in s["eleves"]:
                    if e["statut"] != "fini":
                        e["statut"] = "arrete"
            sauver()
            return 200, {"phase": s["phase"]}

        if methode == "POST" and len(parts) == 3 and parts[2] == "eleves":
            s = sessions.get(code)
            if not s:
                raise Erreur(404, "Ce code ne correspond à aucune session.")
            if s["phase"] == "termine":
                raise Erreur(409, "Cette session est terminée.")
            if len(s["eleves"]) >= MAX_ELEVES:
                raise Erreur(409, "La session est complète.")
            prenom = re.sub(r"\s+", " ", texte(corps.get("prenom"), 20)).strip()
            if not prenom:
                raise Erreur(400, "Prénom manquant.")
            e = {"id": secrets.token_hex(4), "token": secrets.token_urlsafe(12), "prenom": prenom,
                 "statut": "jeu" if s["phase"] == "direct" else "attente", "arrive": time.time(),
                 **progression_propre({})}
            s["eleves"].append(e)
            sauver()
            return 201, {"id": e["id"], "token": e["token"], "phase": s["phase"]}

        if methode == "GET" and len(parts) == 4 and parts[2] == "eleves":
            s, _ = eleve_de(code, parts[3], tok_q)
            return 200, {"phase": s["phase"]}

        if methode == "POST" and len(parts) == 5 and parts[2] == "eleves" and parts[4] == "progression":
            s, e = eleve_de(code, parts[3], corps.get("token"))
            if s["phase"] == "direct" and e["statut"] != "arrete":
                e.update(progression_propre(corps))
                e["statut"] = "fini" if e["fini"] else "jeu"
                sauver()
            return 200, {"phase": s["phase"]}

    raise Erreur(404, "Route inconnue")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DOSSIER), **kw)

    def log_message(self, fmt, *args):  # journal discret : seulement les appels API
        if "/api/" in (self.path or ""):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def repondre(self, statut, donnees):
        corps = json.dumps(donnees, ensure_ascii=False).encode("utf-8")
        self.send_response(statut)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def api(self, methode):
        url = urlparse(self.path)
        corps = {}
        if methode == "POST":
            taille = int(self.headers.get("Content-Length") or 0)
            if taille > 20_000:
                return self.repondre(413, {"erreur": "Requête trop grosse"})
            try:
                corps = json.loads(self.rfile.read(taille) or b"{}")
                if not isinstance(corps, dict):
                    raise ValueError
            except ValueError:
                return self.repondre(400, {"erreur": "JSON invalide"})
        try:
            self.repondre(*router(methode, url.path, parse_qs(url.query), corps))
        except Erreur as err:
            self.repondre(err.statut, {"erreur": err.message})

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.api("GET")
        if self.path.startswith("/data/sessions.json"):
            return self.repondre(404, {"erreur": "Introuvable"})
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self.api("POST")
        self.repondre(405, {"erreur": "Méthode non autorisée"})


def ip_locale():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    charger()
    print(f"ORIENTech en ligne :\n  sur ce PC          http://localhost:{port}\n"
          f"  pour les élèves    http://{ip_locale()}:{port}   (même Wi-Fi)", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
