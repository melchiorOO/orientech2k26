"""ORIENTech — serveur de l'app + API (Python standard, aucune dépendance). Même API que api/router.js (Vercel).

Lancer :  python serveur.py            (port 8000, accessible depuis les autres appareils du réseau)
          python serveur.py 8080       (autre port)

API (JSON) :
  Sessions de classe
    POST /api/sessions                                  -> prof crée une session : {code, token}
    GET  /api/sessions/<code>?token=...                 -> prof lit l'état de la classe
    POST /api/sessions/<code>/lancer      {token}       -> prof lance la session
    POST /api/sessions/<code>/terminer    {token}       -> prof termine la session
    POST /api/sessions/<code>/eleves      {prenom}      -> élève rejoint : {id, token, phase}
    GET  /api/sessions/<code>/eleves/<id>?token=...     -> élève lit la phase (attente / direct / termine)
    POST /api/sessions/<code>/eleves/<id>/progression   {token, seq, ...} -> élève envoie où il en est
  Contenu du jeu
    GET  /api/donnees                                   -> fiches + matrice enregistrées par l'admin (ou null)
    POST /api/contributions   {metier, contributeur, reponses}  -> un·e pro propose son métier
  Admin (en-tête X-Admin = mot de passe ADMIN_MOT_DE_PASSE)
    GET  /api/admin/verifier                            -> teste le mot de passe
    POST /api/admin/donnees    {metiers, questions}     -> enregistre fiches + matrice (visibles par tous)
    POST /api/admin/donnees/reinitialiser               -> revient aux données du fichier Excel
    GET  /api/admin/contributions                       -> liste des propositions des pros
    POST /api/admin/contributions/<id>   {statut}       -> acceptee / rejetee

Données gardées dans data/sessions.json (24 h), data/donnees.json et data/contributions.json (jamais servis tels quels).
Le mot de passe admin est lu dans la variable d'environnement ADMIN_MOT_DE_PASSE, sinon dans .env.local.
"""
import json
import math
import os
import re
import secrets
import socket
import sys
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

DOSSIER = Path(__file__).resolve().parent
FICHIER = DOSSIER / "data" / "sessions.json"
FICHIER_DONNEES = DOSSIER / "data" / "donnees.json"
FICHIER_CONTRIBUTIONS = DOSSIER / "data" / "contributions.json"
FICHIERS_PRIVES = {"sessions.json", "donnees.json", "contributions.json"}
LETTRES = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # sans 0/O, 1/I/L
MAX_ELEVES = 60
MAX_CONTRIBUTIONS = 500
DUREE_VIE = 24 * 3600  # une session est oubliée 24 h après sa création
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,12}$")
TAILLE_MAX = {"/api/admin/donnees": 1_000_000, "/api/contributions": 50_000}  # octets ; 20 Ko pour le reste

verrou = threading.Lock()
sessions = {}
donnees = None
contributions = {}
_sessions_a_sauver = False


# ---------- Fichiers (écriture atomique : un arrêt en pleine écriture ne corrompt jamais le fichier)

