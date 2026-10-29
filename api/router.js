// ORIENTech — API en ligne (fonction Vercel + Redis hébergé Upstash). Même API que serveur.py (utilisé en local) :
//   Sessions de classe
//     POST /api/sessions                                  -> prof crée une session : {code, token}
//     GET  /api/sessions/<code>?token=...                 -> prof lit l'état de la classe
//     POST /api/sessions/<code>/lancer      {token}       -> prof lance la session
//     POST /api/sessions/<code>/terminer    {token}       -> prof termine la session
//     POST /api/sessions/<code>/eleves      {prenom}      -> élève rejoint : {id, token, phase}
//     GET  /api/sessions/<code>/eleves/<id>?token=...     -> élève lit la phase
//     POST /api/sessions/<code>/eleves/<id>/progression   {token, seq, ...} -> élève envoie où il en est
//   Contenu du jeu
//     GET  /api/donnees                                   -> fiches + matrice enregistrées par l'admin (ou null)
//     POST /api/contributions   {metier, contributeur, reponses}  -> un·e pro propose son métier
//   Admin (en-tête X-Admin = mot de passe ADMIN_MOT_DE_PASSE)
//     GET  /api/admin/verifier · POST /api/admin/donnees · POST /api/admin/donnees/reinitialiser
//     GET  /api/admin/contributions · POST /api/admin/contributions/<id> {statut}
//
// Stockage Redis :
//   orientech:session:<CODE>             -> JSON { token, phase, cree }                  (expire après 24 h)
//   orientech:session:<CODE>:eleves      -> hash { idEleve: JSON élève }                 (expire après 24 h)
//   orientech:session:<CODE>:seq         -> hash { idEleve: dernier numéro d'envoi reçu } (expire après 24 h)
//   orientech:donnees                    -> JSON { metiers, questions, enregistre }
//   orientech:contributions              -> hash { id: JSON contribution }
// Le statut affiché (attente / jeu / fini / arrete) est déduit de la phase de la session.
//
// Variables d'environnement : KV_REST_API_URL + KV_REST_API_TOKEN (ou UPSTASH_REDIS_REST_URL + _TOKEN), ADMIN_MOT_DE_PASSE

const crypto = require('crypto');

const LETTRES = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I/L
const MAX_ELEVES = 60;
const MAX_CONTRIBUTIONS = 500;
const DUREE_VIE = 24 * 3600;
const ID_RE = /^[A-Za-z0-9_-]{1,12}$/;

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

class Erreur extends Error {
  constructor(statut, message) { super(message); this.statut = statut; }
}

async function redis(...commande) {
  if (!REDIS_URL || !REDIS_TOKEN) throw new Erreur(503, 'Base de données non configurée (ajoute Upstash Redis au projet Vercel).');
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commande)
  });
  const donnees = await r.json();
  if (donnees.error) throw new Error(donnees.error);
  return donnees.result;
}

const cleSession = (code) => `orientech:session:${code}`;
const cleEleves = (code) => `orientech:session:${code}:eleves`;
const cleSeq = (code) => `orientech:session:${code}:seq`;
const CLE_DONNEES = 'orientech:donnees';
const CLE_CONTRIBUTIONS = 'orientech:contributions';
const jeton = (n) => crypto.randomBytes(n).toString('base64url');
const egal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Écrit la progression seulement si son numéro d'envoi est plus récent que le dernier reçu.
// En script Redis pour que la comparaison et l'écriture soient atomiques (plusieurs fonctions Vercel en parallèle).
const SCRIPT_PROGRESSION = `
local actuel = tonumber(redis.call('HGET', KEYS[2], ARGV[1]) or '0')
if tonumber(ARGV[3]) > actuel then
  redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
  redis.call('EXPIRE', KEYS[2], ARGV[4])
  return 1
end
return 0`;

// ---------- Nettoyage des données reçues

