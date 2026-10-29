// ORIENTech — page admin : fiches métiers, nœuds de la toile (affirmations) et leur outcome (ce que chaque métier répond).
// Les modifications s'appliquent tout de suite au jeu dans ce navigateur ; "Enregistrer" les publie sur le serveur.
// Deux formats : V6 (cases O / N / ?) et V7 (base.format === 'v7' : probabilités de OUI sur une échelle à 7 niveaux).
(function (racine) {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const LETTRE = { 1: 'O', '-1': 'N', 0: '?' };
  const SUIVANT = { 1: -1, '-1': 0, 0: 1 }; // O -> N -> ? -> O
  const COULEUR = { 1: 'bg-[#00FF9D] text-black', '-1': 'bg-[#FF2A85] text-white', 0: 'bg-white/10 text-white/50' };

  // ---------- V7 : probabilités de OUI (mêmes couleurs que l'Excel : rouge 0.05 → blanc 0.50 → vert 0.95)
  const ECHELLE = [0.05, 0.15, 0.30, 0.50, 0.70, 0.85, 0.95];
  const THEMES_V7 = ['École', 'Maison', 'Sport', 'Jeux et écrans', 'Amis et sorties', 'Loisirs créatifs', 'Nature et dehors'];
  const estV7 = () => !!base && base.format === 'v7';
  const pV7 = (q, id) => q.p[id] ?? 0.5;
  const suivantV7 = (p) => ECHELLE[(ECHELLE.findIndex((e) => Math.abs(e - p) < 1e-9) + 1) % ECHELLE.length]; // 0.95 -> 0.05
  const signeV7 = (p) => (p >= 0.7 ? 1 : p <= 0.3 ? -1 : 0); // plutôt oui / plutôt non / sans lien
  const valeurV7 = (p) => p.toFixed(2).slice(1); // 0.85 -> ".85"
  const melange = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
  function fondV7(p) {
    const rgb = p < 0.5 ? melange([248, 105, 107], [255, 255, 255], (p - 0.05) / 0.45) : melange([255, 255, 255], [99, 190, 123], (p - 0.5) / 0.45);
    return `background:rgb(${rgb.join(',')});color:#000`;
  }
  const AIDE_V6 = $('aMatriceAide').innerHTML;
  const AIDE_V7 = `Chaque case = probabilité qu'un·e élève fait·e pour ce métier réponde OUI. Clique pour passer au niveau suivant :
    ${ECHELLE.map((p) => `<span class="px-1.5 rounded" style="${fondV7(p)}">${valeurV7(p)}</span>`).join(' → ')} → .05.
    Les groupes et les questions proches ne sont pas recalculés par l'admin.`;

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
    if (onglet === 'contributions') chargerContributions();
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
    base.questions.forEach((q) => compte[estV7() ? signeV7(pV7(q, ficheSel)) : q.profils[ficheSel] || 0]++);
    const [oui, non, neutre] = estV7() ? ['plutôt Oui (≥ .70)', 'plutôt Non (≤ .30)', 'sans lien'] : ['Oui', 'Non', '?'];
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
        <span class="px-1.5 rounded bg-[#00FF9D] text-black">${compte[1]} ${oui}</span>
        <span class="px-1.5 rounded bg-[#FF2A85]">${compte[-1]} ${non}</span>
        <span class="px-1.5 rounded bg-white/10">${compte[0]} ${neutre}</span> — modifiable dans l'onglet Matrice ou Nœuds.</p>
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
      base.questions.forEach((q) => delete (estV7() ? q.p : q.profils)[ficheSel]);
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
    // répond « ? » (V7 : 0.50) partout tant qu'on ne l'a pas réglé
    base.questions.forEach((q) => (estV7() ? (q.p[id] = 0.5) : (q.profils[id] = 0)));
    ficheSel = id; marquer(); rendreListeFiches(); rendreFiche();
  };

  // ---------- Nœuds de la toile (affirmations) et leur outcome

  function rendreListeNoeuds() {
    const cherche = $('aNoeudsRecherche').value.trim().toLowerCase();
    $('aNbNoeuds').textContent = base.questions.length;
    $('aNoeudsListe').innerHTML = base.questions
      .filter((q) => !cherche || `${q.id} ${q.texte} ${q.theme || ''}`.toLowerCase().includes(cherche))
      .map((q) => {
        const vals = estV7() ? Object.values(q.p).map(signeV7) : Object.values(q.profils);
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
    if (estV7()) return rendreNoeudV7(q, ed);
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

  // V7 : deux formulations de même sens (tirées au hasard en jeu), thème de vie, ouverture ; groupes et proches en lecture seule
  function rendreNoeudV7(q, ed) {
    const ids = idsMetiers();
    const vals = ids.map((id) => signeV7(pV7(q, id)));
    const nb = (v) => vals.filter((x) => x === v).length;
    const themes = [...new Set([...THEMES_V7, ...base.questions.map((x) => x.theme_vie).filter(Boolean)])];
    const zone = (champ, k, label) => `<label><span class="etiquette">${label}</span>
      <textarea data-v7="${champ}" data-k="${k}" rows="2" class="champ text-sm">${esc(q[champ][k])}</textarea></label>`;
    const lecture = [['Groupe', q.groupe], ['Proches', (q.proches || []).join(', ') || 'aucune'],
      ["Centre d'intérêt", q.centre_interet || 'non'], ['Tournure inversée', q.inversee ? 'oui' : 'non']];
    ed.innerHTML = `
      <span class="carte-titre">Nœud ${esc(q.id)}</span>
      <p class="text-xs font-bold text-[#FFE600]">⚠️ Une formulation B doit avoir exactement le même sens que la A : le jeu tire l'une ou l'autre au hasard, avec l'exemple de même lettre.</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        ${zone('formulations', 0, 'Formulation A')}${zone('formulations', 1, 'Formulation B')}
        ${zone('exemples', 0, 'Exemple A (bouton 💡)')}${zone('exemples', 1, 'Exemple B (bouton 💡)')}
        <label><span class="etiquette">Thème de vie</span>
          <select id="aThemeV7" class="champ text-sm">${themes.map((t) => `<option ${t === q.theme_vie ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label class="flex items-center gap-2 text-sm font-bold sm:mt-5"><input id="aOuvertureV7" type="checkbox" ${q.ouverture ? 'checked' : ''}>
          Question d'ouverture (peut être la 1re question)</label>
      </div>
      <p class="text-xs font-bold text-white/70">${lecture.map(([k, v]) => `${k} : <span class="text-white">${esc(v)}</span>`).join(' · ')}
        <br>Lecture seule : l'admin ne recalcule pas les groupes ni les questions proches (chaîne Python de orientech_v7/).</p>

      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="etiquette !mb-0">Outcome : probabilité que chaque métier réponde OUI</span>
          <span class="text-xs font-bold">
            <span class="px-1.5 rounded bg-[#00FF9D] text-black">${nb(1)} ≥ .70</span>
            <span class="px-1.5 rounded bg-[#FF2A85]">${nb(-1)} ≤ .30</span>
            <span class="px-1.5 rounded bg-white/10">${nb(0)} entre les deux</span></span>
        </div>
        ${!nb(1) || !nb(-1) ? `<p class="text-xs font-bold text-[#FFE600]">⚠️ Ce nœud ne départage aucun métier : il faut au moins une case ≥ .70 et une ≤ .30.</p>` : ''}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          ${ids.map((id) => `<button type="button" data-outcome="${esc(id)}" class="flex items-center gap-2 rounded-lg border-[2.5px] border-black px-2 py-1 text-left text-xs font-bold" style="${fondV7(pV7(q, id))}">
              <span class="font-lucky w-8 text-center">${valeurV7(pV7(q, id))}</span><span class="truncate">${esc(base.metiers[id].nom)}</span></button>`).join('')}
        </div>
        <div class="flex flex-wrap gap-2 items-center">
          <button type="button" data-tous="0.95" class="admin-btn bg-[#00FF9D]">Tous 0.95</button>
          <button type="button" data-tous="0.05" class="admin-btn bg-[#FF2A85] !text-white">Tous 0.05</button>
          <button type="button" data-tous="0.5" class="admin-btn bg-white">Tous 0.50</button>
        </div>
      </div>
      <div class="flex justify-end">
        <button type="button" id="aSupprNoeud" class="admin-btn bg-[#FF2A85] !text-white"><span class="material-symbols-outlined text-base">delete</span>Supprimer ce nœud</button>
      </div>`;

    ed.querySelectorAll('[data-v7]').forEach((el) => el.addEventListener('input', () => {
      const champ = el.dataset.v7, k = +el.dataset.k;
      q[champ][k] = el.value;
      if (champ === 'formulations' && k === 0) { q.texte = el.value; rendreListeNoeuds(); } // texte = formulation A (pro, prof, listes)
      if (champ === 'exemples' && k === 0) q.exemple = el.value;
      marquer();
    }));
    $('aThemeV7').onchange = () => { q.theme_vie = q.theme = $('aThemeV7').value; marquer(); };
    $('aOuvertureV7').onchange = () => { q.ouverture = $('aOuvertureV7').checked; marquer(); };
    ed.querySelectorAll('[data-outcome]').forEach((b) => (b.onclick = () => {
      q.p[b.dataset.outcome] = suivantV7(pV7(q, b.dataset.outcome)); marquer(); rendreNoeud(); rendreListeNoeuds();
    }));
    ed.querySelectorAll('[data-tous]').forEach((b) => (b.onclick = () => {
      ids.forEach((id) => (q.p[id] = Number(b.dataset.tous))); marquer(); rendreNoeud(); rendreListeNoeuds();
    }));
    $('aSupprNoeud').onclick = () => {
      if (!confirm(`Supprimer le nœud ${q.id} ?`)) return;
      base.questions.splice(base.questions.indexOf(q), 1);
      noeudSel = null; marquer(); rendreListeNoeuds(); rendreNoeud();
    };
  }

  // V7 : p = 0.50 partout, nouveau groupe à lui seul, aucune question proche, pas d'ouverture
  function nouveauNoeudV7() {
    let n = 1;
    while (noeud('Q' + String(n).padStart(3, '0'))) n++;
    const groupes = new Set(base.questions.map((q) => q.groupe));
    let g = 1;
    while (groupes.has('G' + String(g).padStart(3, '0'))) g++;
    const texte = 'Nouvelle affirmation…';
    return { id: 'Q' + String(n).padStart(3, '0'), formulations: [texte, texte], exemples: ['', ''], type: '',
      theme_vie: THEMES_V7[0], dimension_principale: '', groupe: 'G' + String(g).padStart(3, '0'), proches: [],
      ouverture: false, centre_interet: null, inversee: false,
      p: Object.fromEntries(Object.keys(base.metiers).map((id) => [id, 0.5])),
      texte, exemple: '', theme: THEMES_V7[0] };
  }

  $('aNouveauNoeud').onclick = () => {
    if (estV7()) {
      const q = nouveauNoeudV7();
      base.questions.push(q);
      noeudSel = q.id; marquer(); rendreListeNoeuds(); rendreNoeud();
      return;
    }
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
    $('aMatriceAide').innerHTML = estV7() ? AIDE_V7 : AIDE_V6;
    const cellule = (q, id) => {
      if (!estV7()) { const v = q.profils[id] || 0; return `<button type="button" class="cellule ${COULEUR[v]}" data-q="${esc(q.id)}" data-m="${esc(id)}">${LETTRE[v]}</button>`; }
      const p = pV7(q, id);
      return `<button type="button" class="cellule" style="${fondV7(p)}" title="${esc(base.metiers[id].nom)} : ${p}" data-q="${esc(q.id)}" data-m="${esc(id)}">${valeurV7(p)}</button>`;
    };
    $('aMatrice').innerHTML = `
      <thead><tr>
        <th class="${th} left-0 z-20 text-left px-2 min-w-[18rem] font-lucky uppercase">Nœud</th>
        ${ids.map((id) => `<th class="${th} px-0.5 py-1 align-bottom" title="${esc(base.metiers[id].nom)}">
          <span class="block [writing-mode:vertical-rl] rotate-180 font-bold text-[11px] max-h-40 truncate">${esc(base.metiers[id].code || base.metiers[id].nom)}</span></th>`).join('')}
      </tr></thead>
      <tbody>${base.questions.map((q) => `<tr>
        <td class="sticky left-0 bg-[#2e1047] border border-black/60 px-2 py-1 max-w-[18rem] truncate" title="${esc(q.texte)}">
          <span class="font-lucky text-[#00E5FF] mr-1">${esc(q.id)}</span>${esc(q.texte)}</td>
        ${ids.map((id) => `<td class="p-0">${cellule(q, id)}</td>`).join('')}
      </tr>`).join('')}</tbody>`;
  }
  $('aMatrice').addEventListener('click', (e) => {
    const b = e.target.closest('[data-q][data-m]');
    if (!b) return;
    const q = noeud(b.dataset.q);
    if (estV7()) {
      const p = (q.p[b.dataset.m] = suivantV7(pV7(q, b.dataset.m)));
      b.setAttribute('style', fondV7(p));
      b.title = `${base.metiers[b.dataset.m].nom} : ${p}`;
      b.textContent = valeurV7(p);
      return marquer();
    }
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

  // V7 : la matrice au format de app/data/orientech_v7.json (et de orientech_v7_matrice.json, sans beta_prior ni dimensions)
  function matriceV7() {
    const connus = Object.fromEntries((base.metiersV7 || []).map((m) => [m.id, m]));
    const idFamille = (nom) => (base.familles.find((f) => f.nom === nom) || {}).id || '';
    const ids = [...(base.metiersV7 || []).map((m) => m.id).filter((id) => base.metiers[id]), ...Object.keys(base.metiers).filter((id) => !connus[id])];
    return {
      version: base.version, echelle: ECHELLE, parametres_moteur: base.parametres, familles: base.familles,
      metiers: ids.map((id) => ({ id, nom: base.metiers[id].nom,
        famille_principale: connus[id] ? connus[id].famille_principale : idFamille(base.metiers[id].famille) })),
      questions: base.questions.map((q) => ({
        id: q.id, formulations: q.formulations, exemples: q.exemples, type: q.type, theme_vie: q.theme_vie,
        dimension_principale: q.dimension_principale, groupe: q.groupe, proches: q.proches, ouverture: q.ouverture,
        centre_interet: q.centre_interet, inversee: q.inversee, p: Object.fromEntries(ids.map((id) => [id, pV7(q, id)]))
      }))
    };
  }

  const telechargerJSON = (objet, nom) => {
    const blob = new Blob([JSON.stringify(objet, null, 1)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nom });
    a.click();
    URL.revokeObjectURL(a.href);
    opts.toast('Export téléchargé');
  };

  function exportJSON() {
    if (estV7()) return { exporte: new Date().toISOString(), version: base.version, metiers: base.metiers, matrice: matriceV7() };
    return {
      exporte: new Date().toISOString(),
      metiers: base.metiers,
      questions: base.questions.map((q) => ({ ...q, profils: Object.fromEntries(Object.entries(q.profils).map(([m, v]) => [m, LETTRE[v]])) }))
    };
  }

  $('aExporter').onclick = () => telechargerJSON(exportJSON(), 'orientech_admin.json');
  // à recopier dans orientech_v7/ pour relancer la simulation (moteur_reference.py) sur les modifications
  $('aExporterV7').onclick = () => telechargerJSON(matriceV7(), 'orientech_v7_matrice_admin.json');

  // ---------- Serveur (mot de passe demandé une fois, gardé le temps de l'onglet du navigateur)

  const CLE_MDP = 'orientech-admin-mdp';
  const lireMdp = () => { try { return sessionStorage.getItem(CLE_MDP); } catch (e) { return null; } };
  const garderMdp = (m) => { try { m ? sessionStorage.setItem(CLE_MDP, m) : sessionStorage.removeItem(CLE_MDP); } catch (e) { /* stockage refusé */ } };

  function demanderMdp() {
    const dlg = $('aMdpDialog');
    $('aMdpInput').value = '';
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? $('aMdpInput').value : null), { once: true });
      dlg.showModal();
    });
  }

  async function appelAdmin(methode, url, corps) {
    const mdp = lireMdp() || (await demanderMdp());
    if (!mdp) throw new Error('Mot de passe requis');
    const r = await fetch(url, {
      method: methode,
      headers: { 'X-Admin': mdp, ...(corps ? { 'Content-Type': 'application/json' } : {}) },
      body: corps ? JSON.stringify(corps) : undefined
    });
    const donnees = await r.json().catch(() => ({}));
    if (r.status === 403) garderMdp(null); // mauvais mot de passe : on le redemandera
    if (!r.ok) throw new Error(donnees.erreur || `Erreur ${r.status}`);
    garderMdp(mdp);
    return donnees;
  }
  const messageErreur = (err) => (err.message === 'Failed to fetch' ? 'Serveur injoignable' : err.message);

  $('aEnregistrer').onclick = async () => {
    const { exporte, ...donnees } = exportJSON();
    try {
      const r = await appelAdmin('POST', '/api/admin/donnees', donnees);
      original = clone({ metiers: base.metiers, questions: base.questions });
      remettreEtat();
      opts.toast(`Enregistré : ${r.metiers} métiers, ${r.questions} questions, visibles par tous`);
    } catch (err) {
      console.warn('[ORIENTech] enregistrement admin impossible', err);
      opts.toast(`Non enregistré : ${messageErreur(err)}`);
    }
  };

  $('aReinitialiser').onclick = async () => {
    const source = estV7() ? 'la matrice V7 (data/orientech_v7.json)' : 'le fichier Excel (data/orientech.xlsx)';
    if (!confirm(`Supprimer les données enregistrées ? Le jeu relira ${source} pour tout le monde.`)) return;
    try {
      await appelAdmin('POST', '/api/admin/donnees/reinitialiser');
      modifie = false; // rechargement voulu : pas d'alerte « modifications non enregistrées »
      location.reload();
    } catch (err) {
      opts.toast(`Impossible : ${messageErreur(err)}`);
    }
  };

  // ---------- Propositions des pros

  let contributions = [];
  const STATUTS = { attente: ['En attente', 'bg-[#FFE600] text-black'], acceptee: ['Ajoutée', 'bg-[#00FF9D] text-black'], rejetee: ['Rejetée', 'bg-white/10 text-white/60'] };

  async function chargerContributions() {
    $('aContributions').innerHTML = '<p class="text-sm font-bold text-white/60">Chargement…</p>';
    try {
      contributions = (await appelAdmin('GET', '/api/admin/contributions')).contributions;
      rendreContributions();
    } catch (err) {
      $('aContributions').innerHTML = `<p class="text-sm font-bold text-[#FFE600]">Impossible de lire les propositions : ${esc(messageErreur(err))}</p>`;
    }
  }
  $('aRechargerContrib').onclick = chargerContributions;

  function rendreContributions() {
    if (!contributions.length) {
      $('aContributions').innerHTML = '<p class="text-sm font-bold text-white/60">Aucune proposition pour l\'instant.</p>';
      return;
    }
    $('aContributions').innerHTML = contributions.map((c) => {
      const [libelle, couleur] = STATUTS[c.statut] || STATUTS.attente;
      const qui = [c.contributeur.prenom, c.contributeur.entreprise].filter(Boolean).join(' · ') || 'anonyme';
      return `<div class="flex flex-wrap items-center gap-3 bg-[#321250] border-[2.5px] border-black rounded-xl p-3 ${c.statut === 'rejetee' ? 'opacity-60' : ''}">
        <div class="flex-1 min-w-[12rem]">
          <p class="font-lucky uppercase text-[#FFE600]">${esc(c.metier.nom)}</p>
          <p class="text-xs font-bold text-white/70">${esc(c.metier.famille || 'Sans famille')} · ${Object.keys(c.reponses).length} réponses · ${esc(qui)} · ${new Date(c.date * 1000).toLocaleDateString('fr-FR')}</p>
        </div>
        <span class="text-[10px] font-lucky uppercase px-2 py-0.5 rounded border-2 border-black ${couleur}">${libelle}</span>
        <button type="button" data-voir="${esc(c.id)}" class="admin-btn bg-[#00E5FF]"><span class="material-symbols-outlined text-base">visibility</span>Fiche</button>
        ${c.statut !== 'acceptee' ? `<button type="button" data-ajouter="${esc(c.id)}" class="admin-btn bg-[#00FF9D]"><span class="material-symbols-outlined text-base">add</span>Ajouter au jeu</button>` : ''}
        ${c.statut === 'attente' ? `<button type="button" data-rejeter="${esc(c.id)}" class="admin-btn bg-[#FF2A85] !text-white">Rejeter</button>` : ''}
      </div>`;
    }).join('');
    const parId = (id) => contributions.find((c) => c.id === id);
    $('aContributions').querySelectorAll('[data-voir]').forEach((b) => (b.onclick = () => opts.voirFiche(parId(b.dataset.voir).metier)));
    $('aContributions').querySelectorAll('[data-ajouter]').forEach((b) => (b.onclick = () => ajouterAuJeu(parId(b.dataset.ajouter))));
    $('aContributions').querySelectorAll('[data-rejeter]').forEach((b) => (b.onclick = () => changerStatut(parId(b.dataset.rejeter), 'rejetee')));
  }

  async function changerStatut(c, statut) {
    try {
      await appelAdmin('POST', `/api/admin/contributions/${encodeURIComponent(c.id)}`, { statut });
      c.statut = statut;
      rendreContributions();
    } catch (err) {
      opts.toast(`Impossible : ${messageErreur(err)}`);
    }
  }

  // Le métier proposé devient une colonne de la matrice : O → 1, N → -1, questions non choisies → ? (0)
  // V7 : O → 0.85, N → 0.15, questions non choisies → 0.50
  async function ajouterAuJeu(c) {
    const id = ('P' + c.id).slice(0, 12);
    if (base.metiers[id]) return opts.toast('Ce métier est déjà dans le jeu');
    base.metiers[id] = clone(c.metier);
    base.questions.forEach((q) => {
      const r = c.reponses[q.id];
      if (estV7()) q.p[id] = r === 'O' ? 0.85 : r === 'N' ? 0.15 : 0.5;
      else q.profils[id] = r === 'O' ? 1 : r === 'N' ? -1 : 0;
    });
    marquer();
    await changerStatut(c, 'acceptee');
    opts.toast(`« ${c.metier.nom} » ajouté : clique sur Enregistrer pour le publier`);
  }

  // options : { toast, voirFiche(metier), onglet? }
  function ouvrir(b, options) {
    base = b;
    opts = options;
    if (!original) original = clone({ metiers: b.metiers, questions: b.questions });
    if (!base.metiers[ficheSel]) ficheSel = idsMetiers()[0] || null;
    if (!noeud(noeudSel)) noeudSel = base.questions[0] ? base.questions[0].id : null;
    $('aExporterV7').classList.toggle('hidden', !estV7());
    $('aReinitialiser').lastChild.textContent = estV7() ? 'Revenir au JSON V7' : "Revenir à l'Excel";
    changerOnglet(['fiches', 'noeuds', 'matrice', 'contributions'].includes(options.onglet) ? options.onglet : onglet);
  }

  racine.Admin = { ouvrir };
})(this);