def ecrire_json(fichier, valeur):
    tmp = fichier.with_suffix(".tmp")
    tmp.write_text(json.dumps(valeur, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, fichier)


def lire_json(fichier, defaut):
    try:
        return json.loads(fichier.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return defaut
    except (json.JSONDecodeError, UnicodeDecodeError):
        # on ne perd rien en silence : le fichier abîmé est mis de côté pour être récupéré à la main
        copie = fichier.with_name(f"{fichier.name}.corrompu-{int(time.time())}")
        os.replace(fichier, copie)
        print(f"ATTENTION : {fichier.name} illisible, mis de côté dans {copie.name}", file=sys.stderr, flush=True)
        return defaut


def charger():
    global sessions, donnees, contributions
    sessions = lire_json(FICHIER, {})
    donnees = lire_json(FICHIER_DONNEES, None)
    contributions = lire_json(FICHIER_CONTRIBUTIONS, {})


def sauver(immediat=False):
    """Sessions : écrites tout de suite pour les changements importants, sinon au plus une fois par seconde
    (30 élèves qui répondent ne doivent pas réécrire le fichier des dizaines de fois par seconde)."""
    global _sessions_a_sauver
    if not immediat:
        _sessions_a_sauver = True
        return
    maintenant = time.time()
    for code in [c for c, s in sessions.items() if maintenant - s["cree"] > DUREE_VIE]:
        del sessions[code]
    ecrire_json(FICHIER, sessions)
    _sessions_a_sauver = False


def ecrivain():
    while True:
        time.sleep(1)
        with verrou:
            if _sessions_a_sauver:
                sauver(immediat=True)


def nouveau_code():
    while True:
        code = "".join(secrets.choice(LETTRES) for _ in range(6))
        if code not in sessions:
            return code


def vue_eleve(e):
    """Ce que le prof voit d'un élève (sans son token ni son numéro d'envoi)."""
    return {k: v for k, v in e.items() if k not in ("token", "seq")}


# ---------- Nettoyage des données reçues

def nombre(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def entier(v, mini, maxi, defaut=0):
    return max(mini, min(maxi, int(v))) if nombre(v) else defaut


def reel(v):
    return max(0.0, min(1.0, float(v))) if nombre(v) else 0.0


def texte(v, maxi):
    return str(v)[:maxi] if isinstance(v, str) else ""


def textes(v, n, maxi):
    return [t for t in (texte(x, maxi).strip() for x in (v if isinstance(v, list) else [])[:n]) if t]


def progression_propre(d):
    top3 = [{"id": texte(t.get("id"), 12), "p": reel(t.get("p"))}
            for t in (d.get("top3") or [])[:3] if isinstance(t, dict)]
    derniers = [{"texte": texte(r.get("texte"), 300), "oui": bool(r.get("oui"))}
                for r in (d.get("derniers") or [])[:4] if isinstance(r, dict)]
    return {
        "nbQuestions": entier(d.get("nbQuestions"), 0, 100),
        "confiance": reel(d.get("confiance")),
        "top3": top3,
        "derniers": derniers,
        "fini": bool(d.get("fini")),
        "metier": texte(d.get("metier"), 12),
        "affinite": entier(d.get("affinite"), 0, 100),
    }


CHAMPS_METIER = {"nom": 60, "code": 8, "famille": 80, "famille_voisine": 80, "description": 400, "salaire": 40,
                 "salaire_note": 80, "salaire_unite": 40, "dynamique": 40, "dynamique_note": 80, "cursus": 40,
                 "cursus_label": 40, "anniversaire": 120, "qualites": 120, "voisin": 80}


def metier_propre(m):
    if not isinstance(m, dict):
        raise Erreur(400, "Fiche métier manquante.")
    fiche = {k: texte(m.get(k), n).strip() for k, n in CHAMPS_METIER.items()}
    if not fiche["nom"]:
        raise Erreur(400, "Le nom du métier est obligatoire.")
    fiche["bacs"] = textes(m.get("bacs"), 10, 60)
    fiche["competences"] = textes(m.get("competences"), 10, 60)
    fiche["missions"] = textes(m.get("missions"), 6, 120)
    fiche["trajectoire"] = [{"etape": texte(t.get("etape"), 60), "detail": texte(t.get("detail"), 120),
                             **({"cible": True} if t.get("cible") is True else {})}
                            for t in (m.get("trajectoire") if isinstance(m.get("trajectoire"), list) else [])[:6]
                            if isinstance(t, dict)]
    return fiche


def donnees_propres(d):
    """Fiches + matrice envoyées par l'admin (même format que son export JSON)."""
    if not isinstance(d.get("metiers"), dict) or not isinstance(d.get("questions"), list):
        raise Erreur(400, "Format attendu : {metiers: {...}, questions: [...]}")
    if len(d["metiers"]) > 200 or len(d["questions"]) > 400:
        raise Erreur(400, "Trop de métiers ou de questions.")
    metiers = {}
    for mid, m in d["metiers"].items():
        if not ID_RE.match(mid):
            raise Erreur(400, f"Identifiant de métier invalide : {mid[:20]}")
        metiers[mid] = metier_propre(m)
    questions, vus = [], set()
    for q in d["questions"]:
        if not isinstance(q, dict) or not ID_RE.match(str(q.get("id", ""))) or q["id"] in vus:
            raise Erreur(400, "Question sans identifiant valide ou en double.")
        if not texte(q.get("texte"), 300).strip():
            raise Erreur(400, f"La question {q['id']} n'a pas de texte.")
        vus.add(q["id"])
        profils = q.get("profils") if isinstance(q.get("profils"), dict) else {}
        questions.append({"id": q["id"], "texte": texte(q.get("texte"), 300).strip(), "exemple": texte(q.get("exemple"), 300),
                          "theme": texte(q.get("theme"), 80),
                          "profils": {mid: (profils.get(mid) if profils.get(mid) in ("O", "N") else "?") for mid in metiers}})
    if len(metiers) < 2 or not questions:
        raise Erreur(400, "Il faut au moins 2 métiers et 1 question.")
    return {"metiers": metiers, "questions": questions, "enregistre": time.time()}


def contribution_propre(d):
    reponses = d.get("reponses") if isinstance(d.get("reponses"), dict) else {}
    reponses = {k: v for k, v in list(reponses.items())[:400] if ID_RE.match(str(k)) and v in ("O", "N")}
    if len(reponses) < 8:
        raise Erreur(400, "Il faut au moins 8 réponses.")
    c = d.get("contributeur") if isinstance(d.get("contributeur"), dict) else {}
    return {"metier": metier_propre(d.get("metier")), "reponses": reponses,
            "contributeur": {"prenom": texte(c.get("prenom"), 30).strip(), "entreprise": texte(c.get("entreprise"), 50).strip()}}


# ---------- Contrôles d'accès

class Erreur(Exception):
    def __init__(self, statut, message):
        self.statut, self.message = statut, message


def egal(fourni, attendu):
    return isinstance(fourni, str) and isinstance(attendu, str) and secrets.compare_digest(fourni.encode(), attendu.encode())


def session_prof(code, token):
    s = sessions.get(code)
    if not s:
        raise Erreur(404, "Session inconnue")
    if not egal(token, s["token"]):
        raise Erreur(403, "Accès refusé")
    return s


def eleve_de(code, eid, token):
    s = sessions.get(code)
    e = s and next((e for e in s["eleves"] if e["id"] == eid), None)
    if not e:
        raise Erreur(404, "Élève inconnu")
    if not egal(token, e["token"]):
        raise Erreur(403, "Accès refusé")
    return s, e


def mot_de_passe_admin():
    mdp = os.environ.get("ADMIN_MOT_DE_PASSE", "")
    if not mdp:
        try:
            for ligne in (DOSSIER / ".env.local").read_text(encoding="utf-8").splitlines():
                if ligne.startswith("ADMIN_MOT_DE_PASSE="):
                    mdp = ligne.split("=", 1)[1].strip().strip('"')
        except FileNotFoundError:
            pass
    return mdp


def verifier_admin(fourni):
    mdp = mot_de_passe_admin()
    if not mdp:
        raise Erreur(503, "Mot de passe admin non configuré (ADMIN_MOT_DE_PASSE).")
    if not egal(fourni, mdp):
        raise Erreur(403, "Mot de passe admin incorrect.")


# ---------- Routes

def route_sessions(methode, parts, tok_q, corps):
    code = parts[1].upper() if len(parts) > 1 else None

    if methode == "POST" and len(parts) == 1:
        code = nouveau_code()
        sessions[code] = {"code": code, "token": secrets.token_urlsafe(16), "phase": "attente",
                          "cree": time.time(), "eleves": []}
        sauver(immediat=True)
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
        sauver(immediat=True)
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
        e = {"id": secrets.token_hex(4), "token": secrets.token_urlsafe(12), "prenom": prenom, "seq": 0,
             "statut": "jeu" if s["phase"] == "direct" else "attente", "arrive": time.time(),
             **progression_propre({})}
        s["eleves"].append(e)
        sauver(immediat=True)
        return 201, {"id": e["id"], "token": e["token"], "phase": s["phase"]}

    if methode == "GET" and len(parts) == 4 and parts[2] == "eleves":
        s, e = eleve_de(code, parts[3], tok_q)
        return 200, {"phase": s["phase"], "seq": e.get("seq", 0)}

    if methode == "POST" and len(parts) == 5 and parts[2] == "eleves" and parts[4] == "progression":
        s, e = eleve_de(code, parts[3], corps.get("token"))
        seq = entier(corps.get("seq"), 0, 10**9)
        # un envoi plus ancien que le dernier reçu (arrivé en retard) est ignoré
        if s["phase"] == "direct" and e["statut"] != "arrete" and seq > e.get("seq", 0):
            e.update(progression_propre(corps))
            e["seq"] = seq
            e["statut"] = "fini" if e["fini"] else "jeu"
            sauver()
        return 200, {"phase": s["phase"]}

    raise Erreur(404, "Route inconnue")


def route_admin(methode, parts, corps, mdp):
    global donnees
    verifier_admin(mdp)
    if methode == "GET" and parts == ["admin", "verifier"]:
        return 200, {"ok": True}
    if methode == "POST" and parts == ["admin", "donnees"]:
        donnees = donnees_propres(corps)
        ecrire_json(FICHIER_DONNEES, donnees)
        return 200, {"ok": True, "metiers": len(donnees["metiers"]), "questions": len(donnees["questions"])}
    if methode == "POST" and parts == ["admin", "donnees", "reinitialiser"]:
        donnees = None
        FICHIER_DONNEES.unlink(missing_ok=True)
        return 200, {"ok": True}
    if methode == "GET" and parts == ["admin", "contributions"]:
        return 200, {"contributions": sorted(contributions.values(), key=lambda c: -c["date"])}
    if methode == "POST" and len(parts) == 3 and parts[1] == "contributions":
        c = contributions.get(parts[2])
        if not c:
            raise Erreur(404, "Contribution inconnue")
        if corps.get("statut") not in ("acceptee", "rejetee", "attente"):
            raise Erreur(400, "Statut attendu : acceptee, rejetee ou attente.")
        c["statut"] = corps["statut"]
        ecrire_json(FICHIER_CONTRIBUTIONS, contributions)
        return 200, {"ok": True}
    raise Erreur(404, "Route inconnue")


def router(methode, chemin, query, corps, mdp_admin=None):
    parts = [p for p in chemin.split("/") if p][1:]  # sans le "api" de tête
    tok_q = query.get("token", [""])[0]
    with verrou:
        if parts[:1] == ["sessions"]:
            return route_sessions(methode, parts, tok_q, corps)
        if methode == "GET" and parts == ["donnees"]:
            return 200, {"donnees": donnees}
        if methode == "POST" and parts == ["contributions"]:
            if sum(1 for c in contributions.values() if c["statut"] == "attente") >= MAX_CONTRIBUTIONS:
                raise Erreur(409, "Trop de propositions en attente, réessaie plus tard.")
            c = {"id": secrets.token_hex(5), "date": time.time(), "statut": "attente", **contribution_propre(corps)}
            contributions[c["id"]] = c
            ecrire_json(FICHIER_CONTRIBUTIONS, contributions)
            return 201, {"id": c["id"]}
        if parts[:1] == ["admin"]:
            return route_admin(methode, parts, corps, mdp_admin)
    raise Erreur(404, "Route inconnue")


def refuser_constante(nom):  # NaN, Infinity : refusés dans le JSON reçu
    raise ValueError(nom)


def flottant_fini(s):  # 1e400 deviendrait l'infini : refusé aussi
    v = float(s)
    if not math.isfinite(v):
        raise ValueError(s)
    return v


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(DOSSIER), **kw)

    def log_message(self, fmt, *args):  # journal discret : seulement les appels API
        if "/api/" in (self.path or ""):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def repondre(self, statut, donnees_reponse):
        corps = json.dumps(donnees_reponse, ensure_ascii=False).encode("utf-8")
        self.send_response(statut)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def api(self, methode):
        url = urlparse(self.path)
        corps = {}
        if methode == "POST":
            try:
                taille = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                taille = -1
            if taille < 0:
                return self.repondre(400, {"erreur": "Longueur de requête invalide"})
            if taille > TAILLE_MAX.get(url.path.rstrip("/"), 20_000):
                return self.repondre(413, {"erreur": "Requête trop grosse"})
            try:
                corps = json.loads(self.rfile.read(taille) or b"{}", parse_constant=refuser_constante, parse_float=flottant_fini)
                if not isinstance(corps, dict):
                    raise ValueError
            except (ValueError, UnicodeDecodeError, RecursionError):
                return self.repondre(400, {"erreur": "JSON invalide"})
        try:
            self.repondre(*router(methode, url.path, parse_qs(url.query), corps, self.headers.get("X-Admin")))
        except Erreur as err:
            self.repondre(err.statut, {"erreur": err.message})
        except Exception:  # bug inattendu : on répond quand même, et on garde la trace
            traceback.print_exc()
            self.repondre(500, {"erreur": "Erreur serveur"})

    def fichier_interdit(self) -> bool:
        """Fichiers jamais servis sur le réseau : cachés (.env.local avec les clés Redis et le mot de passe admin,
        .vercel, .git…), fichiers de données privés (sessions, contributions…) et le code Python. Le test porte sur le
        chemin réel, une fois l'URL décodée et normalisée par translate_path, et ignore la casse (Windows)."""
        chemin = Path(self.translate_path(self.path)).resolve()
        try:
            parties = chemin.relative_to(DOSSIER).parts
        except ValueError:
            return True  # en dehors du dossier de l'app
        return any(p.startswith(".") or p.lower().split(".corrompu")[0] in FICHIERS_PRIVES or p.lower().endswith((".py", ".tmp"))
                   for p in parties)

    def send_head(self):  # utilisé par GET et HEAD
        if self.fichier_interdit():
            self.send_error(404, "Introuvable")
            return None
        return super().send_head()

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.api("GET")
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
    threading.Thread(target=ecrivain, daemon=True).start()
    print(f"ORIENTech en ligne :\n  sur ce PC          http://localhost:{port}\n"
          f"  pour les élèves    http://{ip_locale()}:{port}   (même Wi-Fi)", flush=True)
    if not mot_de_passe_admin():
        print("  (admin : ADMIN_MOT_DE_PASSE non défini, l'enregistrement admin est désactivé)", flush=True)
    # File d'attente de connexions élargie : par défaut 5 sous Windows, ce qui refuse une classe qui se connecte d'un coup
    ThreadingHTTPServer.request_queue_size = 128
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
