// ORIENTech — page admin : fiches métiers, nœuds de la toile (affirmations) et leur outcome (ce que chaque métier répond).
// FRONT-END SEULEMENT : les modifications s'appliquent tout de suite au jeu dans ce navigateur (jusqu'au rechargement),
// "Exporter" télécharge le résultat en JSON, "Enregistrer" est à brancher sur serveur.py.
(function (racine) {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const LETTRE = { 1: 'O', '-1': 'N', 0: '?' };
  const SUIVANT = { 1: -1, '-1': 0, 0: 1 }; // O -> N -> ? -> O
  const COULEUR = { 1: 'bg-[#00FF9D] text-black', '-1': 'bg-[#FF2A85] text-white', 0: 'bg-white/10 text-white/50' };

  // Champs éditables d'une fiche : [clé, libellé, type] ; type "liste" = valeurs séparées par « ; »
  const CHAMPS = [
    ['nom', 'Nom du métier', 'texte'], ['code', 'Code (4 lettres)', 'texte'],
    ['description', 'Description (pour les collégiens)', 'long'],
    ['famille', 'Famille de métiers', 'texte'], ['famille_voisine', 'Famille voisine', 'texte'],
    ['salaire', 'Salaire', 'texte'], ['salaire_unite', 'Légende du salaire', 'texte'],
    ['cursus', "Durée / niveau d'études", 'texte'], ['cursus_label', 'Légende du cursus', 'texte'],
    ['bacs', 'Matières / bacs (séparés par ;)', 'liste'], ['competences', 'Compétences (séparées par ;)', 'liste'],
    ['missions', 'Missions (séparées par ;)', 'liste'], ['qualites', 'Qualités clés', 'texte'],
    ['anniversaire', "Étape de l'anniversaire", 'texte'], ['voisin', 'Métier voisin à explorer', 'texte']
  ];

  let base = null, opts = {}, original = null, modifie = false;
  let onglet = 'fiches', ficheSel = null, noeudSel = null;

  const idsMetiers = () => Object.keys(base.metiers).sort((a, b) => base.metiers[a].nom.localeCompare(base.metiers[b].nom, 'fr'));
  const noeud = (id) => base.questions.find((q) => q.id === id);

  function marquer() {
    modifie = true;
    $('aEtat').textContent = '● Modifications non enregistrées';
    $('aEtat').className = 'text-xs font-space font-bold text-[#FFE600]';
  }
  function remettreEtat() {
    modifie = false;
    $('aEtat').textContent = 'Aucune modification';
    $('aEtat').className = 'text-xs font-space font-bold text-white/60';
  }
  window.addEventListener('beforeunload', (e) => { if (modifie) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- Onglets

  function changerOnglet(o) {
    onglet = o;
    document.querySelectorAll('[data-onglet]').forEach((b) => (b.dataset.onglet === o ? (b.dataset.actif = '') : delete b.dataset.actif));
    document.querySelectorAll('[data-panneau]').forEach((p) => p.classList.toggle('hidden', p.dataset.panneau !== o));
    rendreOnglet();
  }
  function rendreOnglet() {
    if (onglet === 'fiches') { rendreListeFiches(); rendreFiche(); }
    if (onglet === 'noeuds') { rendreListeNoeuds(); rendreNoeud(); }
    if (onglet === 'matrice') rendreMatrice();
  }
  document.querySelectorAll('[data-onglet]').forEach((b) => (b.onclick = () => changerOnglet(b.dataset.onglet)));

  // ---------- Fiches métiers

  function rendreListeFiches() {
    const cherche = $('aFichesRecherche').value.trim().toLowerCase();
    const ids = idsMetiers();
    $('aNbFiches').textContent = ids.length;
    $('aFichesListe').innerHTML = ids
      .filter((id) => !cherche || `${base.metiers[id].nom} ${base.metiers[id].code || ''}`.toLowerCase().includes(cherche))
      .map((id) => `<button type="button" class="admin-item" data-fiche="${esc(id)}" ${id === ficheSel ? 'data-actif' : ''}>
          ${base.metiers[id].code ? `<span class="font-lucky text-[10px] px-1.5 rounded bg-black text-[#FFE600]">${esc(base.metiers[id].code)}</span>` : ''}
          <span class="truncate">${esc(base.metiers[id].nom)}</span></button>`).join('');
    $('aFichesListe').querySelectorAll('[data-fiche]').forEach((b) => (b.onclick = () => { ficheSel = b.dataset.fiche; rendreListeFiches(); rendreFiche(); }));
  }
  $('aFichesRecherche').addEventListener('input', rendreListeFiches);

  function rendreFiche() {
    const m = base.metiers[ficheSel];
    const ed = $('aFicheEditeur');
    if (!m) {
      ed.innerHTML = `<span class="carte-titre">Fiche</span><p class="text-sm font-bold text-white/60">Choisis un métier dans la liste pour modifier sa fiche.</p>`;
      return;
    }
    const valeur = (k, type) => (type === 'liste' ? (m[k] || []).join(' ; ') : m[k] || '');
    const compte = { 1: 0, '-1': 0, 0: 0 };
    base.questions.forEach((q) => compte[q.profils[ficheSel] || 0]++);
    ed.innerHTML = `
      <span class="carte-titre">Fiche : ${esc(m.nom)}</span>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        ${CHAMPS.map(([k, label, type]) => `
          <label class="${type === 'long' ? 'sm:col-span-2' : ''}"><span class="etiquette">${esc(label)}</span>
            ${type === 'long'
              ? `<textarea data-champ="${k}" data-type="${type}" rows="3" class="champ text-sm">${esc(valeur(k, type))}</textarea>`
              : `<input data-champ="${k}" data-type="${type}" class="champ text-sm" value="${esc(valeur(k, type))}">`}
          </label>`).join('')}
      </div>
      <div>
        <span class="etiquette">Trajectoire (la dernière étape = la carte jaune « cible »)</span>
        <div id="aTrajectoire" class="flex flex-col gap-2"></div>
        <button type="button" id="aAjoutEtape" class="admin-btn bg-white mt-2"><span class="material-symbols-outlined text-base">add</span>Étape</button>
      </div>
      <p class="text-xs font-bold text-white/70">Dans la toile, ce métier répond
        <span class="px-1.5 rounded bg-[#00FF9D] text-black">${compte[1]} Oui</span>
        <span class="px-1.5 rounded bg-[#FF2A85]">${compte[-1]} Non</span>
        <span class="px-1.5 rounded bg-white/10">${compte[0]} ?</span> — modifiable dans l'onglet Matrice ou Nœuds.</p>
      <div class="flex flex-wrap gap-2 justify-between">
        <button type="button" id="aVoirFiche" class="admin-btn bg-[#00E5FF]"><span class="material-symbols-outlined text-base">visibility</span>Voir comme un élève</button>
        <button type="button" id="aSupprFiche" class="admin-btn bg-[#FF2A85] !text-white"><span class="material-symbols-outlined text-base">delete</span>Supprimer ce métier</button>
      </div>`;

    ed.querySelectorAll('[data-champ]').forEach((el) => el.addEventListener('input', () => {
      const k = el.dataset.champ;
      m[k] = el.dataset.type === 'liste' ? el.value.split(';').map((s) => s.trim()).filter(Boolean) : el.value;
      if (k === 'trajectoire') return;
      marquer();
      if (k === 'nom' || k === 'code') rendreListeFiches();
    }));
    rendreTrajectoire(m);
    $('aAjoutEtape').onclick = () => {
      m.trajectoire = m.trajectoire || [];
      m.trajectoire.splice(Math.max(0, m.trajectoire.length - 1), 0, { etape: '', detail: '' }); // avant la cible
      majCibles(m); marquer(); rendreTrajectoire(m);
    };
    $('aVoirFiche').onclick = () => opts.voirFiche(m);
    $('aSupprFiche').onclick = () => {
      if (!confirm(`Supprimer « ${m.nom} » ? Il disparaîtra aussi de la matrice.`)) return;
      delete base.metiers[ficheSel];
      base.questions.forEach((q) => delete q.profils[ficheSel]);
      ficheSel = null; marquer(); rendreListeFiches(); rendreFiche();
    };
  }

  const majCibles = (m) => m.trajectoire.forEach((t, i) => { if (i === m.trajectoire.length - 1) t.cible = true; else delete t.cible; });

  function rendreTrajectoire(m) {
    const t = m.trajectoire || [];
    $('aTrajectoire').innerHTML = t.map((e, i) => `
      <div class="grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center">
        <span class="font-lucky text-xs border-2 border-black rounded px-1.5 ${e.cible ? 'bg-[#FFE600] text-black' : 'bg-[#321250]'}">${e.cible ? '★' : i + 1}</span>
        <input data-etape="${i}" data-k="etape" class="champ !py-1 text-sm" value="${esc(e.etape)}" placeholder="Étape">
        <input data-etape="${i}" data-k="detail" class="champ !py-1 text-sm" value="${esc(e.detail)}" placeholder="Détail">
        <button type="button" data-suppr-etape="${i}" class="w-7 h-7 rounded-lg bg-black border-2 border-black text-[#FF2A85] font-black" aria-label="Supprimer l'étape">×</button>
      </div>`).join('') || '<p class="text-xs text-white/50">Aucune étape.</p>';
    $('aTrajectoire').querySelectorAll('[data-etape]').forEach((el) => el.addEventListener('input', () => {
      t[+el.dataset.etape][el.dataset.k] = el.value; marquer();
    }));
    $('aTrajectoire').querySelectorAll('[data-suppr-etape]').forEach((b) => (b.onclick = () => {
      t.splice(+b.dataset.supprEtape, 1); majCibles(m); marquer(); rendreTrajectoire(m);
    }));
  }

  $('aNouveauMetier').onclick = () => {
    let n = 1;
    while (base.metiers['NOUV' + n]) n++;
    const id = 'NOUV' + n;
    base.metiers[id] = { nom: `Nouveau métier ${n}`, code: '', description: '', bacs: [], competences: [], missions: [],
      trajectoire: [{ etape: 'Lieu de travail', detail: '', cible: true }] };
    base.questions.forEach((q) => (q.profils[id] = 0)); // répond « ? » partout tant qu'on ne l'a pas réglé
    ficheSel = id; marquer(); rendreListeFiches(); rendreFiche();
  };

  // ---------- Nœuds de la toile (affirmations) et leur outcome

  function rendreListeNoeuds() {
    const cherche = $('aNoeudsRecherche').value.trim().toLowerCase();
    $('aNbNoeuds').textContent = base.questions.length;
    $('aNoeudsListe').innerHTML = base.questions
      .filter((q) => !cherche || `${q.id} ${q.texte} ${q.theme || ''}`.toLowerCase().includes(cherche))
      .map((q) => {
        const vals = Object.values(q.profils);
        const inutile = !vals.includes(1) || !vals.includes(-1);
        return `<button type="button" class="admin-item" data-noeud="${esc(q.id)}" ${q.id === noeudSel ? 'data-actif' : ''}>
          <span class="font-lucky text-[10px] px-1.5 rounded bg-black text-[#00E5FF] shrink-0">${esc(q.id)}</span>
          <span class="truncate flex-1">${esc(q.texte)}</span>
          ${inutile ? '<span title="Ne départage aucun métier" class="shrink-0">⚠️</span>' : ''}</button>`;
      }).join('');
    $('aNoeudsListe').querySelectorAll('[data-noeud]').forEach((b) => (b.onclick = () => { noeudSel = b.dataset.noeud; rendreListeNoeuds(); rendreNoeud(); }));
  }
  $('aNoeudsRecherche').addEventListener('input', rendreListeNoeuds);

  function rendreNoeud() {
    const q = noeud(noeudSel);
    const ed = $('aNoeudEditeur');
    if (!q) {
      ed.innerHTML = `<span class="carte-titre">Nœud</span><p class="text-sm font-bold text-white/60">Choisis un nœud dans la liste pour modifier l'affirmation et son outcome.</p>`;
      return;
    }
    const ids = idsMetiers();
    const avecCodes = ids.length && ids.every((id) => /^[A-Z]{4}$/.test(base.metiers[id].code || ''));
    const vals = ids.map((id) => q.profils[id] || 0);
    const nb = (v) => vals.filter((x) => x === v).length;
    ed.innerHTML = `
      <span class="carte-titre">Nœud ${esc(q.id)}</span>
      <label><span class="etiquette">Affirmation affichée à l'élève</span>
        <textarea data-q="texte" rows="2" class="champ text-sm">${esc(q.texte)}</textarea></label>
      <div class="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-3">
        <label><span class="etiquette">Exemple (bouton 💡)</span><textarea data-q="exemple" rows="2" class="champ text-sm">${esc(q.exemple)}</textarea></label>
        <label><span class="etiquette">Thème / axe</span><input data-q="theme" class="champ text-sm" value="${esc(q.theme)}"></label>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="etiquette !mb-0">Outcome : ce que répondrait chaque métier</span>
          <span class="text-xs font-bold">
            <span class="px-1.5 rounded bg-[#00FF9D] text-black">${nb(1)} O</span>
            <span class="px-1.5 rounded bg-[#FF2A85]">${nb(-1)} N</span>
            <span class="px-1.5 rounded bg-white/10">${nb(0)} ?</span></span>
        </div>
        ${!nb(1) || !nb(-1) ? `<p class="text-xs font-bold text-[#FFE600]">⚠️ Ce nœud ne départage aucun métier : il faut au moins un O et un N.</p>` : ''}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          ${ids.map((id) => {
            const v = q.profils[id] || 0;
            return `<button type="button" data-outcome="${esc(id)}" class="flex items-center gap-2 rounded-lg border-[2.5px] border-black px-2 py-1 text-left text-xs font-bold ${COULEUR[v]}">
              <span class="font-lucky w-5 text-center">${LETTRE[v]}</span><span class="truncate">${esc(base.metiers[id].nom)}</span></button>`;
          }).join('')}
        </div>
        <div class="flex flex-wrap gap-2 items-center">
          <button type="button" data-tous="1" class="admin-btn bg-[#00FF9D]">Tous O</button>
          <button type="button" data-tous="-1" class="admin-btn bg-[#FF2A85] !text-white">Tous N</button>
          <button type="button" data-tous="0" class="admin-btn bg-white">Tous ?</button>
          ${avecCodes ? `
          <span class="text-xs font-bold text-white/70 ml-2">ou depuis les codes : un Oui vise le pôle</span>
          <select id="aPole" class="champ !w-auto !py-1 text-sm">
            ${[0, 1, 2, 3].map((axe) => [...new Set(ids.map((id) => base.metiers[id].code[axe]))]
              .map((l) => `<option value="${axe}:${l}">axe ${axe + 1} · ${l}</option>`).join('')).join('')}
          </select>
          <button type="button" id="aAppliquerPole" class="admin-btn bg-[#00E5FF]">Appliquer</button>` : ''}
        </div>
      </div>
      <div class="flex justify-end">
        <button type="button" id="aSupprNoeud" class="admin-btn bg-[#FF2A85] !text-white"><span class="material-symbols-outlined text-base">delete</span>Supprimer ce nœud</button>
      </div>`;

    ed.querySelectorAll('[data-q]').forEach((el) => el.addEventListener('input', () => {
      q[el.dataset.q] = el.value; marquer();
      if (el.dataset.q === 'texte') rendreListeNoeuds();
    }));
    ed.querySelectorAll('[data-outcome]').forEach((b) => (b.onclick = () => {
      q.profils[b.dataset.outcome] = SUIVANT[q.profils[b.dataset.outcome] || 0]; marquer(); rendreNoeud(); rendreListeNoeuds();
    }));
    ed.querySelectorAll('[data-tous]').forEach((b) => (b.onclick = () => {
      ids.forEach((id) => (q.profils[id] = Number(b.dataset.tous))); marquer(); rendreNoeud(); rendreListeNoeuds();
    }));
    if (avecCodes) $('aAppliquerPole').onclick = () => {
      const [axe, lettre] = $('aPole').value.split(':');
      ids.forEach((id) => (q.profils[id] = base.metiers[id].code[+axe] === lettre ? 1 : -1));
      marquer(); rendreNoeud(); rendreListeNoeuds();
    };
    $('aSupprNoeud').onclick = () => {
      if (!confirm(`Supprimer le nœud ${q.id} ?`)) return;
      base.questions.splice(base.questions.indexOf(q), 1);
      noeudSel = null; marquer(); rendreListeNoeuds(); rendreNoeud();
    };
  }

  $('aNouveauNoeud').onclick = () => {
    let n = base.questions.length + 1;
    while (noeud('Q' + String(n).padStart(2, '0'))) n++;
    const q = { id: 'Q' + String(n).padStart(2, '0'), texte: 'Nouvelle affirmation…', exemple: '', theme: '', profils: {} };
    Object.keys(base.metiers).forEach((id) => (q.profils[id] = 0));
    base.questions.push(q);
    noeudSel = q.id; marquer(); rendreListeNoeuds(); rendreNoeud();
  };

  // ---------- Matrice complète

  function rendreMatrice() {
    const ids = idsMetiers();
    const th = 'sticky top-0 z-10 bg-[#1A072E] border border-black/60';
    $('aMatrice').innerHTML = `
      <thead><tr>
        <th class="${th} left-0 z-20 text-left px-2 min-w-[18rem] font-lucky uppercase">Nœud</th>
        ${ids.map((id) => `<th class="${th} px-0.5 py-1 align-bottom" title="${esc(base.metiers[id].nom)}">
          <span class="block [writing-mode:vertical-rl] rotate-180 font-bold text-[11px] max-h-40 truncate">${esc(base.metiers[id].code || base.metiers[id].nom)}</span></th>`).join('')}
      </tr></thead>
      <tbody>${base.questions.map((q) => `<tr>
        <td class="sticky left-0 bg-[#2e1047] border border-black/60 px-2 py-1 max-w-[18rem] truncate" title="${esc(q.texte)}">
          <span class="font-lucky text-[#00E5FF] mr-1">${esc(q.id)}</span>${esc(q.texte)}</td>
        ${ids.map((id) => { const v = q.profils[id] || 0; return `<td class="p-0"><button type="button" class="cellule ${COULEUR[v]}" data-q="${esc(q.id)}" data-m="${esc(id)}">${LETTRE[v]}</button></td>`; }).join('')}
      </tr>`).join('')}</tbody>`;
  }
  $('aMatrice').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q][data-m]');
    if (!b) return;
    const q = noeud(b.dataset.q);
    const v = (q.profils[b.dataset.m] = SUIVANT[q.profils[b.dataset.m] || 0]);
    b.className = `cellule ${COULEUR[v]}`;
    b.textContent = LETTRE[v];
    marquer();
  });

  // ---------- Barre d'actions

  $('aAnnuler').onclick = () => {
    if (!modifie || !confirm('Annuler toutes les modifications depuis le chargement du fichier ?')) return;
    const copie = clone(original);
    Object.keys(base.metiers).forEach((k) => delete base.metiers[k]);
    Object.assign(base.metiers, copie.metiers);
    base.questions.splice(0, base.questions.length, ...copie.questions); // on garde les mêmes objets "base" que le jeu utilise
    ficheSel = noeudSel = null;
    remettreEtat(); rendreOnglet();
    opts.toast('Modifications annulées');
  };

  function exportJSON() {
    return {
      exporte: new Date().toISOString(),
      metiers: base.metiers,
      questions: base.questions.map((q) => ({ ...q, profils: Object.fromEntries(Object.entries(q.profils).map(([m, v]) => [m, LETTRE[v]])) }))
    };
  }

  $('aExporter').onclick = () => {
    const blob = new Blob([JSON.stringify(exportJSON(), null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'orientech_admin.json' });
    a.click();
    URL.revokeObjectURL(a.href);
    opts.toast('Export téléchargé');
  };

  // TODO backend : POST vers serveur.py (ex. /api/admin/matrice) puis mise à jour du fichier de données
  $('aEnregistrer').onclick = () => {
    console.info('[ORIENTech] enregistrement admin (non envoyé : backend à brancher)', exportJSON());
    opts.toast('Enregistrement pas encore branché : utilise « Exporter »');
  };

  // options : { toast, voirFiche(metier), onglet? }
  function ouvrir(b, options) {
    base = b;
    opts = options;
    if (!original) original = clone({ metiers: b.metiers, questions: b.questions });
    if (!base.metiers[ficheSel]) ficheSel = idsMetiers()[0] || null;
    if (!noeud(noeudSel)) noeudSel = base.questions[0] ? base.questions[0].id : null;
    changerOnglet(['fiches', 'noeuds', 'matrice'].includes(options.onglet) ? options.onglet : onglet);
  }

  racine.Admin = { ouvrir };
})(this);
