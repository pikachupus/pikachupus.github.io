// venda.mjs -- fazendas do Sunflower Land anunciadas na OpenSea, conferidas com os dados do jogo.
//
// 1) OpenSea (coleção "sunflower-land", Polygon): todos os anúncios abertos -> preço, vendedor, datas.
// 2) Arquivo diário oficial do jogo (all.jsonl.gz, todas as fazendas): para cada fazenda anunciada,
//    banimento, último save, level, skills e insígnias legacy, ilha, VIP, saldo, itens e vestíveis.
//    Só é relido quando sai um arquivo novo (1x por dia).
// 3) API do jogo (/community/farms/{id}): reconfere a cada rodada um lote das anunciadas (as checadas
//    há mais tempo primeiro), para o banimento não ficar 1 dia atrasado.
// Valor dos itens = quantidade x preço atual do market (docs/data/precos/agora.json, do precos.mjs).
//
// Saída: docs/data/venda/fazendas.json (lida por docs/venda.html) e estado/venda.json.gz (cache).
// Uso: SFL_API_KEY=sfl.xxx OPENSEA_API_KEY=xxx node venda.mjs   (opcional VENDA_CHECAR=60)

import fs from "node:fs";
import zlib from "node:zlib";
import { Readable } from "node:stream";

const API = "https://api.sunflower-land.com";
const ARQUIVOS = "https://community.sunflower-land.com";
const COLECAO = "sunflower-land";
const CONTRATO = "0x2b4a66557a79263275826ad31a4cddc2789334bd";
const CHECAR = Number(process.env.VENDA_CHECAR || 60); // reconferências pela API por rodada (~5 s cada; 60/h = todas as anunciadas por dia)
const RAIZ = new URL("./", import.meta.url);
const CACHE = new URL("estado/venda.json.gz", RAIZ);
const SAIDA = new URL("docs/data/venda/fazendas.json", RAIZ);
const NOMES = JSON.parse(fs.readFileSync(new URL("estado/nomes.json", RAIZ), "utf8"));
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const sig = (v) => (v == null || !isFinite(v) ? null : Number(Number(v).toPrecision(5)));

function exigir(nome) { const v = process.env[nome]; if (!v) throw new Error(`Falta a variável ${nome} (segredo do repositório).`); return v; }

// ---------- OpenSea ----------
async function anuncios() {
  const H = { "x-api-key": exigir("OPENSEA_API_KEY"), accept: "application/json" };
  const porNft = new Map();
  let next = null, pag = 0;
  do {
    let r;
    for (let t = 1; ; t++) {
      r = await fetch(`https://api.opensea.io/api/v2/listings/collection/${COLECAO}/all?limit=100${next ? "&next=" + encodeURIComponent(next) : ""}`, { headers: H });
      if (r.ok || t >= 4) break;
      await dormir(2000 * t);
    }
    if (!r.ok) throw new Error(`OpenSea: HTTP ${r.status}`);
    const j = await r.json();
    for (const l of j.listings || []) {
      const p = l.protocol_data?.parameters || {};
      const nft = String(p.offer?.[0]?.identifierOrCriteria ?? l.asset?.identifier ?? "");
      if (!nft) continue;
      const pc = l.price?.current || {};
      const preco = Number(pc.value) / 10 ** (pc.decimals ?? 18);
      const a = { preco, moeda: pc.currency || "?", vendedor: (p.offerer || "").toLowerCase(), inicio: Number(p.startTime) * 1000 || null, fim: Number(p.endTime) * 1000 || null };
      const atual = porNft.get(nft);
      if (!atual) porNft.set(nft, { ...a, n: 1 });
      else { atual.n++; if (a.moeda === atual.moeda ? a.preco < atual.preco : false) Object.assign(atual, a); }
    }
    next = j.next; pag++;
    await dormir(600);
  } while (next && pag < 100);
  console.log(`OpenSea: ${porNft.size} fazendas anunciadas (${pag} páginas).`);
  return porNft;
}

// Cotação das moedas dos anúncios (CoinGecko, grátis e sem chave).
async function cotacoes() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum,polygon-ecosystem-token&vs_currencies=usd,brl");
    const j = await r.json();
    const eth = j.ethereum, pol = j["polygon-ecosystem-token"];
    return { WETH: eth, ETH: eth, POL: pol, MATIC: pol, WPOL: pol };
  } catch { return {}; }
}

