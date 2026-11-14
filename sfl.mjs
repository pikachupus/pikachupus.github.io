// sfl.mjs -- negociações de FLOWER nos pools oficiais (Base e Ronin) com a fazenda de cada carteira.
//
// 1) GeckoTerminal (grátis, sem chave): últimas negociações de cada pool. A rotina roda de hora em hora
//    e a API devolve ~18-24 h, então nada se perde. Guardamos 30 dias (estado/sfl-trades.json.gz).
//    Compra/venda e preço saem do lado FLOWER pelo endereço do token: preço = US$ ÷ FLOWER.
// 2) Carteira -> fazenda: OpenSea (NFT da coleção sunflower-land na Polygon da mesma carteira) e,
//    se houver chave, Etherscan v2 como reserva (fazenda "oculta" na OpenSea). Cache em estado/sfl-carteiras.json.
// 3) Fazenda -> nome/banimento: API do jogo (quando o id da fazenda é o próprio NFT) e o arquivo diário
//    lido pelo venda.mjs (estado/sfl-fazendas.json).
//
// Saída (lida por docs/sfl/): docs/data/sfl/trades.json e docs/data/sfl/carteiras.json
// Uso: OPENSEA_API_KEY=xxx SFL_API_KEY=sfl.xxx [ETHERSCAN_API_KEY=xxx] node sfl.mjs

import fs from "node:fs";
import zlib from "node:zlib";

const GT = "https://api.geckoterminal.com/api/v2";
export const POOLS = [
  { rede: "base", pool: "0xafe30319a948f322585fafc1cab1671a47eb3786" },
  { rede: "ronin", pool: "0xe61554fc62e4072f5526cec54fd22ba12ac2c95f" },
];
const CONTRATO_FAZENDA = "0x2b4a66557a79263275826ad31a4cddc2789334bd";
const DIAS = 30;
const RESOLVER_POR_RODADA = Number(process.env.SFL_RESOLVER || 80);
const RAIZ = new URL("./", import.meta.url);
const ARQ_TRADES = new URL("estado/sfl-trades.json.gz", RAIZ);
const ARQ_CARTEIRAS = new URL("estado/sfl-carteiras.json", RAIZ);
const ARQ_FAZENDAS = new URL("estado/sfl-fazendas.json", RAIZ);
const SAIDA = new URL("docs/data/sfl/", RAIZ);
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const ler = (u, padrao) => { try { return fs.existsSync(u) ? JSON.parse(String(u).endsWith(".gz") ? zlib.gunzipSync(fs.readFileSync(u)) : fs.readFileSync(u, "utf8")) : padrao; } catch { return padrao; } };
const gravar = (u, v) => { fs.mkdirSync(new URL("./", u), { recursive: true }); fs.writeFileSync(u, String(u).endsWith(".gz") ? zlib.gzipSync(JSON.stringify(v)) : JSON.stringify(v)); };
const sig = (v, n = 5) => (v == null || !isFinite(v) ? null : Number(Number(v).toPrecision(n)));

async function gt(caminho) {
  for (let t = 1; t <= 4; t++) {
    const r = await fetch(GT + caminho, { headers: { accept: "application/json" } });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`GeckoTerminal ${caminho}: HTTP ${r.status}`);
    await dormir(5000 * t);
  }
  throw new Error(`GeckoTerminal ${caminho}: sem resposta`);
}

async function negociacoes() {
  const novas = [];
  for (const { rede, pool } of POOLS) {
    const info = await gt(`/networks/${rede}/pools/${pool}`);
    const flower = (info.data?.relationships?.base_token?.data?.id || "").split("_")[1]?.toLowerCase();
    if (!flower) throw new Error(`não achei o token FLOWER do pool ${rede}`);
    await dormir(2500);
    const j = await gt(`/networks/${rede}/pools/${pool}/trades`);
    for (const raw of j.data || []) {
      const a = raw.attributes || {};
      if (!a.tx_from_address || a.is_anomalous) continue;
      const compra = String(a.to_token_address || "").toLowerCase() === flower;
      const qtd = Number(compra ? a.to_token_amount : a.from_token_amount);
      const usd = Number(a.volume_in_usd);
      if (!qtd || !usd) continue;
      novas.push({ id: raw.id, t: Date.parse(a.block_timestamp), r: rede === "base" ? 0 : 1, k: compra ? 1 : 0, w: a.tx_from_address.toLowerCase(), f: sig(qtd, 6), u: sig(usd, 6), tx: a.tx_hash });
    }
    console.log(`${rede}: ${(j.data || []).length} negociações recebidas`);
    await dormir(2500);
  }
  return novas;
}

