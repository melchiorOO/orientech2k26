// ORIENTech V7 — moteur probabiliste (portage de orientech_v7/moteur_reference.py, classe Partie).
// Chaque case p[m] = probabilité qu'un·e élève fait·e pour le métier m réponde OUI, adoucie par ε.
// base = { format: 'v7', version, echelle, parametres, familles, metiers: { M01: {...fiche} }, questions: [{ id, formulations, exemples, p, ... }] }
// Même interface que Moteur.creerPartie (moteur.js), pour que game.js, prof.js et pro.js marchent sans changement.
(function (racine) {
  const DEFAUTS = {
    rejete: 0.15,   // poids d'un métier refusé (« pas convaincu·e ») : il recule sans être éliminé
    dejaVues: [],   // ids des questions des dernières parties de l'élève : leur gain est divisé par penalite_deja_vu
    aleatoire: Math.random // générateur remplaçable (tests reproductibles)
  };

  // Fiche minimale quand l'Excel des fiches ne connaît pas un métier du JSON
  function ficheMinimale(m, familles) {
    const famille = (familles.find((f) => f.id === m.famille_principale) || {}).nom || '';
    return { nom: m.nom, famille, famille_voisine: '', salaire: '', salaire_note: '', dynamique: '', dynamique_note: '',
      cursus: '', bacs: [], trajectoire: [], competences: [], missions: [], qualites: '' };
  }

  // json = app/data/orientech_v7.json (ou la matrice enregistrée par l'admin) ; fiches = Moteur.lireClasseur(...).metiers
  function lireV7(json, fiches) {
    const familles = json.familles || [];
    const metiers = {};
    for (const m of json.metiers) {
      if (fiches && fiches[m.id]) metiers[m.id] = fiches[m.id];
      else {
        console.warn(`[ORIENTech] pas de fiche pour ${m.id} (${m.nom}) : fiche minimale`);
        metiers[m.id] = ficheMinimale(m, familles);
      }
    }
    const questions = json.questions.map((q) => ({
      ...q, p: { ...q.p }, proches: [...(q.proches || [])],
      // champs lus par game.js, pro.js et prof.js (formulation A par défaut)
      texte: q.formulations[0], exemple: q.exemples[0], theme: q.theme_vie
    }));
    return { format: 'v7', version: json.version, echelle: json.echelle, parametres: json.parametres_moteur,
      familles, metiersV7: json.metiers, metiers, questions };
  }

  const entropie = (vals) => vals.reduce((s, v) => (v > 0 ? s - v * Math.log2(v) : s), 0);

  function creerPartie(base, reglages) {
    const R = Object.assign({}, DEFAUTS, base.parametres, reglages);
    const hasard = R.aleatoire;
    const ids = Object.keys(base.metiers);
    const Q = base.questions;
    const index = Object.fromEntries(Q.map((q, i) => [q.id, i]));
    const eps = R.epsilon;

    // P(OUI | métier) adoucie : pOui = ε·0.5 + (1−ε)·p ; un métier absent d'une question vaut 0.5
    const Pe = Q.map((q) => ids.map((m) => eps * 0.5 + (1 - eps) * (q.p[m] ?? 0.5)));
    const logOui = Pe.map((l) => l.map(Math.log));
    const logNon = Pe.map((l) => l.map((v) => Math.log(1 - v)));

    // Questions qu'on ne pose jamais avec q : même groupe, ou « proches » (relation rendue symétrique)
    const interdites = Q.map(() => new Set());
    Q.forEach((q, i) => {
      for (const autre of q.proches || []) {
        const j = index[autre];
        if (j === undefined || j === i) continue;
        interdites[i].add(j);
        interdites[j].add(i);
      }
    });
    const parGroupe = {};
    Q.forEach((q, i) => (parGroupe[q.groupe] = parGroupe[q.groupe] || []).push(i));
    Object.values(parGroupe).forEach((liste) => liste.forEach((i) => liste.forEach((j) => i !== j && interdites[i].add(j))));

    const vues = new Set(R.dejaVues || []);
    const penalite = Q.map((q) => (vues.has(q.id) ? 1 / R.penalite_deja_vu : 1));

    let historique = []; // [{ id, oui }]
    const formes = {};   // id question -> formulation tirée (0 = A, 1 = B), gardée toute la partie
    let cache;           // prochaine question déjà choisie (undefined = à choisir, null = plus aucune)

    // "Pas convaincu·e" : métiers refusés + nombre de questions à atteindre avant de reconclure
    const rejetes = new Set();
    let cible = null, debutBonus = 0;

    // A posteriori, recalculé depuis l'historique (annuler = retirer la dernière réponse), en log
    function posterieur() {
      const lp = ids.map((m) => Math.log(rejetes.has(m) ? R.rejete : 1));
      for (const { id, oui } of historique) {
        const i = index[id];
        const l = oui ? logOui[i] : logNon[i];
        for (let k = 0; k < ids.length; k++) lp[k] += l[k];
      }
      const max = Math.max(...lp);
      const x = lp.map((v) => Math.exp(v - max));
      const total = x.reduce((a, b) => a + b, 0);
      return x.map((v) => v / total);
    }

    // Gain d'information attendu (bits) : H(post) − E[H(post | réponse)]
    function gain(post, i) {
      const pe = Pe[i];
      const oui = post.map((p, k) => p * pe[k]);
      const non = post.map((p, k) => p * (1 - pe[k]));
      const so = oui.reduce((a, b) => a + b, 0), sn = 1 - so;
      return entropie(post) - (so * entropie(oui.map((v) => v / so)) + sn * entropie(non.map((v) => v / sn)));
    }

    function nonInterdites() {
      const exclues = new Set();
      for (const { id } of historique) {
        const i = index[id];
        exclues.add(i);
        interdites[i].forEach((j) => exclues.add(j));
      }
      return Q.map((q, i) => i).filter((i) => !exclues.has(i));
    }

    // + alternance : ni le même thème de vie ni la même dimension que la question précédente (règle relâchée si plus rien)
    function permises() {
      const ok = nonInterdites();
      if (!historique.length) return ok;
      const der = Q[index[historique[historique.length - 1].id]];
      const alterne = ok.filter((i) => Q[i].theme_vie !== der.theme_vie && Q[i].dimension_principale !== der.dimension_principale);
      return alterne.length ? alterne : ok;
    }

    function tirer(poids) {
      const total = poids.reduce((a, b) => a + b, 0);
      let r = hasard() * total;
      for (let k = 0; k < poids.length; k++) { r -= poids[k]; if (r < 0) return k; }
      return poids.length - 1;
    }

    function choisir() {
      // 1re question : tirage parmi les ouvertures (les déjà-vues pèsent penalite_deja_vu fois moins)
      if (!historique.length) {
        const ouvertures = Q.map((q, i) => i).filter((i) => Q[i].ouverture);
        if (ouvertures.length) return ouvertures[tirer(ouvertures.map((i) => penalite[i]))];
      }
      let cand = permises();
      if (!cand.length) return null;
      // tours réservés aux centres d'intérêt (ex. 11e et 14e question), s'il en reste de permises
      if ((R.tours_centre_interet || []).includes(historique.length + 1)) {
        const interets = cand.filter((i) => Q[i].centre_interet != null);
        if (interets.length) cand = interets;
      }
      const post = posterieur();
      const top = cand.map((i) => ({ i, g: gain(post, i) * penalite[i] })).sort((a, b) => b.g - a.g).slice(0, R.top_k);
      const gmax = top[0].g;
      const poids = R.temperature <= 0 ? top.map((t) => (t.g === gmax ? 1 : 0)) : top.map((t) => Math.exp((t.g - gmax) / R.temperature));
      return top[tirer(poids)].i;
    }

    // La question telle qu'affichée : formulation A ou B tirée une fois, avec l'exemple de même rang
    function affichee(i) {
      const q = Q[i];
      if (formes[q.id] === undefined) formes[q.id] = hasard() < 0.5 ? 0 : 1;
      const k = formes[q.id];
      return { ...q, texte: q.formulations[k], exemple: q.exemples[k] };
    }

    // Même question tant que ni repondre, ni annuler, ni prolonger n'ont été appelés (estFinie puis game.js l'appellent)
    function prochaineQuestion() {
      if (cache === undefined) {
        const i = choisir();
        cache = i === null ? null : affichee(i);
      }
      return cache;
    }

    function classement() {
      const p = posterieur();
      return ids.map((m, k) => ({ id: m, p: p[k] })).sort((a, b) => b.p - a.p);
    }

    function estFinie() {
      const n = historique.length;
      if (cible !== null) return n >= cible || !prochaineQuestion(); // questions bonus : on va jusqu'au bout des n demandées
      if (n >= R.max_questions) return true;
      if (n >= R.min_questions) {
        const [a, b] = classement();
        if (a.p > R.seuil_arret && a.p >= R.ratio_arret * (b ? b.p : 0)) return true;
      }
      return !prochaineQuestion();
    }

    // Questions encore posables (ni posées, ni du même groupe, ni proches d'une question posée)
    const questionsRestantes = () => nonInterdites().length;

    // L'élève n'est pas convaincu par ce métier : il recule, et on pose `n` questions de plus avant de reconclure
    function prolonger(metier, n = 5) {
      rejetes.add(metier);
      debutBonus = historique.length;
      cible = debutBonus + Math.min(n, questionsRestantes());
      cache = undefined;
    }

    // Moyenne, sur les questions posées qui ne sont pas neutres pour ce métier, de la probabilité de la réponse donnée
    function affinite(m) {
      let somme = 0, compte = 0;
      for (const { id, oui } of historique) {
        const p = Q[index[id]].p[m] ?? 0.5;
        if (p === 0.5) continue;
        compte++;
        somme += oui ? p : 1 - p;
      }
      return compte ? Math.round((100 * somme) / compte) : 50;
    }

    return {
      reglages: R,
      repondre(id, oui) { historique.push({ id, oui }); cache = undefined; },
      // la question annulée redevient la prochaine, avec la même formulation
      annuler() {
        const h = historique.pop();
        cache = h ? affichee(index[h.id]) : undefined;
        return h;
      },
      nbPosees: () => historique.length,
      prochaineQuestion, classement, estFinie, affinite, prolonger, questionsRestantes,
      // où en sont les questions bonus : { faites, total } (null hors bonus)
      bonus: () => (cible === null ? null : { faites: historique.length - debutBonus, total: cible - debutBonus }),
      confiance: () => classement()[0].p
    };
  }

  const api = { creerPartie, lireV7 };
  if (typeof module !== 'undefined') module.exports = api; else racine.MoteurV7 = api;
})(this);
