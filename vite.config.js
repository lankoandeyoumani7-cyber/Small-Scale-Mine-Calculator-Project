import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// IMPORTANT : remplace "mine-calculator" ci-dessous par le nom EXACT
// de ton dépôt GitHub si tu déploies sur GitHub Pages
// (ex : https://github.com/tonpseudo/mine-calculator -> base: "/mine-calculator/")
// Si tu déploies sur Vercel ou Netlify, laisse base: "/"
export default defineConfig({
  plugins: [react()],
  base: "/mine-calculator/",
});
