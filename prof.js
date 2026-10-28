// ORIENTech — espace prof : suivi de classe en direct.
// Le prof crée une session sur le serveur (serveur.py), puis relit l'état de la classe toutes les 1,5 s.
(function (racine) {
  const COULEURS = ['#FF2A85', '#00E5FF', '#FFE600', '#FF8800', '#00FF9D', '#C9349B', '#FFAEDB', '#FF9B55'];
  const BARRES = ['#FFE600', '#FF2A85', '#00E5FF', '#FF8800', '#00FF9D'];
  const INTERVALLE = 1500;

  const $ = (id) => document.getElementById(id);
  // Les prénoms et réponses viennent des élèves : on les échappe avant de les mettre dans le HTML
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const couleurDe = (id) => COULEURS[[...id].reduce((h, c) => h + c.charCodeAt(0), 0) % COULEURS.length];

  let base = null, toast = () => {};
  let session = null;   // { code, token }
  let etat = null;      // dernière réponse du serveur : { phase, eleves: [...] }
  let minuteur = null, ouvert = null, generation = 0;
  const cartes = {};    // id élève -> élément de la grille

  async function api(methode, url, corps) {
    const r = await fetch(url, {
      method: methode,
      headers: corps ? { 'Content-Type': 'application/json' } : {},
      body: corps ? JSON.stringify(corps) : undefined
    });
    const donnees = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(donnees.erreur || `Erreur ${r.status}`);
    return donnees;
  }

  const nomMetier = (id) => (base.metiers[id] ? base.metiers[id].nom : '?');

  // ---------- Rendu

  function contenuCarte(e) {
    const tete = `<div class="flex items-center gap-2 min-w-0">
        <span class="w-8 h-8 shrink-0 rounded-full border-2 border-black flex items-center justify-center font-lucky text-black" style="background:${couleurDe(e.id)}">${esc(e.prenom[0])}</span>
        <span class="font-lucky text-sm truncate">${esc(e.prenom)}</span></div>`;
    const n = e.nbQuestions;
    if (e.statut === 'attente') return tete + `<p class="font-space font-bold text-xs text-white/60">⏳ En attente</p>`;
    if (e.statut === 'arrete') return tete + `<p class="font-space font-bold text-xs text-white/60">■ Arrêté après ${n} réponse${n > 1 ? 's' : ''}</p>`;
    if (e.statut === 'jeu') {
      const conf = Math.round(e.confiance * 100);
      return tete + `<p class="font-space font-bold text-xs text-[#00E5FF]">▶ Question ${n + 1}</p>
        <div class="h-2.5 bg-black/50 border-2 border-black rounded-full overflow-hidden" title="Confiance du jeu : ${conf} %">
          <div class="h-full bg-[#FFE600] transition-all duration-500" style="width:${conf}%"></div></div>`;
    }
    return tete + `<p class="font-lucky text-xs">★ Fini en ${n} questions</p>
      <p class="font-extrabold text-xs leading-tight line-clamp-2">${esc(nomMetier(e.metier))}</p>
      <span class="self-start text-[10px] font-lucky bg-[#FF2A85] text-white border-2 border-black rounded px-1.5">${e.affinite}% d'affinité</span>`;
  }

  const STYLES = {
    attente: 'bg-[#2e1047] text-white border-dashed',
    jeu: 'bg-[#321250] text-white',
    fini: 'bg-[#FFE600] text-black shadow-[4px_4px_0_#FF2A85]',
    arrete: 'bg-[#2e1047] text-white opacity-60'
  };

  // L'état est relu toutes les 1,5 s : on ne touche au DOM que si le contenu a vraiment changé
  function remplacer(el, html) {
    if (el._html === html) return;
    el._html = html;
    el.innerHTML = html;
  }

  function rendreCarte(e, i) {
    let el = cartes[e.id];
    if (!el) {
      el = cartes[e.id] = document.createElement('button');
      el.type = 'button';
      el.onclick = () => ouvrirFiche(e.id);
      $('pGrille').appendChild(el);
    }
    const rot = ['-rotate-1', 'rotate-1', 'rotate-0'][i % 3];
    const classes = `relative min-h-[110px] rounded-xl border-[3px] border-black p-3 text-left flex flex-col gap-1.5 transition hover:-translate-y-1 shadow-[4px_4px_0_#000] ${rot} ${STYLES[e.statut] || STYLES.attente}`;
    if (el.className !== classes) el.className = classes;
    remplacer(el, contenuCarte(e));
  }

  function rendreTop(eleves) {
    const compte = {};
    eleves.filter((e) => e.statut === 'fini').forEach((e) => (compte[e.metier] = (compte[e.metier] || 0) + 1));
    const top = Object.entries(compte).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const max = top.length ? top[0][1] : 1;
    remplacer($('pTopListe'), top.length
      ? top.map(([m, n], i) => `
        <div class="flex items-center gap-3">
          <span class="w-40 sm:w-64 shrink-0 text-xs sm:text-sm font-extrabold truncate" title="${esc(nomMetier(m))}">${esc(nomMetier(m))}</span>
          <div class="flex-1 h-6 bg-black/40 border-2 border-black rounded-lg overflow-hidden">
            <div class="h-full border-r-2 border-black transition-all duration-500" style="width:${(100 * n) / max}%;background:${BARRES[i % BARRES.length]}"></div>
          </div>
          <span class="w-8 font-lucky text-lg text-right">${n}</span>
        </div>`).join('')
      : `<p class="text-sm font-bold text-white/60">Les premiers résultats arrivent dès qu'un élève a fini…</p>`);
  }

  function rendre() {
    if (!etat) return;
    const { phase, eleves } = etat;
    const nb = (s) => eleves.filter((e) => e.statut === s).length;
    $('pNbConnectes').textContent = eleves.length;
    $('pNbJeu').textContent = nb('jeu');
    $('pNbFinis').textContent = nb('fini');
    const pct = eleves.length ? Math.round((100 * nb('fini')) / eleves.length) : 0;
    $('pProgressionBar').style.width = pct + '%';
    $('pProgressionTxt').textContent = pct + ' %';

    $('pAttente').classList.toggle('hidden', phase !== 'attente');
    $('pProgression').classList.toggle('hidden', phase === 'attente');
    $('pTop').classList.toggle('hidden', phase === 'attente');
    $('pLancer').classList.toggle('hidden', phase !== 'attente');
    $('pTerminer').classList.toggle('hidden', phase !== 'direct');
    $('pTermine').classList.toggle('hidden', phase !== 'termine');
    $('pTermine').classList.toggle('flex', phase === 'termine');

    eleves.forEach(rendreCarte);
    rendreTop(eleves);
    if (ouvert) rendreFiche();
  }

  // ---------- Fiche élève

  function rendreFiche() {
    const e = etat && etat.eleves.find((x) => x.id === ouvert);
    if (!e) return;
    const n = e.nbQuestions;
    const statut = { attente: '⏳ En attente', jeu: `▶ En jeu — question ${n + 1}`, fini: '★ Terminé', arrete: '■ Arrêté' }[e.statut];
    let html = `
      <div class="flex items-center gap-3 mb-4">
        <span class="w-14 h-14 rounded-full border-[3px] border-black flex items-center justify-center font-lucky text-2xl text-black shadow-[3px_3px_0_#000]" style="background:${couleurDe(e.id)}">${esc(e.prenom[0])}</span>
        <div><p class="font-lucky text-2xl uppercase">${esc(e.prenom)}</p><p class="font-space font-bold text-xs text-[#00E5FF]">${statut} · ${n} réponse${n > 1 ? 's' : ''}</p></div>
      </div>`;
    if (e.statut === 'fini') {
      html += `<div class="bg-[#FFE600] text-black border-[3px] border-black rounded-xl p-3 mb-4 shadow-[3px_3px_0_#FF2A85] -rotate-1">
        <p class="font-space font-bold text-[10px] uppercase">Métier trouvé · ${e.affinite}% d'affinité</p>
        <p class="font-lucky text-xl uppercase leading-tight">${esc(nomMetier(e.metier))}</p></div>`;
    }
    if (n) {
      html += `<p class="font-lucky text-sm uppercase mb-2">Métiers en tête</p><div class="flex flex-col gap-1.5 mb-4">` +
        e.top3.map((c, i) => `
          <div class="flex items-center gap-2 text-xs font-bold">
            <span class="w-36 truncate">${esc(nomMetier(c.id))}</span>
            <div class="flex-1 h-3 bg-black/50 border-2 border-black rounded-full overflow-hidden"><div class="h-full" style="width:${Math.round(c.p * 100)}%;background:${BARRES[i]}"></div></div>
            <span class="w-9 text-right">${Math.round(c.p * 100)}%</span>
          </div>`).join('') + `</div>
        <p class="font-lucky text-sm uppercase mb-2">Dernières réponses</p><div class="flex flex-col gap-1.5">` +
        e.derniers.map((d) => `
          <div class="flex items-start gap-2 text-xs">
            <span class="shrink-0 font-lucky px-1.5 border-2 border-black rounded text-black ${d.oui ? 'bg-[#FF8A00]' : 'bg-[#00E5FF]'}">${d.oui ? 'OUI' : 'NON'}</span>
            <span class="text-white/80 line-clamp-2">${esc(d.texte)}</span>
          </div>`).join('') + `</div>`;
    } else {
      html += `<p class="text-sm font-bold text-white/60">Pas encore de réponse.</p>`;
    }
    remplacer($('pModalContenu'), html);
  }

  function ouvrirFiche(id) {
    ouvert = id;
    rendreFiche();
    $('pModal').classList.replace('hidden', 'flex');
  }
  function fermerFiche() {
    ouvert = null;
    $('pModal').classList.replace('flex', 'hidden');
  }

  // ---------- Échanges avec le serveur

  let echecs = 0; // échecs de rafraîchissement d'affilée
  async function rafraichir() {
    if (!session) return;
    const g = generation;
    try {
      const donnees = await api('GET', `/api/sessions/${session.code}?token=${encodeURIComponent(session.token)}`);
      if (echecs >= 3) toast('Connexion rétablie');
      echecs = 0;
      if (g === generation) { etat = donnees; rendre(); }
    } catch (err) { // coupure passagère : on réessaie au prochain tour, mais on prévient si ça dure
      console.warn('[ORIENTech] suivi de classe : serveur injoignable', err);
      if (++echecs === 3) toast('Connexion perdue… le suivi reprendra tout seul');
    }
  }

  async function action(nom) {
    try {
      await api('POST', `/api/sessions/${session.code}/${nom}`, { token: session.token });
      await rafraichir();
      return true;
    } catch (err) {
      toast(err.message === 'Failed to fetch' ? 'Serveur injoignable, réessaie.' : err.message);
      return false;
    }
  }

  function fermer() {
    generation++;
    clearInterval(minuteur);
    minuteur = null;
    session = null;
    etat = null;
    fermerFiche();
    $('pProjection').classList.replace('flex', 'hidden');
  }

  // La session du prof est gardée dans le navigateur : s'il recharge la page, il retrouve sa classe
  const CLE_SESSION = 'orientech-prof-session';
  const memoriser = (s) => { try { localStorage.setItem(CLE_SESSION, JSON.stringify(s)); } catch (e) { /* stockage refusé */ } };
  const oublierSession = () => { try { localStorage.removeItem(CLE_SESSION); } catch (e) { /* stockage refusé */ } };
  function sessionMemorisee() {
    try { const s = JSON.parse(localStorage.getItem(CLE_SESSION)); return s && s.code && s.token ? s : null; } catch (e) { return null; }
  }

  // Reprend la session en cours si elle existe encore et n'est pas terminée ; sinon en crée une nouvelle
  async function obtenirSession(forcerNouvelle) {
    const ancienne = !forcerNouvelle && sessionMemorisee();
    if (ancienne) {
      try {
        const e = await api('GET', `/api/sessions/${ancienne.code}?token=${encodeURIComponent(ancienne.token)}`);
        if (e.phase !== 'termine') return { session: ancienne, reprise: true };
      } catch (err) { /* expirée ou supprimée : on en crée une autre */ }
    }
    const s = await api('POST', '/api/sessions');
    memoriser(s);
    return { session: s, reprise: false };
  }

  async function ouvrir(b, options = {}) {
    fermer();
    const g = generation;
    base = b;
    toast = options.toast || toast;
    Object.keys(cartes).forEach((k) => delete cartes[k]);
    $('pGrille').innerHTML = '';
    $('pCode').textContent = '······';
    let reprise = false;
    try {
      const r = await obtenirSession(options.nouvelle);
      if (g !== generation) return; // le prof est déjà reparti
      session = r.session;
      reprise = r.reprise;
    } catch (err) {
      return toast(`Impossible de créer la session : ${err.message === 'Failed to fetch' ? 'serveur injoignable' : err.message}`);
    }
    if (reprise) toast(`Session ${session.code} reprise`);
    $('pCode').textContent = session.code;
    $('pProjectionCode').textContent = session.code;
    await rafraichir();
    if (g !== generation) return; // un autre ouvrir()/fermer() est passé pendant ce temps : il gère son propre minuteur
    minuteur = setInterval(rafraichir, INTERVALLE);
  }

  $('pLancer').onclick = () => {
    if (!etat || !etat.eleves.length) return toast('Attends que des élèves arrivent !');
    action('lancer');
  };
  $('pTerminer').onclick = async () => {
    if (!confirm('Terminer la session ? Les élèves encore en jeu seront arrêtés.')) return;
    // on n'oublie la session que si le serveur l'a vraiment terminée (sinon le prof pourrait la perdre en direct)
    if (await action('terminer')) oublierSession();
  };
  $('pNouvelle').onclick = () => ouvrir(base, { toast, nouvelle: true });
  $('pCopier').onclick = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.code);
      toast(`Code ${session.code} copié !`);
    } catch (err) { // presse-papier refusé (http, permissions…) : on ne prétend pas que c'est copié
      console.warn('[ORIENTech] copie du code impossible', err);
      toast(`Copie impossible : note le code ${session.code}`);
    }
  };
  $('pProjeter').onclick = () => session && $('pProjection').classList.replace('hidden', 'flex');
  $('pProjection').onclick = () => $('pProjection').classList.replace('flex', 'hidden');
  $('pModalFermer').onclick = fermerFiche;
  $('pModal').onclick = (ev) => { if (ev.target === $('pModal')) fermerFiche(); };

  racine.Prof = { ouvrir, fermer };
})(this);
