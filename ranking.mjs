// ranking.mjs -- ranking da temporada (tickets do capítulo) do Sunflower Land.
//
// Fonte oficial: Community API, type=ticketLeaderboard (precisa de um farmId qualquer na consulta).
// Devolve o top 50 com tickets, XP total e nível de ascensão. Ordem do jogo: tickets, depois
// ascensão, depois XP (tudo do maior para o menor) — conferido em 21/11/2026.
//
// Também descobre o nome do ticket do capítulo (ex.: "Duende Cap") pelo farmActivity do 1º colocado
// ("<ticket> Collected") e grava em estado/ranking-ticket.txt; o coletar.mjs usa esse nome para montar
// o ranking completo a partir do arquivo diário.
//
// Saída: docs/data/ranking/oficial.json
// Uso: SFL_API_KEY=sfl.xxx node ranking.mjs

import fs from "node:fs";

const API = "https://api.sunflower-land.com";
const SAIDA = new URL("./docs/data/ranking/", import.meta.url);
const TICKET = new URL("./estado/ranking-ticket.txt", import.meta.url);
const chave = process.env.SFL_API_KEY;
if (!chave) { console.error("Falta a variável SFL_API_KEY."); process.exit(1); }
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(caminho) {
  for (let t = 0; t < 4; t++) {
    const r = await fetch(API + caminho, { headers: { "x-api-key": chave } });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`${caminho}: HTTP ${r.status}`);
    await dorme(8000 * (t + 1));
  }
  throw new Error(`${caminho}: sem resposta`);
}

async function main() {
  fs.mkdirSync(SAIDA, { recursive: true });
  fs.mkdirSync(new URL("./estado/", import.meta.url), { recursive: true });
  const anterior = fs.existsSync(new URL("oficial.json", SAIDA)) ? JSON.parse(fs.readFileSync(new URL("oficial.json", SAIDA), "utf8")) : null;
  const base = anterior?.top?.[0]?.[1] || 22; // qualquer fazenda serve para a consulta
  const d = (await api(`/community/data?type=ticketLeaderboard&farmId=${base}`)).data;
  if (!d?.topTen?.length) throw new Error("ranking vazio");
  const top = d.topTen.map((x) => [x.id, x.farmId, x.count, Math.round(Number(x.experience) || 0), x.ascensionLevel ?? null]);

  // nome do ticket: "<nome> Collected" no 1º colocado, com valor perto da contagem do ranking
  let ticket = fs.existsSync(TICKET) ? fs.readFileSync(TICKET, "utf8").trim() : "";
  try {
    await dorme(5500);
    const fa = (await api(`/community/farms/${top[0][1]}`)).farm?.farmActivity || {};
    const alvo = top[0][2];
    const cand = Object.entries(fa)
      .filter(([k, v]) => / Collected$/.test(k) && !/Reward/.test(k) && v <= alvo && v >= alvo * 0.8)
      .sort((a, b) => b[1] - a[1]);
    if (cand.length) ticket = cand[0][0].replace(/ Collected$/, "");
  } catch (e) { console.log("não consegui conferir o nome do ticket:", e.message); }
  if (ticket) fs.writeFileSync(TICKET, ticket + "\n");

  const saida = { atualizado: d.lastUpdated || Date.now(), total: d.total ?? null, ticket: ticket || null, top };
  fs.writeFileSync(new URL("oficial.json", SAIDA), JSON.stringify(saida));
  console.log(`ranking: ${top.length} no top, ticket "${ticket}", 1º ${top[0][0]} com ${top[0][2]}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