// ---------- Jogo ----------
let ultimaApi = 0;
async function api(caminho) {
  const falta = ultimaApi + 5200 - Date.now();
  if (falta > 0) await dormir(falta);
  for (let t = 1; ; t++) {
    ultimaApi = Date.now();
    const r = await fetch(API + caminho, { headers: { "x-api-key": exigir("SFL_API_KEY") } });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    if (r.status === 401) throw new Error("HTTP 401: chave do jogo inválida ou VIP da fazenda dona vencido");
    if (t >= 3) return null;
    await dormir(6000 * t);
  }
}

function precosDoMarket() {
  const u = new URL("docs/data/precos/agora.json", RAIZ);
  const col = {}, vest = {}, cat = {};
  let flowerUsd = null;
  if (fs.existsSync(u)) {
    const a = JSON.parse(fs.readFileSync(u, "utf8"));
    flowerUsd = a.flower;
    for (const i of a.itens) {
      if (i.p == null) continue;
      if (i.k.startsWith("collectibles-")) { col[i.n] = i.p; cat[i.n] = i.c; }
      else if (i.k.startsWith("wearables-")) vest[i.n] = i.p;
    }
  }
  return { col, vest, cat, flowerUsd };
}

const levelDe = (xp) => { let n = 1; NOMES.niveis.forEach((min, i) => { if (xp >= min) n = i + 1; }); return n; };

function resumo(j, M) {
  const f = j.farm || {}, fa = f.farmActivity || {}, inv = f.inventory || {}, guarda = f.wardrobe || {};
  const soma = (re) => Object.keys(fa).filter((k) => re.test(k)).reduce((s, k) => s + (Number(fa[k]) || 0), 0);
  const xp = Number(f.bumpkin?.experience) || 0;
  let valorNft = 0, valorRecursos = 0, valorVest = 0;
  const itens = [];
  for (const [nome, q] of Object.entries(inv)) {
    const qtd = Number(q) || 0, p = M.col[nome];
    if (!qtd || p == null) continue;
    const v = qtd * p;
    if (M.cat[nome] === "colecionaveis") valorNft += v; else valorRecursos += v;
    itens.push([nome, sig(qtd), sig(v)]);
  }
  let vestN = 0;
  for (const [nome, q] of Object.entries(guarda)) {
    const qtd = Number(q) || 0; vestN += qtd;
    const p = M.vest[nome];
    if (qtd && p != null) { valorVest += qtd * p; itens.push([nome, qtd, sig(qtd * p)]); }
  }
  itens.sort((a, b) => b[2] - a[2]);
  const skills = Object.keys(f.bumpkin?.skills || {});
  // NFTs (colecionáveis) e vestíveis que se vendem no market: lista completa para filtrar e somar
  const vendaveis = [];
  for (const [nome, q] of Object.entries(inv)) if (Number(q) > 0 && M.cat[nome] === "colecionaveis") vendaveis.push(["c", nome, Number(q)]);
  for (const [nome, q] of Object.entries(guarda)) if (Number(q) > 0 && M.vest[nome] != null) vendaveis.push(["w", nome, Number(q)]);
  // redes sociais e verificação facial (o rosto "duplicado" já foi usado em outra fazenda)
  const face = f.faceRecognition?.history || [];
  let rosto = null;
  for (const e of face) { if (e.event === "succeeded") rosto = "ok"; else if (e.event === "failed" && rosto !== "ok") rosto = "falhou"; else if (e.event === "ownerChanged") rosto = "trocou_dono"; }
  const duplicado = face.some((e) => e.event === "duplicate");
  return {
    id: String(j.id), nome: f.username ?? null,
    banida: j.isBlacklisted ? 1 : 0, ban_status: f.ban?.status ?? null, social: f.ban?.isSocialVerified ? 1 : 0, verificada: f.verified ? 1 : 0,
    ultimo_save: Number(j.lastActivity ?? j.updatedAt) || null, criada_em: Number(f.createdAt) || null,
    xp: Math.round(xp), level: levelDe(xp), skills: skills.length, skills_lista: skills,
    legacy: NOMES.legacy.filter((n) => Number(inv[n]) > 0),
    ilha: f.island?.type ?? null, expansoes: Number(inv["Basic Land"]) || 0, faccao: f.faction?.name ?? null,
    vip_ate: Number(f.vip?.expiresAt) || null,
    flower: sig(Number(f.balance) || 0), coins: Math.round(Number(f.coins) || 0), gems: Math.round(Number(inv.Gem) || 0),
    vestiveis: vestN, colecionaveis: Object.keys(f.collectibles || {}).reduce((s, k) => s + (f.collectibles[k]?.length || 0), 0),
    valor_nft: sig(valorNft), valor_recursos: sig(valorRecursos), valor_vestiveis: sig(valorVest), top_itens: itens.slice(0, 8),
    vendaveis,
    captcha_falhas: soma(/Captcha Failed$/), captcha_ok: soma(/Captcha Succeeded$/),
    discord: f.discord?.connected ? (f.discord.verified ? 2 : 1) : 0, telegram: f.telegram?.linkedAt ? 1 : 0, twitter: f.twitter?.linkedAt ? 1 : 0,
    rosto, rosto_duplicado: duplicado ? 1 : 0,
  };
}