const nombre = (v) => typeof v === 'number' && Number.isFinite(v);
const entier = (v, min, max) => (nombre(v) ? Math.max(min, Math.min(max, Math.trunc(v))) : 0);
const reel = (v) => (nombre(v) ? Math.max(0, Math.min(1, v)) : 0);
const texte = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const textes = (v, n, max) => (Array.isArray(v) ? v.slice(0, n) : []).map((x) => texte(x, max).trim()).filter(Boolean);
const objet = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function progressionPropre(d = {}) {
  return {
    nbQuestions: entier(d.nbQuestions, 0, 100),
    confiance: reel(d.confiance),
    top3: (Array.isArray(d.top3) ? d.top3 : []).slice(0, 3).filter((t) => t && typeof t === 'object')
      .map((t) => ({ id: texte(t.id, 12), p: reel(t.p) })),
    derniers: (Array.isArray(d.derniers) ? d.derniers : []).slice(0, 4).filter((r) => r && typeof r === 'object')
      .map((r) => ({ texte: texte(r.texte, 300), oui: !!r.oui })),
    fini: !!d.fini,
    metier: texte(d.metier, 12),
    affinite: entier(d.affinite, 0, 100)
  };
}

const CHAMPS_METIER = { nom: 60, code: 8, famille: 80, famille_voisine: 80, description: 400, salaire: 40, salaire_note: 80,
  salaire_unite: 40, dynamique: 40, dynamique_note: 80, cursus: 40, cursus_label: 40, anniversaire: 120, qualites: 120, voisin: 80 };

function metierPropre(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Erreur(400, 'Fiche métier manquante.');
  const fiche = Object.fromEntries(Object.entries(CHAMPS_METIER).map(([k, n]) => [k, texte(m[k], n).trim()]));
  if (!fiche.nom) throw new Erreur(400, 'Le nom du métier est obligatoire.');
  fiche.bacs = textes(m.bacs, 10, 60);
  fiche.competences = textes(m.competences, 10, 60);
  fiche.missions = textes(m.missions, 6, 120);
  fiche.trajectoire = (Array.isArray(m.trajectoire) ? m.trajectoire : []).slice(0, 6).filter((t) => t && typeof t === 'object')
    .map((t) => ({ etape: texte(t.etape, 60), detail: texte(t.detail, 120), ...(t.cible === true ? { cible: true } : {}) }));
  return fiche;
}

// ---------- Format V7 (matrice de probabilités, app/data/orientech_v7.json) — mêmes règles que serveur.py

const ECHELLE_V7 = [0.05, 0.15, 0.30, 0.50, 0.70, 0.85, 0.95];
// paramètre -> [min, max, entier ?]
const BORNES_V7 = { epsilon: [0, 0.5, false], seuil_arret: [0.3, 0.99, false], ratio_arret: [1, 10, false],
  temperature: [0, 1, false], top_k: [1, 10, true], min_questions: [1, 40, true], max_questions: [1, 40, true],
  cible_questions: [1, 40, true], penalite_deja_vu: [1, 10, false], parties_memorisees: [0, 10, true] };

function parametresV7Propres(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Erreur(400, 'parametres_moteur manquants.');
  const propres = {};
  for (const [cle, [min, max, ent]] of Object.entries(BORNES_V7)) {
    const v = p[cle];
    if (!nombre(v) || v < min || v > max || (ent && !Number.isInteger(v))) throw new Erreur(400, `Paramètre ${cle} invalide (attendu entre ${min} et ${max}).`);
    propres[cle] = v;
  }
  if (propres.min_questions > propres.max_questions) throw new Erreur(400, 'min_questions doit être inférieur ou égal à max_questions.');
  const tours = p.tours_centre_interet ?? [];
  if (!Array.isArray(tours) || tours.length > 10 || !tours.every((t) => Number.isInteger(t) && t >= 1 && t <= 40)) {
    throw new Erreur(400, 'tours_centre_interet invalide.');
  }
  propres.tours_centre_interet = tours;
  return propres;
}

function deuxTextes(v, qid, nom, obligatoire) {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((t) => typeof t === 'string')) throw new Erreur(400, `La question ${qid} doit avoir 2 ${nom}.`);
  if (v.some((t) => t.length > 300)) throw new Erreur(400, `La question ${qid} a des ${nom} de plus de 300 caractères.`);
  if (obligatoire && !v.every((t) => t.trim())) throw new Erreur(400, `La question ${qid} a des ${nom} vides.`);
  return v.map((t) => t.trim());
}