async function nftDaCarteira(w) {
  const chave = process.env.OPENSEA_API_KEY;
  if (chave) {
    try {
      const r = await fetch(`https://api.opensea.io/api/v2/chain/matic/account/${w}/nfts?collection=sunflower-land&limit=5`, { headers: { accept: "application/json", "x-api-key": chave } });
      if (r.ok) { const d = await r.json(); if (d.nfts?.length) return String(d.nfts[0].identifier); }
      else if (r.status === 429) await dormir(3000);
    } catch {}
  }
  const eth = process.env.ETHERSCAN_API_KEY;
  if (eth) {
    try {
      const r = await fetch(`https://api.etherscan.io/v2/api?chainid=137&module=account&action=tokennfttx&contractaddress=${CONTRATO_FAZENDA}&address=${w}&sort=desc&apikey=${eth}`);
      const d = await r.json();
      if (d.status === "1" && Array.isArray(d.result)) {
        const ultimo = new Map();
        for (const tx of d.result) { const b = Number(tx.blockNumber), p = ultimo.get(tx.tokenID); if (!p || b > p.b) ultimo.set(tx.tokenID, { to: (tx.to || "").toLowerCase(), b }); }
        for (const [id, x] of ultimo) if (x.to === w) return String(id);
      }
    } catch {}
  }
  return null;
}

let ultimaApi = 0;
async function fazendaDoJogo(nft) {
  const chave = process.env.SFL_API_KEY;
  if (!chave) return null;
  const falta = ultimaApi + 5200 - Date.now();
  if (falta > 0) await dormir(falta);
  ultimaApi = Date.now();
  try {
    const r = await fetch(`https://api.sunflower-land.com/community/farms/${nft}`, { headers: { "x-api-key": chave } });
    if (!r.ok) return null;
    const j = await r.json();
    if (String(j.nftId ?? j.nft_id) !== String(nft)) return null; // id da fazenda ≠ NFT: fica para o arquivo diário
    return { id: String(j.id), nome: j.farm?.username ?? null, banida: j.isBlacklisted ? 1 : 0, st: j.farm?.ban?.status ?? null, em: Date.now() };
  } catch { return null; }
}

async function main() {
  const agora = Date.now(), corte = agora - DIAS * 864e5;
  // 1) negociações
  const guardadas = new Map(ler(ARQ_TRADES, []).filter((x) => x.t >= corte).map((x) => [x.id, x]));
  const antes = guardadas.size;
  for (const n of await negociacoes()) if (n.t >= corte) guardadas.set(n.id, n);
  const trades = [...guardadas.values()].sort((a, b) => a.t - b.t);
  gravar(ARQ_TRADES, trades);
  console.log(`negociações: ${trades.length} em ${DIAS} dias (+${trades.length - antes} novas)`);

  // 2) carteira -> NFT (novas primeiro; sem fazenda: tenta de novo depois de 3 dias)
  const carteiras = ler(ARQ_CARTEIRAS, {});
  const vistas = [...new Set(trades.map((x) => x.w))];
  const fila = vistas.filter((w) => !carteiras[w] || (!carteiras[w].nft && agora - carteiras[w].em > 3 * 864e5))
    .sort((a, b) => (carteiras[a]?.em || 0) - (carteiras[b]?.em || 0)).slice(0, RESOLVER_POR_RODADA);
  let achou = 0;
  for (const w of fila) {
    const nft = await nftDaCarteira(w);
    carteiras[w] = { nft, em: Date.now() };
    if (nft) achou++;
    await dormir(700);
  }
  gravar(ARQ_CARTEIRAS, carteiras);
  console.log(`carteiras: ${vistas.length} nas negociações, ${fila.length} consultadas agora (${achou} com fazenda)`);

  // 3) NFT -> nome/banimento (a API do jogo resolve quando o id da fazenda é o próprio NFT)
  const fazendas = ler(ARQ_FAZENDAS, {});
  const semNome = [...new Set(vistas.map((w) => carteiras[w]?.nft).filter(Boolean))].filter((n) => !fazendas[n] || agora - (fazendas[n].em || 0) > 7 * 864e5).slice(0, 15);
  for (const nft of semNome) { const f = await fazendaDoJogo(nft); if (f) fazendas[nft] = f; }
  gravar(ARQ_FAZENDAS, fazendas);

  // 4) saída compacta para a página
  const idx = new Map(vistas.map((w, i) => [w, i]));
  gravar(new URL("trades.json", SAIDA), {
    atualizado_em: new Date().toISOString(), redes: POOLS.map((p) => p.rede), pools: POOLS,
    carteiras: vistas,
    // [segundos, rede(0 base/1 ronin), tipo(1 compra/0 venda), índice da carteira, FLOWER, US$]
    trades: trades.map((x) => [Math.round(x.t / 1000), x.r, x.k, idx.get(x.w), x.f, x.u]),
  });
  const mapa = {};
  for (const w of vistas) {
    const nft = carteiras[w]?.nft;
    if (!nft) continue;
    const f = fazendas[nft] || {};
    mapa[w] = [nft, f.nome ?? null, f.id ?? null, f.banida ?? null, f.st ?? null];
  }
  gravar(new URL("carteiras.json", SAIDA), mapa);
  console.log(`saída: ${trades.length} negociações, ${Object.keys(mapa).length} carteiras com fazenda`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
