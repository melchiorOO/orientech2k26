// ORIENTech — moteur à points façon Akinator.
// Aucun métier n'est éliminé : chaque réponse fait juste monter ou descendre sa probabilité.
// base = { metiers: { M01: {...}, ... }, questions: [{ id, texte, exemple, profils: { M01: 1 | -1 | 0 } }] }
(function (racine) {
  const REGLAGES = {
    min: 8,          // nombre minimum de questions avant de pouvoir conclure
    max: 25,         // nombre maximum de questions
    seuil: 0.8,      // proba du métier n°1 à partir de laquelle on conclut
    concorde: 0.85,  // poids si la réponse correspond au profil du métier
    contredit: 0.15, // poids si elle le contredit (jamais 0 : la porte reste ouverte)
    neutre: 0.5,     // poids si le métier est indifférent (?)
    rejete: 0.15     // poids d'un métier que l'élève a refusé ("pas convaincu·e") : il recule sans être éliminé
  };

  function creerPartie(base, reglages) {
    const R = Object.assign({}, REGLAGES, reglages);
    const ids = Object.keys(base.metiers);
    const parId = Object.fromEntries(base.questions.map((q) => [q.id, q]));
    let historique = []; // [{ id, oui }]

    // 1re question tirée au hasard (parmi celles qui départagent au moins un métier), pour que chaque partie démarre différemment
    const utiles = base.questions.filter((q) => { const v = Object.values(q.profils); return v.includes(1) && v.includes(-1); });
    const tirage = utiles.length ? utiles : base.questions;
    const premiere = tirage[Math.floor(Math.random() * tirage.length)] || null;

    // "Pas convaincu·e" : métiers refusés + nombre de questions à atteindre avant de reconclure
    const rejetes = new Set();
    let cible = null, debutBonus = 0;

    // Probabilité qu'un élève de ce métier réponde "oui"
    function pOui(q, m) {
      const v = q.profils[m] || 0;
      return v > 0 ? R.concorde : v < 0 ? R.contredit : R.neutre;
    }

    function probas() {
      const p = Object.fromEntries(ids.map((m) => [m, (rejetes.has(m) ? R.rejete : 1) / ids.length]));
      for (const { id, oui } of historique) {
        const q = parId[id];
        let total = 0;
        for (const m of ids) { p[m] *= oui ? pOui(q, m) : 1 - pOui(q, m); total += p[m]; }
        for (const m of ids) p[m] /= total;
      }
      return p;
    }

    const entropie = (vals) => vals.reduce((s, v) => (v > 0 ? s - v * Math.log2(v) : s), 0);

    // Question qui réduit le plus l'incertitude, sachant les probas actuelles
    function prochaineQuestion() {
      if (!historique.length && premiere) return premiere;
      const p = probas();
      const posees = new Set(historique.map((h) => h.id));
      let meilleure = null, meilleurScore = Infinity;
      for (const q of base.questions) {
        if (posees.has(q.id)) continue;
        const oui = ids.map((m) => p[m] * pOui(q, m));
        const non = ids.map((m) => p[m] * (1 - pOui(q, m)));
        const so = oui.reduce((a, b) => a + b, 0), sn = non.reduce((a, b) => a + b, 0);
        const score = so * entropie(oui.map((v) => v / so)) + sn * entropie(non.map((v) => v / sn));
        if (score < meilleurScore - 1e-9) { meilleurScore = score; meilleure = q; }
      }
      return meilleure;
    }

    function classement() {
      const p = probas();
      return ids.map((m) => ({ id: m, p: p[m] })).sort((a, b) => b.p - a.p);
    }

    function estFinie() {
      const n = historique.length;
      if (!prochaineQuestion()) return true;
      if (cible !== null) return n >= cible; // questions bonus : on va jusqu'au bout des n demandées
      if (n >= R.max) return true;
      return n >= R.min && classement()[0].p >= R.seuil;
    }

    // L'élève n'est pas convaincu par ce métier : il recule, et on pose `n` questions de plus avant de reconclure
    function prolonger(metier, n = 5) {
      rejetes.add(metier);
      debutBonus = historique.length;
      cible = debutBonus + Math.min(n, questionsRestantes());
    }
    const questionsRestantes = () => base.questions.length - historique.length;

    // % des réponses (hors questions neutres pour ce métier) qui collent à son profil
    function affinite(m) {
      let ok = 0, compte = 0;
      for (const { id, oui } of historique) {
        const v = parId[id].profils[m] || 0;
        if (!v) continue;
        compte++;
        if ((v > 0) === oui) ok++;
      }
      return compte ? Math.round((100 * ok) / compte) : 50;
    }

    return {
      reglages: R,
      repondre(id, oui) { historique.push({ id, oui }); },
      annuler() { return historique.pop(); },
      nbPosees: () => historique.length,
      prochaineQuestion, classement, estFinie, affinite, prolonger, questionsRestantes,
      // où en sont les questions bonus : { faites, total } (null hors bonus)
      bonus: () => (cible === null ? null : { faites: historique.length - debutBonus, total: cible - debutBonus }),
      confiance: () => classement()[0].p
    };
  }

  const sansAccent = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  // Salaire annuel ("33 – 40 k€ / an brut") -> fourchette mensuelle brute ("2 750 – 3 350 €"), arrondie à 50 €
  function salaireMensuel(s) {
    s = String(s).trim();
    if (!/k€|\/\s*an\b|annuel/i.test(s)) return s;
    const nombres = (s.match(/\d+(?:[.,]\d+)?/g) || []).slice(0, 2).map((n) => parseFloat(n.replace(',', '.')));
    if (!nombres.length) return s;
    const enEuros = (k) => (k < 1000 ? k * 1000 : k); // "33" k€ ou "33000" €
    return nombres.map((k) => (Math.round(enEuros(k) / 12 / 50) * 50).toLocaleString('fr-FR').replace(/ /g, ' ')).join(' – ') + ' €';
  }

  // Format V4 (PRODUCT_Orien_Tech_V4) : chaque métier a un code de 4 lettres (un pôle par axe),
  // chaque affirmation vise un pôle. Un métier "répond Oui" si son code contient le pôle visé, "Non" sinon.
  function lireV4(lignes, ongletMetiers, ongletQuestions) {
    const txt = (v) => String(v).trim();
    const liste = (v) => txt(v).split(';').map((s) => s.trim()).filter(Boolean);
    const sansNumero = (v) => txt(v).replace(/^\d+\s*[–-]\s*/, ''); // "3 – Design…" -> "Design…"
    const table = (nom) => {
      const l = lignes(nom);
      const entetes = l[0].map(sansAccent);
      return { rows: l.slice(1), col: (debut) => entetes.findIndex((h) => h.startsWith(debut)) };
    };

    const M = table(ongletMetiers);
    const c = {
      code: M.col('code'), nom: M.col('metier a presenter'), description: M.col('description'), anniversaire: M.col("etape de l"),
      competences: M.col('competences'), matieres: M.col('matieres'), voies: M.col('voies'), voisin: M.col('metier voisin'),
      famille: M.col('famille de rattachement principale'), voisine: M.col('famille de rattachement secondaire'),
      mission1: M.col('mission principale 1'), mission2: M.col('mission principale 2'), stage: M.col('stage'),
      entreprises: M.col('2 entreprises'), salaire: M.col('salaire'), duree: M.col('duree'), qualites: M.col('2 qualites')
    };
    const metiers = {};
    for (const r of M.rows) {
      const code = txt(r[c.code]).toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) continue; // ignore les lignes de notes
      const voies = liste(r[c.voies]);
      const trajectoire = [{ etape: 'Stage de 3ème', detail: txt(r[c.stage]) }];
      if (voies[0]) trajectoire.push({ etape: 'Formation', detail: voies[0] });
      if (voies.length > 1) trajectoire.push({ etape: 'Autres voies', detail: voies.slice(1).join(' · ') });
      trajectoire.push({ etape: liste(r[c.entreprises]).join(', ') || 'Entreprise', detail: txt(r[c.nom]), cible: true });
      metiers[code] = {
        code, nom: txt(r[c.nom]), description: txt(r[c.description]), anniversaire: txt(r[c.anniversaire]),
        missions: [txt(r[c.mission1]), txt(r[c.mission2])].filter(Boolean), qualites: txt(r[c.qualites]),
        salaire: salaireMensuel(r[c.salaire]), salaire_note: '',
        dynamique: '', famille: sansNumero(r[c.famille]), famille_voisine: sansNumero(r[c.voisine]),
        cursus: txt(r[c.duree]), cursus_label: 'Études après le bac', bacs: liste(r[c.matieres]),
        trajectoire, competences: liste(r[c.competences]), voisin: txt(r[c.voisin])
      };
    }

    const Q = table(ongletQuestions);
    const cq = { num: Q.col('n'), axe: Q.col('axe'), nomAxe: Q.col("nom de l'axe"), texte: Q.col('affirmation'), pole: Q.col('pole vise'), exemple: Q.col('mise en situation') };
    const questions = Q.rows
      .filter((r) => txt(r[cq.texte]) && /^[A-Z]$/.test(txt(r[cq.pole]).toUpperCase()))
      .sort((a, b) => Number(a[cq.num]) - Number(b[cq.num]))
      .map((r) => {
        const axe = Number(r[cq.axe]), pole = txt(r[cq.pole]).toUpperCase();
        const profils = {};
        for (const code in metiers) profils[code] = code[axe - 1] === pole ? 1 : -1;
        const exemple = txt(r[cq.exemple]).replace(/^exemple\s*:\s*/i, '');
        return {
          id: 'Q' + String(r[cq.num]).padStart(2, '0'), texte: txt(r[cq.texte]),
          exemple: exemple.charAt(0).toUpperCase() + exemple.slice(1), theme: txt(r[cq.nomAxe]), profils
        };
      });
    return { metiers, questions };
  }

  // Lecture du fichier Excel (objet "workbook" de SheetJS) -> base
  function lireClasseur(XLSX, wb) {
    const trouver = (motif) => wb.SheetNames.find((n) => motif.test(sansAccent(n)));
    const lignes = (nom) => XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, defval: '' });
    const txt = (v) => String(v).trim();
    const liste = (v) => txt(v).split(';').map((s) => s.trim()).filter(Boolean);

    const ongletMetiers = trouver(/^metier/);
    if (sansAccent(lignes(ongletMetiers)[0][0]).startsWith('code')) return lireV4(lignes, ongletMetiers, trouver(/^question/));

    const metiers = {};
    const lm = lignes(ongletMetiers);
    const entetes = lm[0].map((h) => txt(h).toLowerCase());
    for (const ligne of lm.slice(1)) {
      const r = Object.fromEntries(entetes.map((h, i) => [h, ligne[i]]));
      if (!txt(r.id) || !txt(r.nom)) continue;
      const trajectoire = [1, 2, 3].map((i) => ({ etape: txt(r['etape' + i]), detail: txt(r['detail' + i]) })).filter((t) => t.etape);
      trajectoire.push({ etape: txt(r.etape_cible), detail: txt(r.detail_cible), cible: true });
      // "À confirmer" = pas encore de donnée : la carte rose affiche alors la famille de métiers
      const dynamique = /^a confirmer$/.test(sansAccent(txt(r.dynamique))) ? '' : txt(r.dynamique);
      metiers[txt(r.id).toUpperCase()] = {
        nom: txt(r.nom), salaire: salaireMensuel(r.salaire), salaire_note: txt(r.salaire_note),
        dynamique, dynamique_note: dynamique ? txt(r.dynamique_note) : '',
        cursus: txt(r.cursus), bacs: liste(r.bacs), trajectoire, competences: liste(r.competences),
        // colonnes ajoutées en V5 (facultatives)
        famille: txt(r.famille_principale ?? '').replace(/^\d+\s*[–-]\s*/, ''),
        famille_voisine: txt(r.famille_secondaire ?? '').replace(/^\d+\s*[–-]\s*/, ''),
        missions: [txt(r.mission1 ?? ''), txt(r.mission2 ?? '')].filter(Boolean),
        qualites: txt(r.qualites ?? '')
      };
    }

    // Onglet "Pôles visés" (V5, facultatif) : donne l'axe de chaque question, utilisé comme thème
    const AXES = { 1: "Ce qui m'attire", 2: 'Ma démarche', 3: 'Mon terrain', 4: 'Ma façon de travailler' };
    const themes = {};
    const ongletPoles = trouver(/^poles/);
    if (ongletPoles) lignes(ongletPoles).slice(1).forEach((l) => { if (txt(l[0]) && AXES[l[1]]) themes[txt(l[0])] = AXES[l[1]]; });

    const lq = lignes(trouver(/^questions?$/) || trouver(/question/)); // pas l'onglet "Questions familles"
    const colonnes = lq[0].map((h) => txt(h).toUpperCase());
    const colExemple = colonnes.indexOf('EXEMPLE');
    const questions = [];
    for (const ligne of lq.slice(1)) {
      const texte = txt(ligne[1]);
      if (!txt(ligne[0]) || !texte) continue; // ignore la ligne des noms de métiers et les lignes vides
      const profils = {};
      colonnes.forEach((m, i) => {
        if (!metiers[m]) return;
        const v = txt(ligne[i]).toUpperCase()[0];
        profils[m] = v === 'O' ? 1 : v === 'N' ? -1 : 0;
      });
      const exemple = colExemple >= 0 ? txt(ligne[colExemple]) : '';
      questions.push({ id: txt(ligne[0]), texte, exemple, theme: themes[txt(ligne[0])] || '', profils });
    }
    return { metiers, questions };
  }

  const api = { creerPartie, lireClasseur, REGLAGES };
  if (typeof module !== 'undefined') module.exports = api; else racine.Moteur = api;
})(this);