async function manifestoAll() {
  const m = await api("/community/data?type=nightlyDump");
  const tipo = process.env.VENDA_ARQUIVO || "all"; // "active" (só quem jogou em 90 dias) para testes rápidos
  return ((m?.data) || []).filter((f) => f.filename.endsWith(`/${tipo}.jsonl.gz`)).map((f) => ({ dia: f.filename.slice(0, 10), arquivo: f.filename })).sort((a, b) => a.dia.localeCompare(b.dia)).pop() || null;
}

async function lerArquivo(arquivo, nfts, M) {
  const res = await fetch(`${ARQUIVOS}/${arquivo}`);
  if (!res.ok) throw new Error(`${arquivo}: HTTP ${res.status}`);
  // linhas lidas no ritmo do processamento (o readline do Node 22 deixa o arquivo inteiro acumular na memória)
  async function* linhasDe(fluxo) {
    fluxo.setEncoding("utf8");
    let resto = "";
    for await (const pedaco of fluxo) { const p = (resto + pedaco).split("\n"); resto = p.pop(); for (const l of p) yield l; }
    if (resto) yield resto;
  }
  const linhas = linhasDe(Readable.fromWeb(res.body).pipe(zlib.createGunzip()));
  const achadas = {};
  let lidas = 0;
  for await (const l of linhas) {
    lidas++;
    const m = /"nftId":"?(\d+)/.exec(l.slice(0, 120));
    if (!m || !nfts.has(m[1])) continue;
    achadas[m[1]] = { ...resumo(JSON.parse(l), M), fonte: "arquivo", checado_em: null };
  }
  console.log(`${arquivo}: ${lidas} fazendas lidas, ${Object.keys(achadas).length} anunciadas encontradas.`);
  return achadas;
}