function booleen(v, qid, nom) {
  if (typeof v !== 'boolean') throw new Erreur(400, `La question ${qid} : ${nom} doit valoir true ou false.`);
  return v;
}

function questionV7Propre(q, idsMetiers) {
  if (!q || typeof q !== 'object' || !ID_RE.test(String(q.id || ''))) throw new Erreur(400, 'Question sans identifiant valide.');
  const qid = q.id;
  if (!Array.isArray(q.proches) || q.proches.length > 100 || !q.proches.every((x) => typeof x === 'string' && ID_RE.test(x))) {
    throw new Erreur(400, `La question ${qid} a une liste « proches » invalide.`);
  }
  if (typeof q.groupe !== 'string' || !ID_RE.test(q.groupe)) throw new Erreur(400, `La question ${qid} a un groupe invalide.`);
  const p = objet(q.p);
  const propreP = {};
  for (const mid of idsMetiers) {
    const v = p[mid];
    if (!nombre(v) || !ECHELLE_V7.some((e) => Math.abs(v - e) < 1e-9)) {
      throw new Erreur(400, `La question ${qid} : p[${mid}] doit être une valeur de l'échelle [${ECHELLE_V7.join(', ')}].`);
    }
    propreP[mid] = v;
  }
  return { id: qid, formulations: deuxTextes(q.formulations, qid, 'formulations', true), exemples: deuxTextes(q.exemples, qid, 'exemples', false),
    type: texte(q.type, 20), theme_vie: texte(q.theme_vie, 40), dimension_principale: texte(q.dimension_principale, 20), groupe: q.groupe,
    proches: q.proches, ouverture: booleen(q.ouverture, qid, 'ouverture'),
    centre_interet: typeof q.centre_interet === 'string' ? texte(q.centre_interet, 40) : null,
    inversee: booleen(q.inversee, qid, 'inversee'), p: propreP };
}

// {version: '7.x', metiers: {fiches}, matrice: <JSON allégé de orientech_v7/exporter_app.py>}
function donneesV7Propres(d) {
  const fiches = d.metiers, mat = d.matrice;
  if (!fiches || typeof fiches !== 'object' || Array.isArray(fiches) || !mat || typeof mat !== 'object' ||
      !Array.isArray(mat.metiers) || !Array.isArray(mat.questions)) {
    throw new Erreur(400, 'Format V7 attendu : {version, metiers: {...}, matrice: {metiers: [...], questions: [...]}}');
  }
  if (Object.keys(fiches).length > 200 || mat.metiers.length > 200 || mat.questions.length > 400) throw new Erreur(400, 'Trop de métiers ou de questions.');
  const metiers = {};
  for (const [mid, m] of Object.entries(fiches)) {
    if (!ID_RE.test(mid)) throw new Erreur(400, `Identifiant de métier invalide : ${mid.slice(0, 20)}`);
    metiers[mid] = metierPropre(m);
  }
  const liste = [];
  for (const m of mat.metiers) {
    if (!m || typeof m !== 'object' || !Object.hasOwn(metiers, m.id) || liste.some((x) => x.id === m.id)) {
      throw new Erreur(400, 'Chaque métier de la matrice doit avoir une fiche, une seule fois.');
    }
    const fam = m.famille_principale;
    liste.push({ id: m.id, nom: texte(m.nom, 60).trim() || metiers[m.id].nom,
      famille_principale: typeof fam === 'string' && ID_RE.test(fam) ? fam : '' });
  }
  if (liste.length !== Object.keys(metiers).length) throw new Erreur(400, 'Chaque fiche doit avoir sa colonne dans la matrice.');
  const familles = (Array.isArray(mat.familles) ? mat.familles : []).slice(0, 30)
    .filter((f) => f && typeof f.id === 'string' && ID_RE.test(f.id)).map((f) => ({ id: f.id, nom: texte(f.nom, 80) }));
  const vus = new Set();
  const questions = mat.questions.map((q) => {
    const propre = questionV7Propre(q, liste.map((m) => m.id));
    if (vus.has(propre.id)) throw new Erreur(400, `Question en double : ${propre.id}`);
    vus.add(propre.id);
    return propre;
  });
  if (Object.keys(metiers).length < 2 || !questions.length) throw new Erreur(400, 'Il faut au moins 2 métiers et 1 question.');
  const version = texte(d.version, 10);
  const matrice = { version, echelle: [...ECHELLE_V7], parametres_moteur: parametresV7Propres(mat.parametres_moteur), familles, metiers: liste, questions };
  return { version, metiers, matrice, enregistre: Date.now() / 1000 };
}

