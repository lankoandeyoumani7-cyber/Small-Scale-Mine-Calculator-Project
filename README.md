# Modèle d'Investissement Progressif — Mines Aurifères (Burkina Faso)

Calculateur technico-économique pour l'exploitation minière aurifère
semi-mécanisée, conforme au Code Minier 2024 du Burkina Faso.

## Démarrer en local

```bash
npm install
npm run dev
```

Ouvre ensuite l'URL affichée dans le terminal (généralement http://localhost:5173).

## Construire pour la production

```bash
npm run build
```

Le résultat est généré dans le dossier `dist/`.

## Déployer sur GitHub Pages

1. Pousse ce projet sur un dépôt GitHub nommé, par exemple, `mine-calculator`.
2. Vérifie que `vite.config.js` contient `base: "/mine-calculator/"` (remplace
   par le nom exact de ton dépôt).
3. Dans les réglages du dépôt GitHub : **Settings → Pages → Build and
   deployment → Source : GitHub Actions**.
4. Chaque `git push` sur la branche `main` déclenche automatiquement le
   workflow `.github/workflows/deploy.yml`, qui construit et publie le site.
5. Le site sera disponible à `https://<ton-pseudo>.github.io/mine-calculator/`.

## Déployer sur Vercel (alternative, plus simple)

1. Pousse le projet sur GitHub.
2. Va sur [vercel.com](https://vercel.com), "Add New Project", importe le dépôt.
3. Vercel détecte Vite automatiquement — aucune configuration nécessaire.
4. Mets `base: "/"` dans `vite.config.js` si tu utilises Vercel plutôt que
   GitHub Pages.
