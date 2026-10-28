// ORIENTech — reveal du résultat directement sur la fiche : les cartes Métier, Salaire et Études sont cachées
// sous 3 coffres (Clash Royale / Fortnite). L'élève les tape dans l'ordre : le coffre tremble de plus en plus,
// explose, et la carte apparaît. Le reste de la fiche s'affiche quand les 3 sont ouverts.
(function (racine) {
  const $ = (id) => document.getElementById(id);
  const DUREE_SECOUSSE = 1000;

  // Rareté façon Fortnite, dans l'ordre d'ouverture
  const RARETES = [
    { rarete: 'Légendaire', couleur: '#FFE600', sombre: '#C98A00' },
    { rarete: 'Épique', couleur: '#FF2A85', sombre: '#A0105A' },
    { rarete: 'Rare', couleur: '#00E5FF', sombre: '#0089A8' }
  ];

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

  let cartes = [], etape = 0, timers = [], surFin = () => {}, fini = false;
  const mouvementReduit = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const couche = (carte) => carte.querySelector('.coffre-couche');

  // Explosion d'étoiles et de confettis autour du coffre
  function particules(carte, couleur) {
    const formes = ['✦', '★', '✦', '●', '■'];
    const couleurs = [couleur, '#FFFFFF', '#FFE600', '#FF2A85', '#00E5FF'];
    for (let k = 0; k < 26; k++) {
      const p = document.createElement('span');
      const angle = Math.random() * Math.PI * 2, dist = 80 + Math.random() * 110;
      p.className = 'particule';
      p.textContent = formes[k % formes.length];
      p.style.cssText = `--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist - 40}px;--r:${Math.random() * 540 - 270}deg;` +
        `--taille:${10 + Math.random() * 16}px;--couleur:${couleurs[k % couleurs.length]};animation-delay:${Math.random() * 0.12}s`;
      carte.appendChild(p);
      timers.push(setTimeout(() => p.remove(), 1300));
    }
  }

  // La carte apparaît, sa couche-coffre est retirée
  function reveler(carte) {
    couche(carte)?.remove();
    carte.classList.remove('carte-cachee');
    carte.classList.add('carte-revelee');
  }

  function ouvrirCoffre(i, instantane) {
    if (i !== etape) {
      if (i > etape) { // coffre encore verrouillé : petit refus
        const b = couche(cartes[i]).querySelector('.coffre-btn');
        b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
      }
      return;
    }
    const carte = cartes[i];
    etape++;
    if (instantane || mouvementReduit()) {
      reveler(carte);
      return suivant();
    }
    couche(carte).dataset.etat = 'ouverture';
    timers.push(setTimeout(() => {
      couche(carte).dataset.etat = 'ouvert';
      particules(carte, RARETES[i].couleur);
      timers.push(setTimeout(() => reveler(carte), 420));    // la carte sort pendant que la couche s'efface
      timers.push(setTimeout(suivant, 900));                  // le coffre suivant se réveille ensuite
    }, DUREE_SECOUSSE));
  }

  function suivant() {
    if (etape < cartes.length) {
      const c = couche(cartes[etape]);
      if (c && c.dataset.etat === 'verrouille') c.dataset.etat = 'pret';
      return;
    }
    $('rCoffresBarre').classList.add('hidden');
    $('rCoffresBarre').classList.remove('flex');
    if (!fini) { fini = true; surFin(); }
  }

  // Annule tout (fiche ouverte depuis le catalogue, nouvelle partie…)
  function reinitialiser() {
    timers.forEach(clearTimeout); timers = [];
    cartes.forEach(reveler);
    cartes = [];
    document.querySelectorAll('.carte-revelee').forEach((c) => c.classList.remove('carte-revelee'));
    $('rCoffresBarre').classList.add('hidden');
    $('rCoffresBarre').classList.remove('flex');
  }

  // options : { cartes: [élément Métier, élément Salaire, élément Études] (visibles, dans l'ordre), surFin(), tout? }
  function cacher(options) {
    reinitialiser();
    cartes = options.cartes;
    surFin = options.surFin || (() => {});
    etape = 0;
    fini = false;
    cartes.forEach((carte, i) => {
      const r = RARETES[i] || RARETES[RARETES.length - 1];
      const titre = carte.dataset.titreCoffre || '';
      carte.classList.add('carte-cachee');
      const c = document.createElement('div');
      c.className = 'coffre-couche';
      c.dataset.etat = i === 0 ? 'pret' : 'verrouille';
      c.style.cssText = `--rarete:${r.couleur};--rarete-sombre:${r.sombre}`;
      c.innerHTML = `
        <span class="coffre-rarete">★ ${r.rarete} · ${titre}</span>
        <div class="rayons"></div>
        <button type="button" class="coffre-btn" aria-label="Ouvrir le coffre ${titre}">${SVG_COFFRE}</button>
        <span class="coffre-cadenas"><span class="material-symbols-outlined">lock</span></span>
        <span class="coffre-tape">👆 Tape !</span>
        <div class="flash"></div>`;
      c.querySelector('.coffre-btn').onclick = () => ouvrirCoffre(i);
      carte.appendChild(c);
    });
    $('rCoffresBarre').classList.remove('hidden');
    $('rCoffresBarre').classList.add('flex');
    if (options.tout || !cartes.length) toutOuvrir();
  }

  // "Tout ouvrir" : révèle d'un coup les cartes restantes
  function toutOuvrir() {
    timers.forEach(clearTimeout); timers = [];
    cartes.slice(0, etape).forEach((c) => { if (couche(c)) reveler(c); }); // coffre interrompu en pleine ouverture
    while (etape < cartes.length) ouvrirCoffre(etape, true);
    suivant();
  }
  $('rToutOuvrir').onclick = toutOuvrir;

  racine.Coffres = { cacher, reinitialiser };
})(this);