// Fiches + matrice envoyées par l'admin (même format que son export JSON)
function donneesPropres(d) {
  if (typeof d.version === 'string' && d.version.startsWith('7')) return donneesV7Propres(d);
  if (!d.metiers || typeof d.metiers !== 'object' || Array.isArray(d.metiers) || !Array.isArray(d.questions)) {
    throw new Erreur(400, 'Format attendu : {metiers: {...}, questions: [...]}');
  }
  if (Object.keys(d.metiers).length > 200 || d.questions.length > 400) throw new Erreur(400, 'Trop de métiers ou de questions.');
  const metiers = {};
  for (const [mid, m] of Object.entries(d.metiers)) {
    if (!ID_RE.test(mid)) throw new Erreur(400, `Identifiant de métier invalide : ${mid.slice(0, 20)}`);
    metiers[mid] = metierPropre(m);
  }
  const vus = new Set();
  const questions = d.questions.map((q) => {
    if (!q || typeof q !== 'object' || !ID_RE.test(String(q.id || '')) || vus.has(q.id)) throw new Erreur(400, 'Question sans identifiant valide ou en double.');
    if (!texte(q.texte, 300).trim()) throw new Erreur(400, `La question ${q.id} n'a pas de texte.`);
    vus.add(q.id);
    const profils = objet(q.profils);
    return { id: q.id, texte: texte(q.texte, 300).trim(), exemple: texte(q.exemple, 300), theme: texte(q.theme, 80),
      profils: Object.fromEntries(Object.keys(metiers).map((mid) => [mid, profils[mid] === 'O' || profils[mid] === 'N' ? profils[mid] : '?'])) };
  });
  if (Object.keys(metiers).length < 2 || !questions.length) throw new Erreur(400, 'Il faut au moins 2 métiers et 1 question.');
  return { metiers, questions, enregistre: Date.now() / 1000 };
}

function contributionPropre(d) {
  const reponses = Object.fromEntries(Object.entries(objet(d.reponses)).slice(0, 400).filter(([k, v]) => ID_RE.test(k) && (v === 'O' || v === 'N')));
  if (Object.keys(reponses).length < 8) throw new Erreur(400, 'Il faut au moins 8 réponses.');
  const c = objet(d.contributeur);
  return { metier: metierPropre(d.metier), reponses,
    contributeur: { prenom: texte(c.prenom, 30).trim(), entreprise: texte(c.entreprise, 50).trim() } };
}

function statutAffiche(phase, e) {
  if (phase === 'attente') return 'attente';
  if (e.fini) return 'fini';
  return phase === 'termine' ? 'arrete' : 'jeu';
}

// ---------- Accès aux données

async function lireSession(code) {
  const brut = await redis('GET', cleSession(code));
  return brut ? JSON.parse(brut) : null;
}

async function ecrireSession(code, s) {
  await redis('SET', cleSession(code), JSON.stringify(s), 'EX', DUREE_VIE);
}

async function sessionProf(code, token) {
  const s = await lireSession(code);
  if (!s) throw new Erreur(404, 'Session inconnue');
  if (!egal(token, s.token)) throw new Erreur(403, 'Accès refusé');
  return s;
}

