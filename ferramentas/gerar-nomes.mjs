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

// Tabela de XP por level e insígnias legacy, direto do código aberto do jogo.
const RAW = "https://raw.githubusercontent.com/sunflower-land/sunflower-land/main/src/features/game/";
const level = await (await fetch(RAW + "lib/level.ts")).text();
const blocoXp = /LEVEL_EXPERIENCE[^=]*=\s*\{([\s\S]*?)\};/.exec(level)?.[1] || "";
const niveis = [...blocoXp.matchAll(/(\d+)\s*:\s*([\d_]+)/g)].map((m) => [Number(m[1]), Number(m[2].replace(/_/g, ""))]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
const skills = await (await fetch(RAW + "types/skills.ts")).text();
const legacy = [...(/LegacyBadgeName\s*=([\s\S]*?);/.exec(skills)?.[1] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
if (niveis.length < 100 || legacy.length < 5) throw new Error(`tabelas do jogo não reconhecidas (niveis ${niveis.length}, legacy ${legacy.length})`);

const destino = new URL("../estado/nomes.json", import.meta.url);
fs.mkdirSync(new URL("./", destino), { recursive: true });
fs.writeFileSync(destino, JSON.stringify({ collectibles: colecionaveis, wearables: vestiveis, niveis, legacy }));
console.log(Object.keys(colecionaveis).length, "colecionáveis,", Object.keys(vestiveis).length, "vestíveis,", niveis.length, "levels,", legacy.length, "legacy");
