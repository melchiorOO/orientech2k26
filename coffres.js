// ORIENTech — reveal du résultat en 3 coffres (Clash Royale / Fortnite) : métier, salaire, études.
// L'élève tape les coffres dans l'ordre : le coffre tremble de plus en plus, explose, et une carte en jaillit.
(function (racine) {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DUREE_SECOUSSE = 1000;

  // Un coffre par information, avec sa rareté façon Fortnite
  const COFFRES = [
    { titre: 'Métier', rarete: 'Légendaire', couleur: '#FFE600', sombre: '#C98A00', icone: 'badge', rot: '-2deg' },
    { titre: 'Salaire', rarete: 'Épique', couleur: '#FF2A85', sombre: '#A0105A', icone: 'payments', rot: '1.5deg' },
    { titre: 'Études', rarete: 'Rare', couleur: '#00E5FF', sombre: '#0089A8', icone: 'school', rot: '-1deg' }
  ];

  let etape = 0, timers = [], surFin = () => {};
  const slots = () => [...$('cGrille').querySelectorAll('.coffre-slot')];
  const mouvementReduit = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Coffre dessiné en SVG : corps + couvercle séparé (animé), cerclages, serrure, lueur sous le couvercle
  const SVG_COFFRE = `
    <svg viewBox="0 0 200 165" aria-hidden="true">
      <ellipse cx="100" cy="160" rx="78" ry="6" fill="#000" opacity=".35"/>
      <rect class="c-corps" x="18" y="78" width="164" height="78" rx="10" stroke="#000" stroke-width="5"/>
      <rect class="c-sombre" x="18" y="128" width="164" height="28" rx="8" stroke="#000" stroke-width="5"/>
      <rect x="40" y="78" width="16" height="78" fill="#2a1240" stroke="#000" stroke-width="4"/>
      <rect x="144" y="78" width="16" height="78" fill="#2a1240" stroke="#000" stroke-width="4"/>
      <rect class="c-lueur" x="22" y="74" width="156" height="10" rx="5"/>
      <g class="couvercle">
        <path class="c-corps" d="M18 82 V60 Q100 4 182 60 V82 Z" stroke="#000" stroke-width="5" stroke-linejoin="round"/>
        <path d="M30 56 Q100 14 170 56" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55"/>
        <path d="M40 82 V46 Q48 38 56 34 V82 Z" fill="#2a1240" stroke="#000" stroke-width="4" stroke-linejoin="round"/>
        <path d="M144 82 V34 Q152 38 160 46 V82 Z" fill="#2a1240" stroke="#000" stroke-width="4" stroke-linejoin="round"/>
      </g>
      <rect x="86" y="70" width="28" height="34" rx="5" fill="#fff" stroke="#000" stroke-width="4"/>
      <circle cx="100" cy="84" r="4.5" fill="#000"/>
      <rect x="98" y="86" width="4" height="10" rx="2" fill="#000"/>
    </svg>`;

  function contenuCarte(i, m) {
    const vide = '<p class="font-bold text-sm text-white/60 py-3">À découvrir dans ta fiche</p>';
    if (i === 0) {
      return `<p class="font-lucky text-xl leading-tight uppercase text-[#FFE600] [text-shadow:_2px_2px_0_#000] px-1">${esc(m.nom)}</p>
        ${m.famille ? `<span class="inline-block mt-2 text-[10px] font-lucky uppercase bg-white text-black border-2 border-black rounded px-1.5 py-0.5">${esc(m.famille)}</span>` : ''}`;
    }
    if (i === 1) {
      if (!m.salaire) return vide;
      return `<p class="font-lucky text-2xl leading-tight text-white [text-shadow:_2px_2px_0_#000]">${esc(m.salaire)}</p>
        <span class="inline-block mt-2 text-[10px] font-space font-bold uppercase bg-black text-[#FF2A85] rounded px-1.5 py-0.5">${esc(m.salaire_unite || 'Brut mensuel débutant')}</span>`;
    }
    if (!m.cursus) return vide;
    return `<p class="font-lucky text-2xl leading-tight text-white [text-shadow:_2px_2px_0_#000]">${esc(m.cursus)}</p>
      ${(m.bacs || []).length ? `<p class="mt-2 text-[11px] font-bold text-[#00E5FF] leading-snug">${(m.bacs || []).map(esc).join(' • ')}</p>` : ''}`;
  }

  function construire(m) {
    $('cGrille').innerHTML = COFFRES.map((c, i) => `
      <div class="coffre-slot" data-etat="verrouille" style="--rarete:${c.couleur};--rarete-sombre:${c.sombre};--rot:${c.rot}">
        <span class="coffre-rarete">★ ${esc(c.rarete)} · ${esc(c.titre)}</span>
        <div class="rayons"></div>
        <button type="button" class="coffre-btn" aria-label="Ouvrir le coffre ${esc(c.titre)}">${SVG_COFFRE}</button>
        <span class="coffre-cadenas"><span class="material-symbols-outlined">lock</span></span>
        <span class="coffre-tape">👆 Tape !</span>
        <div class="flash"></div>
        <div class="carte-coffre">
          <div class="bandeau"><span class="material-symbols-outlined text-base">${c.icone}</span>${esc(c.titre)}</div>
          <div class="p-3 min-h-[96px] flex flex-col items-center justify-center">${contenuCarte(i, m)}</div>
        </div>
      </div>`).join('');
    slots().forEach((s, i) => (s.querySelector('.coffre-btn').onclick = () => ouvrirCoffre(i)));
  }

  // Explosion d'étoiles et de confettis autour du coffre
  function particules(slot) {
    const formes = ['✦', '★', '✦', '●', '■'];
    const couleurs = [getComputedStyle(slot).getPropertyValue('--rarete').trim(), '#FFFFFF', '#FFE600', '#FF2A85', '#00E5FF'];
    for (let k = 0; k < 26; k++) {
      const p = document.createElement('span');
      const angle = Math.random() * Math.PI * 2, dist = 80 + Math.random() * 110;
      p.className = 'particule';
      p.textContent = formes[k % formes.length];
      p.style.cssText = `--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist - 40}px;--r:${Math.random() * 540 - 270}deg;` +
        `--taille:${10 + Math.random() * 16}px;--couleur:${couleurs[k % couleurs.length]};animation-delay:${Math.random() * 0.12}s`;
      slot.appendChild(p);
      timers.push(setTimeout(() => p.remove(), 1300));
    }
  }

  function ouvrirCoffre(i, instantane) {
    const tous = slots();
    if (i !== etape) {
      if (i > etape) { // coffre encore verrouillé : petit refus
        const b = tous[i].querySelector('.coffre-btn');
        b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
      }
      return;
    }
    const slot = tous[i];
    etape++;
    if (instantane || mouvementReduit()) {
      slot.dataset.etat = 'ouvert';
      return suivant(instantane);
    }
    slot.dataset.etat = 'ouverture';
    timers.push(setTimeout(() => {
      slot.classList.add('anime');
      slot.dataset.etat = 'ouvert';
      particules(slot);
      timers.push(setTimeout(suivant, 700)); // le coffre suivant se réveille après la carte
    }, DUREE_SECOUSSE));
  }

  function suivant(instantane) {
    const tous = slots();
    if (etape < tous.length) {
      if (tous[etape].dataset.etat === 'verrouille') tous[etape].dataset.etat = 'pret';
      // téléphone (coffres empilés) : on amène le coffre suivant à l'écran s'il n'y est pas en entier
      const r = tous[etape].getBoundingClientRect();
      if (!instantane && (r.top < 0 || r.bottom > innerHeight)) {
        tous[etape].scrollIntoView({ behavior: mouvementReduit() ? 'auto' : 'smooth', block: 'center' });
      }
      return;
    }
    $('cConsigne').textContent = 'Bravo, tout est révélé !';
    $('cPasser').classList.add('hidden');
    timers.push(setTimeout(() => {
      $('cFin').classList.remove('hidden');
      const r = $('cFin').getBoundingClientRect();
      if (!instantane && r.bottom > innerHeight) $('cFin').scrollIntoView({ behavior: mouvementReduit() ? 'auto' : 'smooth', block: 'end' });
    }, instantane ? 0 : 500));
  }

  // "Passer" : ouvre d'un coup tous les coffres restants (sans animation)
  $('cPasser').onclick = () => {
    timers.forEach(clearTimeout); timers = [];
    slots().forEach((s) => { if (s.dataset.etat === 'ouverture') { s.dataset.etat = 'verrouille'; } });
    etape = slots().findIndex((s) => s.dataset.etat !== 'ouvert');
    if (etape < 0) etape = slots().length;
    while (etape < slots().length) ouvrirCoffre(etape, true);
    suivant(true);
  };
  $('cVoirFiche').onclick = () => surFin();

  // options : { surFin(), tout? }  — tout = tout ouvrir directement (raccourci de test)
  function ouvrir(metier, options) {
    timers.forEach(clearTimeout); timers = [];
    etape = 0;
    surFin = options.surFin;
    $('cConsigne').textContent = 'Ouvre tes 3 coffres un par un';
    $('cPasser').classList.remove('hidden');
    $('cFin').classList.add('hidden');
    construire(metier);
    slots()[0].dataset.etat = 'pret';
    if (options.tout) $('cPasser').onclick();
  }

  racine.Coffres = { ouvrir };
})(this);
