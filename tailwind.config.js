// Tailwind précompilé (remplace le CDN qui compilait la CSS dans le navigateur à chaque changement d'écran).
// Régénérer après avoir ajouté des classes : npx tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.src.css -o tailwind.css --minify
module.exports = {
  content: ['./index.html', './*.js'],
  // classes construites dynamiquement en JS (game.js : `sm:grid-cols-${nbCartes}`)
  safelist: ['sm:grid-cols-1', 'sm:grid-cols-2', 'sm:grid-cols-3'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif'],
        outfit: ['Outfit', 'sans-serif'],
        space: ['Space Grotesk', 'sans-serif'],
        lucky: ['Luckiest Guy', 'sans-serif']
      }
    }
  }
};
