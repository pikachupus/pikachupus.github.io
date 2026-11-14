// Gera estado/nomes.json (id -> nome e categoria base) a partir da biblioteca do jogo (sfl-game-lib.mjs).
// Rodar quando o jogo lançar itens novos:  node ferramentas/gerar-nomes.mjs <caminho/sfl-game-lib.mjs>
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const lib = process.argv[2];
if (!lib) throw new Error("Uso: node ferramentas/gerar-nomes.mjs <caminho/sfl-game-lib.mjs>");
const G = await import(pathToFileURL(lib).href);
const crops = new Set([...Object.keys(G.CROPS), ...Object.keys(G.PATCH_FRUIT), ...Object.keys(G.GREENHOUSE_FRUIT), "Rice", "Olive"]);
const colecionaveis = {};
for (const [nome, id] of Object.entries(G.KNOWN_IDS)) {
  let c = null; // null = decide pelo market (recurso se negocia em lote, senão colecionável)
  if (crops.has(nome)) c = "crops";
  else if (id >= 200 && id < 300) c = "flores";
  else if (id >= 1500 && id < 1600) c = "peixes";
  colecionaveis[id] = c ? [nome, c] : [nome];
}
const vestiveis = Object.fromEntries(Object.entries(G.WEARABLE_IDS).map(([nome, id]) => [id, nome]));
const destino = new URL("../estado/nomes.json", import.meta.url);
fs.mkdirSync(new URL("./", destino), { recursive: true });
fs.writeFileSync(destino, JSON.stringify({ collectibles: colecionaveis, wearables: vestiveis }));
console.log(Object.keys(colecionaveis).length, "colecionáveis,", Object.keys(vestiveis).length, "vestíveis");
