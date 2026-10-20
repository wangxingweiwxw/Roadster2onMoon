// Preserve the game's native ESM/import-map paths in the published static tree.
import(/* @vite-ignore */ new URL('./game.js?v=3.2', document.baseURI).href);
