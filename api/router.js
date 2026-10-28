// ORIENTech — API des sessions de classe, version Vercel (fonction serverless + Redis hébergé Upstash).
// Même API que serveur.py (utilisé en local) :
//   POST /api/sessions                                  -> prof crée une session : {code, token}
//   GET  /api/sessions/<code>?token=...                 -> prof lit l'état de la classe
//   POST /api/sessions/<code>/lancer      {token}       -> prof lance la session
//   POST /api/sessions/<code>/terminer    {token}       -> prof termine la session
//   POST /api/sessions/<code>/eleves      {prenom}      -> élève rejoint : {id, token, phase}
//   GET  /api/sessions/<code>/eleves/<id>?token=...     -> élève lit la phase
//   POST /api/sessions/<code>/eleves/<id>/progression   {token, ...} -> élève envoie où il en est
//
// Stockage Redis (expire au bout de 24 h) :
//   orientech:session:<CODE>         -> JSON { token, phase, cree }
//   orientech:session:<CODE>:eleves  -> hash { idEleve: JSON élève }  (un champ par élève : pas de conflit d'écriture)
// Le statut affiché (attente / jeu / fini / arrete) est déduit de la phase de la session, il n'est jamais réécrit en masse.
//
// Variables d'environnement (créées automatiquement par l'intégration Upstash du Marketplace Vercel) :
//   KV_REST_API_URL + KV_REST_API_TOKEN   (ou UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)

const crypto = require('crypto');

const LETTRES = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans 0/O, 1/I/L
const MAX_ELEVES = 60;
const DUREE_VIE = 24 * 3600;

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
const jeton = (n) => crypto.randomBytes(n).toString('base64url');
const egal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---------- Nettoyage des données envoyées par les élèves

const entier = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : 0);
const reel = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const texte = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

function progressionPropre(d = {}) {
  return {
    nbQuestions: entier(d.nbQuestions, 0, 100),
    confiance: reel(d.confiance),
    top3: (Array.isArray(d.top3) ? d.top3 : []).slice(0, 3).filter((t) => t && typeof t === 'object')
      .map((t) => ({ id: texte(t.id, 10), p: reel(t.p) })),
    derniers: (Array.isArray(d.derniers) ? d.derniers : []).slice(0, 4).filter((r) => r && typeof r === 'object')
      .map((r) => ({ texte: texte(r.texte, 300), oui: !!r.oui })),
    fini: !!d.fini,
    metier: texte(d.metier, 10),
    affinite: entier(d.affinite, 0, 100)
  };
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

// ---------- Routes

async function router(methode, parts, query, corps) {
  if (parts[0] !== 'sessions') throw new Erreur(404, 'Route inconnue');
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
    const { s } = await eleveDe(code, parts[3], query.token);
    return [200, { phase: s.phase }];
  }

  if (methode === 'POST' && parts.length === 5 && parts[2] === 'eleves' && parts[4] === 'progression') {
    const { s, e } = await eleveDe(code, parts[3], corps.token);
    if (s.phase === 'direct') {
      await redis('HSET', cleEleves(code), e.id, JSON.stringify({ ...e, ...progressionPropre(corps) }));
    }
    return [200, { phase: s.phase }];
  }

  throw new Erreur(404, 'Route inconnue');
}

module.exports = async function handler(req, res) {
  // vercel.json réécrit /api/<chemin> vers /api/router?chemin=<chemin>
  const parts = String(req.query.chemin || '').split('/').filter(Boolean);
  const query = { ...req.query };
  delete query.chemin;
  let corps = {};
  if (req.method === 'POST') {
    corps = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const [statut, donnees] = await router(req.method, parts, query, corps);
    res.status(statut).json(donnees);
  } catch (err) {
    if (err instanceof Erreur) return res.status(err.statut).json({ erreur: err.message });
    console.error(err);
    res.status(500).json({ erreur: 'Erreur serveur' });
  }
};