async function main() {
  const M = precosDoMarket();
  const lista = await anuncios();
  const cot = await cotacoes();
  const cache = fs.existsSync(CACHE) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(CACHE))) : { dia: "", fazendas: {} };

  // Arquivo diário novo -> relê os dados de todas as anunciadas.
  const all = await manifestoAll();
  if (all && all.dia > cache.dia) {
    // também as fazendas das carteiras que negociam FLOWER (terminal /sfl/)
    const arqCart = new URL("estado/sfl-carteiras.json", RAIZ), arqFaz = new URL("estado/sfl-fazendas.json", RAIZ);
    const nftsTerminal = new Set(Object.values(fs.existsSync(arqCart) ? JSON.parse(fs.readFileSync(arqCart, "utf8")) : {}).map((c) => c.nft).filter(Boolean));
    const nfts = new Set([...lista.keys(), ...Object.keys(cache.fazendas), ...nftsTerminal]);
    const novos = await lerArquivo(all.arquivo, nfts, M);
    if (nftsTerminal.size) {
      const faz = fs.existsSync(arqFaz) ? JSON.parse(fs.readFileSync(arqFaz, "utf8")) : {};
      for (const n of nftsTerminal) if (novos[n]) faz[n] = { id: novos[n].id, nome: novos[n].nome, banida: novos[n].banida, st: novos[n].ban_status, em: Date.now() };
      fs.writeFileSync(arqFaz, JSON.stringify(faz));
      for (const n of nftsTerminal) if (!lista.has(n)) delete novos[n]; // não são anúncios
    }
    for (const [nft, d] of Object.entries(novos)) {
      const ant = cache.fazendas[nft];
      // mantém a reconferência da API se for mais nova que o arquivo
      if (ant?.checado_em && ant.checado_em > Date.parse(all.dia + "T22:00:00Z")) Object.assign(d, { banida: ant.banida, ban_status: ant.ban_status, checado_em: ant.checado_em });
      cache.fazendas[nft] = d;
    }
    cache.dia = all.dia;
    // marca o dia relido: a rotina só salva o cache no repositório quando este arquivo muda (1x por dia)
    fs.mkdirSync(new URL("estado/", RAIZ), { recursive: true });
    fs.writeFileSync(new URL("estado/venda-dia.txt", RAIZ), all.dia + "\n");
  }
  // Só guarda o que ainda está anunciado.
  for (const nft of Object.keys(cache.fazendas)) if (!lista.has(nft)) delete cache.fazendas[nft];

  // Reconferência pela API (as checadas há mais tempo primeiro).
  const fila = [...lista.keys()].filter((n) => cache.fazendas[n]?.id).sort((a, b) => (cache.fazendas[a].checado_em || 0) - (cache.fazendas[b].checado_em || 0)).slice(0, CHECAR);
  let mudou = 0;
  for (const nft of fila) {
    const j = await api(`/community/farms/${cache.fazendas[nft].id}`);
    if (!j?.farm) continue;
    const novo = resumo({ ...j, lastActivity: j.updatedAt }, M);
    if (novo.banida !== cache.fazendas[nft].banida) mudou++;
    cache.fazendas[nft] = { ...cache.fazendas[nft], ...novo, fonte: "api", checado_em: Date.now() };
  }
  console.log(`API: ${fila.length} reconferidas, ${mudou} mudaram de situação de ban.`);

  // Quantas fazendas cada carteira está vendendo.
  const porVendedor = {};
  for (const a of lista.values()) porVendedor[a.vendedor] = (porVendedor[a.vendedor] || 0) + 1;

  const fazendas = [...lista.entries()].map(([nft, a]) => {
    const c = cot[a.moeda] || null;
    return { nft, ...a, preco: sig(a.preco), usd: c ? sig(a.preco * c.usd) : null, brl: c ? sig(a.preco * c.brl) : null, anuncios: a.n, n: undefined,
      vendedor_qtd: porVendedor[a.vendedor], ...(cache.fazendas[nft] || { sem_dados: 1 }) };
  });
  // Itens vendáveis (NFTs e vestíveis) num dicionário único: cada fazenda guarda [índice, quantidade].
  const dic = [], idx = new Map();
  for (const f of fazendas) {
    if (!f.vendaveis) continue;
    let valor = 0;
    f.it = f.vendaveis.map(([t, nome, q]) => {
      const chave = t + ":" + nome;
      if (!idx.has(chave)) { idx.set(chave, dic.length); dic.push([nome, t, t === "w" ? M.vest[nome] ?? null : M.col[nome] ?? null]); }
      const p = dic[idx.get(chave)][2];
      if (p != null) valor += p * q;
      return [idx.get(chave), q];
    });
    f.valor_vendavel = sig(valor); // FLOWER, pelo preço atual do market
    delete f.vendaveis; delete f.top_itens;
  }
  fs.mkdirSync(new URL("./", SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, JSON.stringify({ atualizado_em: new Date().toISOString(), arquivo_do_dia: cache.dia, flower_usd: M.flowerUsd, contrato: CONTRATO, cotacoes: cot, legacy: NOMES.legacy, itens: dic, fazendas }));
  fs.mkdirSync(new URL("./", CACHE), { recursive: true });
  fs.writeFileSync(CACHE, zlib.gzipSync(JSON.stringify(cache)));
  const ban = fazendas.filter((f) => f.banida).length, sem = fazendas.filter((f) => f.sem_dados).length;
  console.log(`Saída: ${fazendas.length} fazendas (${ban} banidas, ${sem} sem dados do jogo ainda).`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
