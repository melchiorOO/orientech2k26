# ORIENTech

Jeu d'orientation façon Akinator pour les collégiens : l'élève répond **Oui / Non** à des affirmations et le jeu devine la famille de métiers et le métier du numérique qui lui correspondent.

## Ce que contient l'app

| Espace | Accès | Rôle |
|---|---|---|
| Élève | Jouer → Je suis élève | Partie en solo ou en classe (code session), « Pas convaincu·e ? » = 5 questions de plus |
| Prof | Jouer → Je suis prof | Crée une session, projette le code, suit la classe en direct |
| Professionnel·le | Jouer → Je suis professionnel·le | Remplit sa fiche métier et répond à ≥ 8 affirmations (front-end, envoi à brancher) |
| Fiches métiers | Bouton bleu en haut à droite | Catalogue de toutes les fiches |
| Admin | 5 clics rapides sur le titre ORIENTech (ou `/#admin`) | Modifier fiches, nœuds de la toile et matrice (front-end, export JSON) |

## Structure

```
index.html        écrans (HTML + Tailwind CDN)
game.js           navigation et écrans élève
moteur.js         moteur adaptatif (choix des questions, probabilités) + lecture de l'Excel
prof.js           suivi de classe en direct
pro.js            espace professionnel·le
fiches.js         catalogue des fiches métiers
admin.js          page admin
api/router.js     API des sessions de classe (fonction Vercel + Redis Upstash)
serveur.py        même API en local (Python, sans dépendance), pour jouer sans Internet
data/orientech.xlsx  les données du jeu (questions, matrice, fiches métiers)
avatars/          avatars PNG détourés
```

Pour changer les questions ou les métiers : remplacer `data/orientech.xlsx` (même structure que `MELCHIOR_Orien_Tech_V6.xlsx`).

## Lancer en local

```bash
python serveur.py          # http://localhost:8000 (et l'adresse réseau pour les élèves sur le même Wi-Fi)
```

## En ligne (Vercel)

Site statique + une fonction `api/router.js`. Pas d'étape de build.

Variables d'environnement nécessaires pour le mode classe (créées automatiquement en ajoutant **Upstash Redis** depuis le Marketplace Vercel, onglet *Storage*) :

```
KV_REST_API_URL     adresse REST de la base Redis Upstash
KV_REST_API_TOKEN   jeton d'accès à cette base
```

(`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` fonctionnent aussi.) Sans elles, tout le jeu marche sauf le mode classe.
