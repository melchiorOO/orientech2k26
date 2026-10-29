# ORIENTech

Jeu d'orientation façon Akinator pour les collégiens : l'élève répond **Oui / Non** à des affirmations et le jeu devine la famille de métiers et le métier du numérique qui lui correspondent.

## Ce que contient l'app

| Espace | Accès | Rôle |
|---|---|---|
| Élève | Jouer → Je suis élève | Partie en solo ou en classe (code session), « Pas convaincu·e ? » = 5 questions de plus |
| Prof | Jouer → Je suis prof | Crée une session, projette le code, suit la classe en direct |
| Professionnel·le | Jouer → Je suis professionnel·le | Remplit sa fiche métier et répond à ≥ 8 affirmations (envoyées à l'admin) |
| Fiches métiers | Bouton bleu en haut à droite | Catalogue de toutes les fiches |
| Admin | 5 clics rapides sur le titre ORIENTech (ou `/#admin`) | Modifier fiches, nœuds de la toile et matrice, accepter les propositions des pros, enregistrer |

## Structure

```
index.html        écrans (HTML + Tailwind CDN)
game.js           navigation et écrans élève
moteur_v7.js      moteur V7 (matrice de probabilités, 2 formulations par question, groupes, mémoire inter-parties)
moteur.js         moteur V6 (cases O / N / ?, utilisé en repli) + lecture de l'Excel
prof.js           suivi de classe en direct
pro.js            espace professionnel·le
fiches.js         catalogue des fiches métiers
admin.js          page admin
api/router.js     API des sessions de classe (fonction Vercel + Redis Upstash)
serveur.py        même API en local (Python, sans dépendance), pour jouer sans Internet
data/orientech_v7.json             matrice V7 (157 questions × 30 métiers), générée par orientech_v7/exporter_app.py
data/ORIENTech_V6_100_questions.xlsx  les 30 fiches métiers (onglet Métiers) utilisées avec la V7
data/orientech.xlsx                ancienne version V6 (16 métiers), lue seulement si la V7 ne charge pas
avatars/          avatars détourés (WebP, fond transparent)
```

Ordre de chargement : données enregistrées par l'admin (`/api/donnees`), sinon la V7 (`orientech_v7.json` + fiches), sinon `orientech.xlsx`.

Pour changer les questions ou les probabilités : modifier la chaîne Python de `orientech_v7/`, puis relancer `python -X utf8 orientech_v7/exporter_app.py`. Tests du moteur : `node orientech_v7/test_moteur_v7.js`.

## CSS (Tailwind précompilé)

Les classes Tailwind sont compilées une fois dans `tailwind.css` (plus de compilation dans le navigateur). **Après avoir ajouté ou changé des classes** dans `index.html` ou un `.js`, régénérer :

```bash
npx tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.src.css -o tailwind.css --minify
```

Une classe construite dynamiquement en JS (ex. `` `sm:grid-cols-${n}` ``) doit être ajoutée à `safelist` dans `tailwind.config.js`.

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

### Mot de passe admin

L'enregistrement admin (fiches + matrice) et la lecture des propositions des pros demandent un mot de passe, `ADMIN_MOT_DE_PASSE` :

```bash
npx vercel env add ADMIN_MOT_DE_PASSE production   # en ligne (puis redéployer)
```

En local, `serveur.py` le lit dans la variable d'environnement `ADMIN_MOT_DE_PASSE`, sinon dans `.env.local` (ligne `ADMIN_MOT_DE_PASSE="…"`, fichier jamais servi ni envoyé sur GitHub).

### Contenu modifié par l'admin

« Enregistrer » dans l'admin publie les fiches et la matrice sur le serveur : le jeu les charge en priorité, à la place des fichiers de `data/`. « Revenir au JSON V7 » (« Revenir à l'Excel » en V6) les efface. En V7, chaque case de la matrice est une probabilité (0.05 à 0.95) ; « Exporter le JSON V7 » télécharge la matrice pour la réinjecter dans `orientech_v7/`. L'admin ne recalcule ni les groupes ni les questions proches. Les fiches envoyées par les pros arrivent dans l'onglet « Propositions des pros » ; « Ajouter au jeu » crée le métier avec ses réponses, puis « Enregistrer » le publie.