async function eleveDe(code, id, token) {
  const s = await lireSession(code);
  const brut = s && (await redis('HGET', cleEleves(code), id));
  if (!brut) throw new Erreur(404, 'Élève inconnu');
  const e = JSON.parse(brut);
  if (!egal(token, e.token)) throw new Erreur(403, 'Accès refusé');
  return { s, e };
}

function verifierAdmin(fourni) {
  const mdp = process.env.ADMIN_MOT_DE_PASSE;
  if (!mdp) throw new Erreur(503, 'Mot de passe admin non configuré (ADMIN_MOT_DE_PASSE).');
  if (!egal(fourni, mdp)) throw new Erreur(403, 'Mot de passe admin incorrect.');
}

// ---------- Routes

async function routeSessions(methode, parts, query, corps) {
  const code = parts[1] ? String(parts[1]).toUpperCase() : null;

  if (methode === 'POST' && parts.length === 1) {
    for (let essai = 0; essai < 10; essai++) {
      const nouveau = Array.from({ length: 6 }, () => LETTRES[crypto.randomInt(LETTRES.length)]).join('');
      const session = { token: jeton(16), phase: 'attente', cree: Date.now() };
      // NX : n'écrase jamais une session existante
      if (await redis('SET', cleSession(nouveau), JSON.stringify(session), 'EX', DUREE_VIE, 'NX')) {
        return [201, { code: nouveau, token: session.token }];
      }
    }
    throw new Erreur(500, 'Impossible de créer un code');
  }

  if (methode === 'GET' && parts.length === 2) {
    const s = await sessionProf(code, query.token);
    const tous = (await redis('HGETALL', cleEleves(code))) || [];
    const eleves = [];
    for (let i = 1; i < tous.length; i += 2) {
      const { token, ...e } = JSON.parse(tous[i]);
      eleves.push({ ...e, statut: statutAffiche(s.phase, e) });
    }
    eleves.sort((a, b) => a.arrive - b.arrive);
    return [200, { code, phase: s.phase, eleves }];
  }

  if (methode === 'POST' && parts.length === 3 && (parts[2] === 'lancer' || parts[2] === 'terminer')) {
    const s = await sessionProf(code, corps.token);
    if (parts[2] === 'lancer' && s.phase === 'attente') s.phase = 'direct';
    if (parts[2] === 'terminer') s.phase = 'termine';
    await ecrireSession(code, s);
    return [200, { phase: s.phase }];
  }

  if (methode === 'POST' && parts.length === 3 && parts[2] === 'eleves') {
    const s = await lireSession(code);
    if (!s) throw new Erreur(404, 'Ce code ne correspond à aucune session.');
    if (s.phase === 'termine') throw new Erreur(409, 'Cette session est terminée.');
    if ((await redis('HLEN', cleEleves(code))) >= MAX_ELEVES) throw new Erreur(409, 'La session est complète.');
    const prenom = texte(corps.prenom, 20).replace(/\s+/g, ' ').trim();
    if (!prenom) throw new Erreur(400, 'Prénom manquant.');
    const e = { id: crypto.randomBytes(4).toString('hex'), token: jeton(12), prenom, arrive: Date.now(), ...progressionPropre() };
    await redis('HSET', cleEleves(code), e.id, JSON.stringify(e));
    await redis('EXPIRE', cleEleves(code), DUREE_VIE);
    return [201, { id: e.id, token: e.token, phase: s.phase }];
  }

  if (methode === 'GET' && parts.length === 4 && parts[2] === 'eleves') {
    const { s, e } = await eleveDe(code, parts[3], query.token);
    const seq = Number((await redis('HGET', cleSeq(code), e.id)) || 0);
    return [200, { phase: s.phase, seq }];
  }

  if (methode === 'POST' && parts.length === 5 && parts[2] === 'eleves' && parts[4] === 'progression') {
    const { s, e } = await eleveDe(code, parts[3], corps.token);
    const seq = entier(corps.seq, 0, 1e9);
    if (s.phase === 'direct' && seq > 0) {
      // l'écriture n'a lieu que si seq est plus récent que le dernier envoi reçu (un envoi en retard est ignoré)
      await redis('EVAL', SCRIPT_PROGRESSION, 2, cleEleves(code), cleSeq(code),
        e.id, JSON.stringify({ ...e, ...progressionPropre(corps) }), String(seq), String(DUREE_VIE));
    }
    return [200, { phase: s.phase }];
  }

  throw new Erreur(404, 'Route inconnue');
}

