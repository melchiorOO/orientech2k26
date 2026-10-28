// ORIENTech — interface du jeu. La logique de choix est dans moteur.js, les données dans data/orientech.xlsx.
(async function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Sans les données, aucun bouton ne marche : on le dit clairement au lieu d'échouer en silence
  function erreurChargement(err) {
    console.error('[ORIENTech] Impossible de charger les données du jeu', err);
    const alerte = document.createElement('div');
    alerte.setAttribute('role', 'alert');
    alerte.className = 'fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md bg-[#FF2A85] text-white border-[3px] border-black rounded-xl shadow-[4px_4px_0_#000] p-4 flex flex-col items-center gap-2 text-center font-bold';
    alerte.innerHTML = '<p>Oups, impossible de charger les questions du jeu. Vérifie ta connexion.</p><button type="button" class="admin-btn bg-white">Réessayer</button>';
    alerte.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(alerte);
  }

  // Données du jeu : celles enregistrées par l'admin (serveur) si elles existent, sinon le fichier Excel
  const VALEUR = { O: 1, N: -1 };
  async function donneesAdmin() {
    try {
      const r = await fetch('/api/donnees', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null;
      const { donnees } = await r.json();
      if (!donnees) return null;
      return { metiers: donnees.metiers, questions: donnees.questions.map((q) => ({
        ...q, profils: Object.fromEntries(Object.entries(q.profils).map(([m, v]) => [m, VALEUR[v] || 0])) })) };
    } catch (err) { // pas de serveur (site statique, hors ligne…) : on prend l'Excel
      console.warn('[ORIENTech] données enregistrées indisponibles, lecture du fichier Excel', err);
      return null;
    }
  }

  let base;
  try {
    base = await donneesAdmin();
    if (!base) {
      const reponse = await fetch('data/orientech.xlsx', { cache: 'no-store' });
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`);
      base = Moteur.lireClasseur(XLSX, XLSX.read(await reponse.arrayBuffer()));
    }
    if (!base.questions.length || !Object.keys(base.metiers).length) throw new Error('aucune question ou aucun métier dans le fichier');
  } catch (err) {
    return erreurChargement(err);
  }

  let partie = null;
  let current = null; // question affichée
  let ecran = 'accueil';
  const contexte = { profil: null, mode: null, prenom: null, code: null, eleve: null }; // choix faits avant la partie
  let journal = [];      // réponses de la partie en cours (pour le suivi prof)
  let attenteProf = null; // minuteur de la salle d'attente élève
  let jetonSalle = 0;     // change à chaque entrée en salle d'attente : une ancienne vérification en cours est ignorée
  let repondable = false; // la question affichée attend encore sa réponse
  let depuisFiches = false; // la fiche résultat a été ouverte depuis le catalogue (et non à la fin d'une partie)
  let retourFiche = 'fiches'; // écran où ramène le bouton du bas d'une fiche consultée (catalogue ou admin)
  // écrans où le bouton en haut à droite devient ✕ (retour accueil) ; ailleurs il ouvre toutes les fiches métiers
  const ECRANS_FERMABLES = ['profil', 'mode', 'code', 'salle', 'question', 'prof', 'proFiche', 'proQuestions', 'proMerci', 'fiches', 'admin'];

  function show(name) {
    ecran = name;
    if (name !== 'salle') { clearTimeout(attenteProf); attenteProf = null; }
    document.querySelectorAll('[data-screen]').forEach((el) => el.classList.toggle('active', el.dataset.screen === name));
    $('progress').classList.toggle('hidden', name !== 'question');
    $('progress').classList.toggle('flex', name === 'question');
    const inGame = ECRANS_FERMABLES.includes(name);
    $('backBtn').classList.toggle('invisible', !inGame);
    if (name !== 'prof') Prof.fermer(); // quitter l'espace prof arrête le suivi de la classe
    document.querySelector('footer').classList.toggle('pb-24', name === 'proQuestions'); // place pour la barre collante
    const large = ['prof', 'fiches', 'admin'].includes(name);
    const header = document.querySelector('header');
    header.classList.toggle('max-w-3xl', !large);
    header.classList.toggle('max-w-6xl', large);
    $('rightBtn').querySelector('span').textContent = inGame ? 'close' : 'auto_stories';
    $('rightBtn').classList.toggle('bg-[#FF2A85]', inGame);
    $('rightBtn').classList.toggle('bg-[#00E5FF]', !inGame);
    window.scrollTo(0, 0);
  }

  // Étoiles = à quel point le jeu est sûr de son métier n°1
  function renderStars(confiance) {
    const filled = Math.min(5, Math.floor(confiance * 5.5));
    $('stars').innerHTML = Array.from({ length: 5 }, (_, i) =>
      `<svg class="w-5 h-5 drop-shadow-[2px_2px_0_#000]" viewBox="0 0 24 24"><polygon fill="${i < filled ? '#FFE600' : '#241336'}" points="12,2 15,9 22,9.5 17,14.5 18.5,22 12,18 5.5,22 7,14.5 2,9.5 9,9" stroke="#000" stroke-linejoin="round" stroke-width="2.5"/></svg>`
    ).join('');
    $('gaugeText').textContent = `${Math.round(confiance * 100)} %`;
  }

  function askQuestion(q) {
    current = q;
    $('questionText').textContent = q.texte;
    // Texte plus petit quand la question est longue, pour tenir dans le nuage
    $('questionText').className = 'font-extrabold text-[#0D041A] leading-snug tracking-tight ' +
      (q.texte.length > 90 ? 'text-sm sm:text-base' : 'text-base sm:text-lg');
    // L'exemple reste caché tant que l'élève ne clique pas sur "Un exemple ?"
    $('questionExemple').textContent = q.exemple ? `Ex : ${q.exemple}` : '';
    $('questionExemple').classList.add('hidden');
    $('exempleBtn').classList.toggle('hidden', !q.exemple);
    $('exempleBtn').classList.toggle('flex', !!q.exemple);
    const box = $('questionBox');
    box.classList.remove('pop-in'); void box.offsetWidth; box.classList.add('pop-in');
    const bonus = partie.bonus();
    $('questionBadge').lastElementChild.textContent = bonus ? `Question bonus ${bonus.faites + 1} / ${bonus.total}` : `Question ${partie.nbPosees() + 1}`;
    renderStars(partie.nbPosees() ? partie.confiance() : 0);
    show('question');
    repondable = true;
  }

  function answer(oui) {
    // une seule réponse par question : un 2e appui (Entrée/Espace au clavier, double clic) est ignoré
    if (!repondable || ecran !== 'question') return;
    repondable = false;
    partie.repondre(current.id, oui);
    journal.push({ texte: current.texte, oui });
    if (partie.estFinie()) {
      signaler(partie.classement()[0].id);
      return revealMetier(partie.classement()[0].id);
    }
    signaler();
    askQuestion(partie.prochaineQuestion());
  }

  // ---------- Session de classe (serveur.py)

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

  // Envoie au prof où en est l'élève (seulement en mode "en cours")
  function signaler(metierFinal) {
    const e = contexte.eleve;
    if (!e || !partie) return;
    e.seq = (e.seq || 0) + 1; // numéro d'envoi : le serveur ignore un envoi plus ancien arrivé en retard
    api('POST', `/api/sessions/${e.code}/eleves/${e.id}/progression`, {
      token: e.token,
      seq: e.seq,
      nbQuestions: partie.nbPosees(),
      confiance: partie.nbPosees() ? partie.confiance() : 0,
      top3: partie.classement().slice(0, 3),
      derniers: journal.slice(-4).reverse(),
      fini: !!metierFinal,
      metier: metierFinal || '',
      affinite: metierFinal ? partie.affinite(metierFinal) : 0
    }).catch((err) => console.warn('[ORIENTech] progression non envoyée au prof', err)); // une coupure ne doit pas bloquer la partie
  }

  // Salle d'attente élève : on attend que le prof clique "Lancer la session"
  function attendreLancement() {
    $('salleMessage').textContent = `C'est noté, ${contexte.prenom} !`;
    show('salle');
    const e = contexte.eleve;
    // une vérification à la fois (la suivante part 2 s après la réponse) et seulement tant que l'élève est dans CETTE salle
    const jeton = ++jetonSalle;
    const encore = () => ecran === 'salle' && jeton === jetonSalle;
    let echecs = 0;
    async function verifier() {
      if (!encore()) return;
      try {
        const { phase } = await api('GET', `/api/sessions/${e.code}/eleves/${e.id}?token=${encodeURIComponent(e.token)}`);
        if (!encore()) return; // l'élève a quitté la salle pendant la requête
        if (echecs >= 3) toast('Connexion rétablie');
        echecs = 0;
        if (phase === 'direct') { toast("C'est parti !"); return start(); }
        if (phase === 'termine') { toast('La session a été terminée par ton prof.'); return goHome(); }
      } catch (err) { // on réessaie au prochain tour, mais on prévient si ça dure
        console.warn('[ORIENTech] salle d\'attente : serveur injoignable', err);
        if (++echecs === 3) toast('Connexion perdue… nouvel essai en cours');
      }
      if (encore()) attenteProf = setTimeout(verifier, 2000);
    }
    attenteProf = setTimeout(verifier, 2000);
  }

  let metierPropose = null;    // métier affiché à la fin de la partie
  let metierAvantBonus = null; // métier refusé par l'élève avant ses 5 questions bonus

  function revealMetier(id) {
    const thinking = $('thinking');
    thinking.classList.replace('hidden', 'flex');
    setTimeout(() => {
      thinking.classList.replace('flex', 'hidden');
      renderMetier(base.metiers[id], partie.affinite(id));
      if (metierAvantBonus) {
        $('rBulle').textContent = metierAvantBonus === id ? "Je maintiens ! Tu as l'esprit d'un..." : "J'ai affiné ! Tu as plutôt l'esprit d'un...";
      }
      metierPropose = id;
      metierAvantBonus = null;
      // on peut redemander tant qu'il reste des questions à poser
      $('affinerBtn').classList.toggle('hidden', partie.questionsRestantes() === 0);
      $('affinerBtn').classList.toggle('flex', partie.questionsRestantes() > 0);
      ouvrirCoffres(id); // reveal en 3 coffres, puis la fiche complète
    }, 1600);
  }

  // Reveal : coffre 1 = métier, coffre 2 = salaire, coffre 3 = études ; la fiche (déjà remplie) s'affiche ensuite
  function ouvrirCoffres(id, tout) {
    show('coffres');
    Coffres.ouvrir(base.metiers[id], { tout, surFin: () => show('resultat') });
  }

  // "Pas convaincu·e ?" : le métier proposé recule (sans être éliminé) et la partie continue 5 questions
  function affiner() {
    if (!partie || !metierPropose) return;
    metierAvantBonus = metierPropose;
    partie.prolonger(metierPropose, 5);
    toast("D'accord, 5 questions de plus pour affiner !");
    signaler();
    askQuestion(partie.prochaineQuestion());
  }

  const chipColors = [
    'bg-[#00f0ff] text-black -rotate-2', 'bg-[#ff2a85] text-white rotate-1', 'bg-[#ffe600] text-black -rotate-1',
    'bg-[#ff8800] text-black rotate-2', 'bg-[#00ff9d] text-black -rotate-2'
  ];
  const chipIcons = ['✦', '★', '◆', '▲', '●'];
  const stepColors = ['bg-[#ff2a85] text-white', 'bg-[#00f0ff] text-black', 'bg-[#ff8800] text-black'];

  // affinite = null : fiche consultée depuis le catalogue (pas de "j'ai trouvé", pas d'affinité)
  function renderMetier(m, affinite) {
    depuisFiches = affinite == null;
    $('rBulle').textContent = depuisFiches ? 'Voici la fiche du métier…' : "J'ai trouvé ! Tu as l'esprit d'un...";
    $('rAffiniteBadge').classList.toggle('hidden', depuisFiches);
    $('affinerBtn').classList.add('hidden'); // réaffiché par revealMetier, seulement à la fin d'une vraie partie
    $('affinerBtn').classList.remove('flex');
    $('rReplayTxt').textContent = !depuisFiches ? 'Rejouer' : retourFiche === 'admin' ? "Retour à l'admin" : 'Toutes les fiches';
    $('rReplayIcone').textContent = depuisFiches ? 'grid_view' : 'replay';
    // Quand le métier a une famille, la famille devient le grand titre et le métier passe dans la carte rose
    const famille = !!m.famille;
    const titre = famille ? m.famille : m.nom;
    $('rNom').textContent = titre;
    $('rBadgeType').textContent = famille ? 'Famille de métiers' : 'Métier cible';
    // Titre plus petit pour les noms longs
    $('rNom').classList.remove('text-5xl', 'sm:text-7xl', 'text-4xl', 'sm:text-6xl', 'text-3xl', 'sm:text-5xl');
    $('rNom').classList.add(...(titre.length > 28 ? ['text-3xl', 'sm:text-5xl'] : titre.length > 16 ? ['text-4xl', 'sm:text-6xl'] : ['text-5xl', 'sm:text-7xl']));

    $('rDescription').textContent = m.description || '';
    $('rDescription').classList.toggle('hidden', !m.description);

    // Cartes sans donnée (ex. salaire non renseigné) masquées, la grille s'adapte.
    // La carte rose montre le métier (si le titre est la famille), sinon la dynamique de recrutement.
    $('cardSalaire').classList.toggle('hidden', !m.salaire);
    $('cardDynamique').classList.toggle('hidden', !famille && !m.dynamique);
    $('rSalaireUnite').textContent = m.salaire_unite || 'Brut mensuel débutant';
    $('rCursusSous').textContent = m.cursus_label || 'Parcours recommandé';
    $('rDynLabel').textContent = famille ? 'Métier' : 'Dynamique';
    $('rDynIcone').textContent = famille ? 'badge' : 'rocket_launch';
    $('rDynSous').textContent = 'Recrutements annuels';
    $('rDynSous').classList.toggle('hidden', famille);
    $('rDynamique').classList.toggle('text-xl', famille);
    $('rDynamique').classList.toggle('sm:text-2xl', famille);
    $('rDynamique').classList.toggle('text-3xl', !famille);
    $('rDynamique').classList.toggle('sm:text-4xl', !famille);
    // pas de petites notes en bas des cartes
    $('rSalaireNote').parentElement.classList.add('hidden');
    $('rDynamiqueNote').parentElement.classList.add('hidden');
    const nbCartes = 1 + !!m.salaire + !!(famille || m.dynamique);
    $('rCartes').classList.remove('sm:grid-cols-1', 'sm:grid-cols-2', 'sm:grid-cols-3', 'max-w-sm');
    $('rCartes').classList.add(`sm:grid-cols-${nbCartes}`);
    if (nbCartes === 1) $('rCartes').classList.add('max-w-sm');
    $('rAffinite').textContent = `★ ${affinite}% d'affinité`;
    $('rSalaire').textContent = m.salaire;
    $('rDynamique').textContent = famille ? m.nom : m.dynamique;
    $('rCursus').textContent = m.cursus;
    $('rBacs').textContent = m.bacs.join(' • ');
    $('rNbEtapes').textContent = `${m.trajectoire.length} étapes clés`;

    $('rTrajectoire').innerHTML = m.trajectoire.map((t, i) => t.cible
      ? `<div class="bg-[#ffe600] border-[3px] border-black rounded-xl p-2.5 flex flex-col items-start gap-1 shadow-[4px_4px_0_#ff2a85] rotate-2">
           <span class="text-[10px] font-lucky px-2 py-0.5 rounded bg-black text-[#ffe600]">★ CIBLE</span>
           <p class="font-lucky text-sm text-black">${esc(t.etape)}</p>
           <p class="text-[11px] font-extrabold text-[#c0005a]">${esc(t.detail)}</p></div>`
      : `<div class="bg-[#321250] border-[2.5px] border-black rounded-xl p-2.5 flex flex-col items-start gap-1 shadow-[3px_3px_0_#000] ${i % 2 ? 'rotate-1' : '-rotate-1'}">
           <span class="text-[10px] font-lucky px-2 py-0.5 rounded border border-black ${stepColors[i % stepColors.length]}">ÉTAPE ${i + 1}</span>
           <p class="font-lucky text-sm text-white">${esc(t.etape)}</p>
           <p class="text-[11px] font-bold text-[#debfc0]/80">${esc(t.detail)}</p></div>`
    ).join('');

    // Au quotidien (V4) : missions, image de l'anniversaire, qualités
    const missions = m.missions || [];
    $('rQuotidien').classList.toggle('hidden', !missions.length && !m.anniversaire && !m.qualites);
    $('rMissions').innerHTML = missions.map((t, i) =>
      `<div class="flex items-center gap-2.5 bg-[#321250] border-[2.5px] border-black rounded-xl p-2.5 shadow-[3px_3px_0_#000] ${i % 2 ? 'rotate-1' : '-rotate-1'}">
         <span class="shrink-0 w-7 h-7 rounded-lg border-2 border-black flex items-center justify-center font-lucky text-sm text-black ${i % 2 ? 'bg-[#00f0ff]' : 'bg-[#ffe600]'}">${i + 1}</span>
         <p class="font-extrabold text-sm text-white">${esc(t)}</p></div>`).join('');
    $('rAnniversaire').classList.toggle('hidden', !m.anniversaire);
    $('rAnniversaireTxt').textContent = m.anniversaire || '';
    $('rQualites').classList.toggle('hidden', !m.qualites);
    $('rQualites').textContent = m.qualites ? `★ Qualités clés : ${m.qualites}` : '';
    $('rVoisin').classList.toggle('hidden', !m.voisin);
    $('rVoisinNom').textContent = m.voisin || '';

    $('rCompetences').innerHTML = m.competences.map((c, i) =>
      `<span class="px-3.5 py-1 rounded-xl text-xs font-lucky tracking-wide border-[2.5px] border-black shadow-[3px_3px_0_#000] hover:rotate-0 transition ${chipColors[i % chipColors.length]}">${chipIcons[i % chipIcons.length]} ${esc(c)}</span>`
    ).join('');
  }

  function start() {
    partie = Moteur.creerPartie(base);
    journal = [];
    metierPropose = metierAvantBonus = null;
    askQuestion(partie.prochaineQuestion());
  }
  function goHome() { partie = null; show('accueil'); }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 1800);
  }

  // Espace pro : fiche métier -> questions -> merci ; "voir ma fiche" réutilise l'écran résultat élève
  function ouvrirPro(ecranDepart) {
    Pro.ouvrir(base, {
      show, toast,
      voirFiche: (metier) => { renderMetier(metier, 100); show('resultat'); }
    });
    show(ecranDepart);
  }

  // Catalogue de toutes les fiches métiers (bouton bleu) ; un clic ouvre la fiche dans l'écran résultat
  function ouvrirFiches() {
    Fiches.ouvrir(base, { choisir: (id) => { retourFiche = 'fiches'; renderMetier(base.metiers[id], null); show('resultat'); } });
    show('fiches');
  }

  // Admin : accès discret par 5 clics rapides sur le titre ORIENTech (ou #admin)
  function ouvrirAdmin(onglet) {
    Admin.ouvrir(base, { toast, onglet, voirFiche: (m) => { retourFiche = 'admin'; renderMetier(m, null); show('resultat'); } });
    show('admin');
  }
  let clicsTitre = [];
  document.querySelector('header h1').addEventListener('click', () => {
    const maintenant = Date.now();
    clicsTitre = clicsTitre.filter((t) => maintenant - t < 2500).concat(maintenant);
    if (clicsTitre.length >= 5) { clicsTitre = []; ouvrirAdmin(); }
  });

  // Jouer -> qui es-tu ? -> (élève) en cours / solo -> partie
  $('playBtn').onclick = () => show('profil');
  document.querySelectorAll('[data-choix-profil]').forEach((btn) => btn.onclick = () => {
    if (btn.dataset.choixProfil === 'prof') {
      contexte.profil = 'prof';
      show('prof');
      return Prof.ouvrir(base, { toast });
    }
    if (btn.dataset.choixProfil === 'pro') {
      contexte.profil = 'pro';
      return ouvrirPro('proFiche');
    }
    contexte.profil = 'eleve';
    show('mode');
  });
  document.querySelectorAll('[data-choix-mode]').forEach((btn) => btn.onclick = () => {
    contexte.mode = btn.dataset.choixMode;
    if (contexte.mode === 'cours') {
      show('code');
      $('prenomInput').value = contexte.prenom || '';
      $('codeInput').value = contexte.code || '';
      return $('prenomInput').focus();
    }
    contexte.code = null;
    contexte.eleve = null;
    start();
  });

  // Code session : 6 lettres/chiffres, vérifié par le serveur
  $('codeInput').oninput = () => {
    $('codeInput').value = $('codeInput').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    $('codeErreur').classList.add('hidden');
  };
  function erreurCode(message) {
    $('codeErreur').textContent = message;
    $('codeErreur').classList.remove('hidden');
    const f = $('codeForm');
    f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
  }
  $('codeForm').onsubmit = async (e) => {
    e.preventDefault();
    const prenom = $('prenomInput').value.trim();
    const code = $('codeInput').value;
    if (!prenom) return erreurCode('Écris ton prénom pour que ton prof te reconnaisse.');
    if (!/^[A-Z0-9]{6}$/.test(code)) return erreurCode('Le code fait 6 caractères (lettres et chiffres).');
    let reponse;
    try {
      // déjà inscrit dans cette classe sous ce prénom (retour en arrière puis « Rejoindre ») : on reprend l'inscription
      // au lieu d'en créer une 2e, qui laisserait une carte fantôme chez le prof
      const deja = contexte.eleve;
      if (deja && deja.code === code && contexte.prenom === prenom) {
        try {
          const { phase } = await api('GET', `/api/sessions/${code}/eleves/${deja.id}?token=${encodeURIComponent(deja.token)}`);
          reponse = { ...deja, phase };
        } catch (err) { /* inscription expirée : on se réinscrit ci-dessous */ }
      }
      if (!reponse) reponse = await api('POST', `/api/sessions/${code}/eleves`, { prenom });
    } catch (err) {
      return erreurCode(err.message === 'Failed to fetch' ? 'Impossible de joindre le serveur.' : err.message);
    }
    if (reponse.phase === 'termine') return erreurCode('Cette session est terminée.');
    contexte.prenom = prenom;
    contexte.code = code;
    contexte.eleve = { code, id: reponse.id, token: reponse.token, seq: reponse.seq || 0 };
    if (reponse.phase === 'attente') return attendreLancement();
    toast(`Salut ${prenom} ! Classe ${code} rejointe`);
    start();
  };
  $('yesBtn').onclick = () => answer(true);
  $('noBtn').onclick = () => answer(false);
  $('affinerBtn').onclick = affiner;
  $('replayBtn').onclick = () => {
    if (!depuisFiches) return goHome();
    return retourFiche === 'admin' ? ouvrirAdmin() : ouvrirFiches();
  };
  // Exemple visible tant que la souris survole le sticker ; sur téléphone (pas de survol), un tap l'affiche / le cache
  const voirExemple = (oui) => $('questionExemple').classList.toggle('hidden', !oui);
  if (matchMedia('(hover: hover)').matches) {
    $('exempleBtn').onmouseenter = () => voirExemple(true);
    $('exempleBtn').onmouseleave = () => voirExemple(false);
  } else {
    $('exempleBtn').onclick = () => voirExemple($('questionExemple').classList.contains('hidden'));
  }
  $('backBtn').onclick = () => {
    if (ecran === 'profil' || ecran === 'fiches' || ecran === 'admin') return show('accueil');
    if (ecran === 'mode') return show('profil');
    if (ecran === 'code') return show('mode');
    if (ecran === 'salle') return show('code');
    if (ecran === 'prof' || ecran === 'proFiche' || ecran === 'proMerci') return show('profil');
    if (ecran === 'proQuestions') return show('proFiche');
    if (partie && partie.nbPosees() === 0) return show(contexte.mode === 'cours' ? 'code' : 'mode'); // 1re question -> écran d'avant
    const bonus = partie && partie.bonus();
    if (bonus && bonus.faites === 0 && metierAvantBonus) { // 1re question bonus -> retour au résultat précédent
      metierPropose = metierAvantBonus;
      metierAvantBonus = null;
      renderMetier(base.metiers[metierPropose], partie.affinite(metierPropose));
      $('affinerBtn').classList.replace('hidden', 'flex');
      return show('resultat');
    }
    const precedente = partie && partie.annuler();
    if (precedente) {
      journal.pop();
      signaler();
      askQuestion(base.questions.find((q) => q.id === precedente.id));
    }
  };
  $('rightBtn').onclick = () => (ECRANS_FERMABLES.includes(ecran) ? goHome() : ouvrirFiches());

  // Raccourcis de test : #profil, #mode, #code, #prof, #pro, #pro-questions, #fiches, #jouer ou #resultat=M01
  const [screen, target] = location.hash.slice(1).split('=');
  if (screen === 'fiches') ouvrirFiches();
  if (screen === 'coffres') { // #coffres=M14 ou #coffres=M14&tout
    const [idMetier, option] = String(target).split('&');
    if (base.metiers[idMetier]) { renderMetier(base.metiers[idMetier], 95); ouvrirCoffres(idMetier, option === 'tout'); }
  }
  if (screen === 'admin') ouvrirAdmin(target);
  if (screen === 'pro') ouvrirPro('proFiche');
  if (screen === 'pro-questions') ouvrirPro('proQuestions');
  if (['profil', 'mode', 'code'].includes(screen)) show(screen);
  if (screen === 'prof') { show('prof'); Prof.ouvrir(base, { toast }); }
  if (screen === 'jouer') start();
  if (screen === 'resultat' && base.metiers[target]) { renderMetier(base.metiers[target], 95); show('resultat'); }

  let soundOn = true;
  $('soundToggle').onclick = () => {
    soundOn = !soundOn;
    $('soundToggle').querySelector('span').textContent = soundOn ? 'volume_up' : 'volume_off';
    $('soundToggle').classList.toggle('opacity-50', !soundOn);
  };
})();
