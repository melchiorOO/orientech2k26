// ORIENTech — catalogue de toutes les fiches métiers (bouton bleu en haut à droite).
// Affiche base.metiers ; une fiche incomplète montre simplement « Fiche à compléter ».
(function (racine) {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COULEURS = ['bg-[#FFE600]', 'bg-[#00E5FF]', 'bg-[#FF2A85] text-white', 'bg-[#FF8800]', 'bg-[#00FF9D]'];

  let metiers = [];  // [{ id, m }]
  let familles = [];
  let filtre = 'tous';
  let choisir = () => {};

  // Texte dans lequel la recherche fouille
  const indexer = (m) => [m.nom, m.description, m.famille, m.code, ...(m.competences || []), ...(m.bacs || []), ...(m.missions || [])]
    .filter(Boolean).join(' ').toLowerCase();

  function carte({ id, m }, i) {
    const couleurFamille = COULEURS[Math.max(0, familles.indexOf(m.famille)) % COULEURS.length];
    const infos = [m.salaire && `💰 ${m.salaire}`, m.cursus && `🎓 ${m.cursus}`].filter(Boolean);
    return `
      <button type="button" data-metier="${esc(id)}" class="text-left bg-[#2e1047] border-[3.5px] border-black rounded-2xl p-4 shadow-[5px_5px_0_#000] hover:-translate-y-1 hover:shadow-[5px_5px_0_#FF2A85] transition flex flex-col gap-2.5 ${['-rotate-1', 'rotate-1', 'rotate-0'][i % 3]}">
        <div class="flex items-center gap-2 flex-wrap">
          ${m.code ? `<span class="font-lucky text-xs px-2 py-0.5 rounded bg-black text-[#FFE600] border-2 border-black tracking-widest">${esc(m.code)}</span>` : ''}
          ${m.famille ? `<span class="text-[10px] font-lucky uppercase px-2 py-0.5 rounded border-2 border-black text-black ${couleurFamille}">${esc(m.famille)}</span>` : ''}
        </div>
        <p class="font-lucky text-xl uppercase leading-tight text-[#FFE600] [text-shadow:_2px_2px_0_#000]">${esc(m.nom)}</p>
        <p class="text-sm font-semibold leading-snug line-clamp-3 ${m.description ? 'text-white/85' : 'text-white/40 italic'}">${esc(m.description || 'Fiche à compléter')}</p>
        ${infos.length ? `<div class="mt-auto pt-2 border-t-2 border-black/40 flex flex-wrap gap-x-3 gap-y-1 text-xs font-space font-bold text-[#00E5FF]">${infos.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
        <span class="self-end font-lucky text-xs uppercase text-white/70 flex items-center gap-1">Voir la fiche <span class="material-symbols-outlined text-base">arrow_forward</span></span>
      </button>`;
  }

  function rendreFiltres() {
    $('fFiltres').classList.toggle('hidden', !familles.length);
    $('fFiltres').innerHTML = [['tous', 'Tous les métiers'], ...familles.map((f) => [f, f])].map(([v, label]) =>
      `<button type="button" data-filtre="${esc(v)}" class="px-3 py-1 rounded-xl border-[2.5px] border-black font-lucky text-xs uppercase shadow-[2px_2px_0_#000] ${v === filtre ? 'bg-[#FFE600] text-black' : 'bg-[#2e1047] text-white'}">${esc(label)}</button>`).join('');
    $('fFiltres').querySelectorAll('[data-filtre]').forEach((b) => (b.onclick = () => { filtre = b.dataset.filtre; rendreFiltres(); rendre(); }));
  }

  function rendre() {
    const cherche = $('fRecherche').value.trim().toLowerCase();
    const visibles = metiers.filter(({ m }) => (filtre === 'tous' || m.famille === filtre) && (!cherche || indexer(m).includes(cherche)));
    $('fGrille').innerHTML = visibles.map(carte).join('');
    $('fVide').classList.toggle('hidden', visibles.length > 0);
    $('fGrille').querySelectorAll('[data-metier]').forEach((b) => (b.onclick = () => choisir(b.dataset.metier)));
  }

  $('fRecherche').addEventListener('input', rendre);

  // options : { choisir(idMetier) }
  function ouvrir(base, options) {
    choisir = options.choisir;
    metiers = Object.entries(base.metiers).map(([id, m]) => ({ id, m })).sort((a, b) => a.m.nom.localeCompare(b.m.nom, 'fr'));
    familles = [...new Set(metiers.map(({ m }) => m.famille).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    if (!familles.includes(filtre)) filtre = 'tous';
    $('fNombre').textContent = metiers.length;
    rendreFiltres();
    rendre();
  }

  racine.Fiches = { ouvrir };
})(this);