async function routeAdmin(methode, parts, corps, mdp) {
  verifierAdmin(mdp);
  const chemin = parts.join('/');
  if (methode === 'GET' && chemin === 'admin/verifier') return [200, { ok: true }];
  if (methode === 'POST' && chemin === 'admin/donnees') {
    const d = donneesPropres(corps);
    await redis('SET', CLE_DONNEES, JSON.stringify(d));
    return [200, { ok: true, metiers: Object.keys(d.metiers).length, questions: (d.matrice || d).questions.length }];
  }
  if (methode === 'POST' && chemin === 'admin/donnees/reinitialiser') {
    await redis('DEL', CLE_DONNEES);
    return [200, { ok: true }];
  }
  if (methode === 'GET' && chemin === 'admin/contributions') {
    const tous = (await redis('HGETALL', CLE_CONTRIBUTIONS)) || [];
    const liste = [];
    for (let i = 1; i < tous.length; i += 2) liste.push(JSON.parse(tous[i]));
    return [200, { contributions: liste.sort((a, b) => b.date - a.date) }];
  }
  if (methode === 'POST' && parts.length === 3 && parts[1] === 'contributions') {
    const brut = await redis('HGET', CLE_CONTRIBUTIONS, parts[2]);
    if (!brut) throw new Erreur(404, 'Contribution inconnue');
    if (!['acceptee', 'rejetee', 'attente'].includes(corps.statut)) throw new Erreur(400, 'Statut attendu : acceptee, rejetee ou attente.');
    await redis('HSET', CLE_CONTRIBUTIONS, parts[2], JSON.stringify({ ...JSON.parse(brut), statut: corps.statut }));
    return [200, { ok: true }];
  }
  throw new Erreur(404, 'Route inconnue');
}

async function router(methode, parts, query, corps, mdpAdmin) {
  if (parts[0] === 'sessions') return routeSessions(methode, parts, query, corps);
  if (methode === 'GET' && parts.join('/') === 'donnees') {
    const brut = await redis('GET', CLE_DONNEES);
    return [200, { donnees: brut ? JSON.parse(brut) : null }];
  }
  if (methode === 'POST' && parts.join('/') === 'contributions') {
    if ((await redis('HLEN', CLE_CONTRIBUTIONS)) >= MAX_CONTRIBUTIONS) throw new Erreur(409, 'Trop de propositions, réessaie plus tard.');
    const c = { id: crypto.randomBytes(5).toString('hex'), date: Date.now() / 1000, statut: 'attente', ...contributionPropre(corps) };
    await redis('HSET', CLE_CONTRIBUTIONS, c.id, JSON.stringify(c));
    return [201, { id: c.id }];
  }
  if (parts[0] === 'admin') return routeAdmin(methode, parts, corps, mdpAdmin);
  throw new Erreur(404, 'Route inconnue');
}

module.exports = async function handler(req, res) {
  // vercel.json réécrit /api/<chemin> vers /api/router?chemin=<chemin>
  const parts = String(req.query.chemin || '').split('/').filter(Boolean);
  const query = { ...req.query };
  delete query.chemin;
  res.setHeader('Cache-Control', 'no-store');
  try {
    // req.body est analysé par Vercel au premier accès : un JSON invalide lève une erreur, gérée plus bas
    const corps = req.method === 'POST' && req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const [statut, donnees] = await router(req.method, parts, query, corps, req.headers['x-admin']);
    res.status(statut).json(donnees);
  } catch (err) {
    if (err instanceof Erreur) return res.status(err.statut).json({ erreur: err.message });
    if (err instanceof SyntaxError) return res.status(400).json({ erreur: 'JSON invalide' });
    console.error(err);
    res.status(500).json({ erreur: 'Erreur serveur' });
  }
};
