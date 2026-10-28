// ORIENTech — espace professionnel·le : le·la pro remplit sa fiche métier puis répond (OUI / NON)
// à au moins 8 affirmations qu'il choisit dans la banque. Ses réponses forment une nouvelle colonne de la matrice.
// FRONT-END SEULEMENT : envoyerContribution() est à brancher sur serveur.py.
(function (racine) {
  const MIN = 8;
  const CLE_BROUILLON = 'orientech-pro-brouillon';
  const MAX_CHIPS = { bacs: 6, competences: 5 };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let opts = {};
  let banque = [];      // [{ id, texte, exemple, theme? }]
  let etat = { champs: {}, bacs: [], competences: [], reponses: {} };
  let filtre = 'toutes'; // 'toutes' | 'repondues' | nom d'un thème
  let dernierEnvoi = null;
  const lignes = {};    // id question -> élément de la liste

  // ---------- Brouillon (le navigateur peut refuser le stockage : on ignore alors)

  function sauver() {
    try { localStorage.setItem(CLE_BROUILLON, JSON.stringify(etat)); } catch (e) { /* pas grave */ }
  }
  function charger() {
    try {
      const b = JSON.parse(localStorage.getItem(CLE_BROUILLON));
      if (b && b.champs) etat = { champs: b.champs, bacs: b.bacs || [], competences: b.competences || [], reponses: b.reponses || {} };
    } catch (e) { /* brouillon illisible : on repart de zéro */ }
  }
  function oublier() {
    try { localStorage.removeItem(CLE_BROUILLON); } catch (e) { /* pas grave */ }
  }

  // ---------- Étape 1 : fiche métier

  function rendreChips(nom) {
    $('proChips-' + nom).innerHTML = etat[nom].map((v, i) =>
      `<span class="chip">${esc(v)}<button type="button" data-suppr="${i}" aria-label="Retirer ${esc(v)}">×</button></span>`).join('');
    $('proChipInput-' + nom).classList.toggle('hidden', etat[nom].length >= MAX_CHIPS[nom]);
  }

  function brancherChips(nom) {
    const champ = $('proChipInput-' + nom);
    const ajouter = () => {
      const v = champ.value.trim().replace(/[;,]+$/, '');
      champ.value = '';
      if (!v || etat[nom].length >= MAX_CHIPS[nom] || etat[nom].some((x) => x.toLowerCase() === v.toLowerCase())) return;
      etat[nom].push(v);
      rendreChips(nom);
      sauver();
    };
    champ.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',' || e.key === ';') { e.preventDefault(); ajouter(); }
      if (e.key === 'Backspace' && !champ.value && etat[nom].length) { etat[nom].pop(); rendreChips(nom); sauver(); }
    });
    champ.addEventListener('blur', ajouter);
    $('proChips-' + nom).addEventListener('click', (e) => {
      const i = e.target.dataset.suppr;
      if (i === undefined) return;
      etat[nom].splice(+i, 1);
      rendreChips(nom);
      sauver();
    });
  }

  function remplirFormulaire() {
    for (const el of $('proForm').elements) {
      if (el.name) el.value = etat.champs[el.name] || '';
    }
    rendreChips('bacs');
    rendreChips('competences');
  }

  // Menu déroulant des familles : celles déjà présentes dans les fiches métiers du jeu
  function remplirFamilles(base) {
    const familles = [...new Set(Object.values(base.metiers).map((m) => m.famille).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    $('proFamille').innerHTML = `<option value="">— Choisis la famille de ton métier —</option>` +
      familles.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  }

  $('proForm').addEventListener('input', (e) => {
    if (!e.target.name) return;
    etat.champs[e.target.name] = e.target.value;
    $('proErreur').classList.add('hidden');
    sauver();
  });

  $('proForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const manque = !(etat.champs.nom || '').trim() ? 'nom' : !etat.champs.famille ? 'famille' : null;
    if (manque) {
      $('proErreur').textContent = manque === 'nom' ? 'Indique au moins le nom de ton métier.' : 'Choisis la famille de ton métier dans la liste.';
      $('proErreur').classList.remove('hidden');
      const f = $('proForm');
      f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
      return $('proForm').elements[manque].focus();
    }
    opts.show('proQuestions');
  });

  // ---------- Étape 2 : liste d'affirmations avec interrupteurs OUI | NON

  function construireListe() {
    $('proListe').innerHTML = '';
    Object.keys(lignes).forEach((k) => delete lignes[k]);
    for (const q of banque) {
      const ligne = document.createElement('div');
      ligne.innerHTML = `
        <div class="flex-1 min-w-0">
          <p class="font-bold text-sm leading-snug">${esc(q.texte)}</p>
          ${q.exemple ? `<p data-exemple class="hidden mt-1 text-xs italic font-semibold text-[#FFAEDB]">Ex : ${esc(q.exemple)}</p>` : ''}
        </div>
        ${q.exemple ? `<button type="button" data-voir-exemple class="shrink-0 w-8 h-8 rounded-lg bg-[#00E5FF] text-black border-2 border-black shadow-[2px_2px_0_#000] flex items-center justify-center" aria-label="Voir un exemple"><span class="material-symbols-outlined text-lg">lightbulb</span></button>` : ''}
        <div class="bascule" role="group" aria-label="Ta réponse">
          <button type="button" data-r="O">Oui</button><button type="button" data-r="N">Non</button>
        </div>`;
      ligne.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => repondre(q.id, b.dataset.r)));
      const voir = ligne.querySelector('[data-voir-exemple]');
      if (voir) {
        const ex = ligne.querySelector('[data-exemple]');
        // même comportement que le jeu : survol à la souris, tap sur téléphone
        if (matchMedia('(hover: hover)').matches) {
          voir.onmouseenter = () => ex.classList.remove('hidden');
          voir.onmouseleave = () => ex.classList.add('hidden');
        } else {
          voir.onclick = () => ex.classList.toggle('hidden');
        }
      }
      lignes[q.id] = ligne;
      majLigne(q.id);
      $('proListe').appendChild(ligne);
    }
    rendreFiltres();
    filtrer();
    majCompteur();
  }

  function majLigne(id) {
    const r = etat.reponses[id];
    const ligne = lignes[id];
    ligne.className = 'flex items-center gap-3 rounded-xl border-[3px] border-black p-3 transition ' +
      (r ? 'bg-[#3a1660] shadow-[4px_4px_0_#FF2A85]' : 'bg-[#2e1047] shadow-[3px_3px_0_#000]');
    ligne.querySelectorAll('[data-r]').forEach((b) => {
      if (b.dataset.r === r) b.dataset.actif = r; else delete b.dataset.actif;
      b.setAttribute('aria-pressed', b.dataset.r === r);
    });
  }

  function repondre(id, r) {
    if (etat.reponses[id] === r) delete etat.reponses[id]; // recliquer = désélectionner
    else etat.reponses[id] = r;
    majLigne(id);
    majCompteur();
    sauver();
    if (filtre === 'repondues') filtrer();
  }

  function majCompteur() {
    const n = Object.keys(etat.reponses).length;
    const ok = n >= MIN;
    $('proCompteur').textContent = ok ? `★ ${n} réponses` : `${n} / ${MIN} minimum`;
    $('proCompteur').className = 'font-lucky text-sm sm:text-base uppercase border-[3px] border-black rounded-xl px-3 py-1.5 comic-shadow-sm -rotate-1 ' +
      (ok ? 'bg-[#00FF9D] text-black' : 'bg-white text-black');
    $('proEnvoyer').disabled = !ok;
  }

  function rendreFiltres() {
    const themes = [...new Set(banque.map((q) => q.theme).filter(Boolean))];
    const choix = [['toutes', 'Toutes'], ['repondues', 'Mes réponses'], ...themes.map((t) => [t, t])];
    $('proFiltres').innerHTML = choix.map(([v, label]) =>
      `<button type="button" data-filtre="${esc(v)}" class="px-3 py-1 rounded-xl border-[2.5px] border-black font-lucky text-xs uppercase shadow-[2px_2px_0_#000] ${v === filtre ? 'bg-[#FFE600] text-black' : 'bg-[#2e1047] text-white'}">${esc(label)}</button>`).join('');
    $('proFiltres').querySelectorAll('[data-filtre]').forEach((b) => (b.onclick = () => {
      filtre = b.dataset.filtre;
      rendreFiltres();
      filtrer();
    }));
  }

  function filtrer() {
    const cherche = $('proRecherche').value.trim().toLowerCase();
    let visibles = 0;
    for (const q of banque) {
      const ok = (!cherche || q.texte.toLowerCase().includes(cherche) || (q.exemple || '').toLowerCase().includes(cherche)) &&
        (filtre === 'toutes' || (filtre === 'repondues' ? !!etat.reponses[q.id] : q.theme === filtre));
      lignes[q.id].classList.toggle('hidden', !ok);
      if (ok) visibles++;
    }
    $('proVide').classList.toggle('hidden', visibles > 0);
  }
  $('proRecherche').addEventListener('input', filtrer);

  // ---------- Envoi

  function construireEnvoi() {
    const c = etat.champs;
    const t = (k) => (c[k] || '').trim();
    const trajectoire = [1, 2, 3].map((i) => ({ etape: t('etape' + i), detail: t('detail' + i) })).filter((e) => e.etape);
    trajectoire.push({ etape: t('etape_cible') || 'Lieu de travail', detail: t('detail_cible') || t('nom'), cible: true });
    return {
      metier: {
        nom: t('nom'), famille: t('famille'), salaire: t('salaire'), salaire_note: t('salaire_note'),
        dynamique: t('dynamique'), dynamique_note: t('dynamique_note'), cursus: t('cursus'),
        bacs: [...etat.bacs], trajectoire, competences: [...etat.competences]
      },
      contributeur: { prenom: t('prenom'), entreprise: t('entreprise') },
      reponses: { ...etat.reponses } // une colonne de la matrice : O / N (les questions non choisies = ?)
    };
  }

  // TODO backend : POST vers serveur.py (ex. /api/contributions) puis ajout de la colonne dans la matrice
  async function envoyerContribution(contribution) {
    console.info('[ORIENTech] contribution professionnelle (non envoyée : backend à brancher)', contribution);
    return { ok: true };
  }

  $('proEnvoyer').onclick = async () => {
    const n = Object.keys(etat.reponses).length;
    if (n < MIN) return opts.toast(`Encore ${MIN - n} réponse${MIN - n > 1 ? 's' : ''} !`);
    const contribution = construireEnvoi();
    $('proEnvoyer').disabled = true;
    try {
      await envoyerContribution(contribution);
    } catch (err) {
      $('proEnvoyer').disabled = false;
      return opts.toast("L'envoi a échoué, réessaie.");
    }
    dernierEnvoi = contribution;
    $('proMerciTxt').textContent = `« ${contribution.metier.nom} » · ${n} réponses ajoutées à la matrice`;
    etat = { champs: {}, bacs: [], competences: [], reponses: {} };
    oublier();
    opts.show('proMerci');
  };
  $('proVoirFiche').onclick = () => dernierEnvoi && opts.voirFiche(dernierEnvoi.metier);
  $('proAccueil').onclick = () => opts.show('accueil');

  brancherChips('bacs');
  brancherChips('competences');

  // options : { show, toast, voirFiche }
  function ouvrir(base, options) {
    opts = options;
    banque = base.questions;
    remplirFamilles(base);
    charger();
    remplirFormulaire();
    $('proRecherche').value = '';
    filtre = 'toutes';
    construireListe();
  }

  racine.Pro = { ouvrir };
})(this);
