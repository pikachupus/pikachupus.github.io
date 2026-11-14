// precos.mjs -- preços diários de tudo que se negocia no market do Sunflower Land.
//
// Fonte única: Community API do jogo, type=marketplaceActivity[&date=AAAA-MM-DD]. Para cada dia ela
// devolve, por item, floor (anúncio mais barato), bestOffer (maior oferta), latestSale (última venda),
// volume e trades ACUMULADOS desde sempre, listingCount e offerCount; e o preço do FLOWER em dólar.
// O volume do dia = acumulado do dia - acumulado do dia anterior. Preços em FLOWER por unidade.
//
// Saída (lida por docs/precos.html):
//   docs/data/precos/agora.json               situação atual de cada item (+ variação e mini-gráfico)
//   docs/data/precos/flower.json              preço do FLOWER em dólar por dia (acumulado desde que a coleta começou)
//   docs/data/precos/mes/AAAA-MM/{cat}.json   histórico diário por mês e categoria (só dias fechados)
//   estado/precos/AAAA-MM-DD.json.gz          resposta bruta de cada dia (pra reconstruir tudo)
//   estado/nomes.json                         id -> nome (gerado da biblioteca do jogo, ferramentas/gerar-nomes.mjs)
//
// Uso: SFL_API_KEY=sfl.xxx node precos.mjs   (opcional PRECOS_INICIO=AAAA-MM-DD)

import fs from "node:fs";
import zlib from "node:zlib";

const API = "https://api.sunflower-land.com";
const INICIO = process.env.PRECOS_INICIO || "2025-12-01"; // o market do jogo tem relatório desde dez/2025 (dias vazios são pulados)
const ESPERA_MS = 5200; // a API aceita ~1 consulta a cada 5 s
const RAIZ = new URL("./", import.meta.url);
const BRUTO = new URL("estado/precos/", RAIZ);
const SAIDA = new URL("docs/data/precos/", RAIZ);
const NOMES = JSON.parse(fs.readFileSync(new URL("estado/nomes.json", RAIZ), "utf8"));
const CATEGORIAS = ["crops", "flores", "recursos", "peixes", "colecionaveis", "vestiveis", "buds", "pets"];

const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const diaUTC = (d) => d.toISOString().slice(0, 10);
const somaDias = (dia, n) => diaUTC(new Date(Date.parse(dia + "T00:00:00Z") + n * 864e5));
const sig = (v) => (v == null || !isFinite(v) ? null : Number(Number(v).toPrecision(5)));
const gravar = (u, v) => { fs.mkdirSync(new URL("./", u), { recursive: true }); fs.writeFileSync(u, JSON.stringify(v)); };

let ultimaConsulta = 0;
async function consultar(dia) {
  const chave = process.env.SFL_API_KEY;
  if (!chave) throw new Error("Falta a variável SFL_API_KEY (segredo do repositório).");
  const falta = ultimaConsulta + ESPERA_MS - Date.now();
  if (falta > 0) await dormir(falta);
  for (let tentativa = 1; ; tentativa++) {
    ultimaConsulta = Date.now();
    const r = await fetch(`${API}/community/data?type=marketplaceActivity${dia ? "&date=" + dia : ""}`, { headers: { "x-api-key": chave } });
    if (r.ok) {
      const d = (await r.json()).data || {};
      const chaveDia = Object.keys(d.reports || {})[0];
      const rep = chaveDia ? d.reports[chaveDia] : null;
      return rep && Object.keys(rep.items || {}).length ? { dia: chaveDia, flower: d.flowerPrice ?? null, totais: rep.totals || null, itens: rep.items, buscado_em: new Date().toISOString() } : null;
    }
    if (r.status === 401) throw new Error("HTTP 401: chave inválida ou VIP da fazenda dona vencido");
    if (tentativa >= 4) throw new Error(`marketplaceActivity ${dia || "hoje"}: HTTP ${r.status}`);
    await dormir(ESPERA_MS * tentativa * 2);
  }
}

const arqBruto = (dia) => new URL(`${dia}.json.gz`, BRUTO);
const lerBruto = (dia) => {
  if (!fs.existsSync(arqBruto(dia))) return null;
  const b = JSON.parse(zlib.gunzipSync(fs.readFileSync(arqBruto(dia))));
  b.itens = comColecoes(b.itens);
  return b;
};
const gravarBruto = (b) => { fs.mkdirSync(BRUTO, { recursive: true }); fs.writeFileSync(arqBruto(b.dia), zlib.gzipSync(JSON.stringify(b))); };

function identificar(chave, item) {
  const [tipo, id] = chave.split("-");
  if (tipo === "collectibles") {
    const [nome, cat] = NOMES.collectibles[id] || [`Item ${id}`];
    if (cat) return [nome, cat];
    const n = Number(id);
    if (n >= 600 && n < 700 && !(n >= 610 && n <= 613)) return [nome, "recursos"]; // 610-613 = galinhas NFT
    const loteMedio = item.trades ? (item.quantity || 0) / item.trades : 1;
    return [nome, loteMedio >= 1.5 ? "recursos" : "colecionaveis"];
  }
  if (tipo === "wearables") return [NOMES.wearables[id] || `Vestível ${id}`, "vestiveis"];
  if (tipo === "buds") return [id === "todos" ? "Buds (coleção inteira)" : `Bud #${id}`, "buds"];
  if (tipo === "pets") return [id === "todos" ? "Pets (coleção inteira)" : `Pet #${id}`, "pets"];
  return null; // economies (moedas de minijogos) ficam de fora
}
const individual = (k) => /^(buds|pets)-\d/.test(k); // NFT único: fica fora do histórico mensal

// Buds e pets são NFTs únicos (cada um negocia raramente): junta cada coleção numa linha só.
function comColecoes(itens) {
  const out = { ...itens };
  for (const tipo of ["buds", "pets"]) {
    const g = Object.entries(itens).filter(([k]) => k.startsWith(tipo + "-")).map(([, v]) => v);
    if (!g.length) continue;
    const min = (c) => { const v = g.map((x) => x[c]).filter((x) => x != null); return v.length ? Math.min(...v) : null; };
    const max = (c) => { const v = g.map((x) => x[c]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    const soma = (c) => g.reduce((s, x) => s + (x[c] || 0), 0);
    out[tipo + "-todos"] = { floor: min("floor"), bestOffer: max("bestOffer"), latestSale: null, volume: soma("volume"), trades: soma("trades"), quantity: soma("quantity"), listingCount: soma("listingCount"), offerCount: soma("offerCount") };
  }
  return out;
}
const precoDe = (i) => i?.floor ?? i?.latestSale ?? null;

// Linha diária de um item: [floor, bestOffer, latestSale, volumeDia, tradesDia, anúncios, ofertas]
function linha(i, ant) {
  const vol = ant ? Math.max(0, (i.volume || 0) - (ant.volume || 0)) : null;
  const tr = ant ? Math.max(0, (i.trades || 0) - (ant.trades || 0)) : null;
  return [sig(i.floor), sig(i.bestOffer), sig(i.latestSale), sig(vol), tr, i.listingCount ?? null, i.offerCount ?? null];
}

async function main() {
  const hoje = diaUTC(new Date());
  const ontem = somaDias(hoje, -1);

  // 1) Dias fechados que faltam (e "ontem" se foi buscado antes de o dia acabar).
  const faltam = [];
  for (let d = INICIO; d < hoje; d = somaDias(d, 1)) {
    if (!fs.existsSync(arqBruto(d))) faltam.push(d);
    else if (d === ontem && lerBruto(d).buscado_em < hoje + "T00:05") faltam.push(d);
  }
  const mesesMudados = new Set();
  console.log(`${faltam.length} dia(s) para buscar.`);
  for (const d of faltam) {
    const b = await consultar(d);
    if (!b) { console.log(`${d}: sem dados`); continue; }
    b.dia = d;
    gravarBruto(b);
    mesesMudados.add(d.slice(0, 7));
    console.log(`${d}: ${Object.keys(b.itens).length} itens, FLOWER $${b.flower}`);
  }
  const agoraBruto = await consultar(null);
  if (!agoraBruto) throw new Error("marketplaceActivity de hoje veio vazio");
  agoraBruto.itens = comColecoes(agoraBruto.itens);

  // 2) Histórico fechado em memória.
  const dias = fs.readdirSync(BRUTO).filter((n) => n.endsWith(".json.gz")).map((n) => n.slice(0, 10)).filter((d) => d < hoje).sort();
  const brutos = new Map(dias.map((d) => [d, lerBruto(d)]));
  const quem = {}; // chave -> [nome, categoria] (pela informação mais recente)
  for (const d of dias) for (const [k, i] of Object.entries(brutos.get(d).itens)) { const id = identificar(k, i); if (id) quem[k] = id; }
  for (const [k, i] of Object.entries(agoraBruto.itens)) { const id = identificar(k, i); if (id) quem[k] = id; }

  // 3) Arquivos por mês e categoria (só meses que mudaram, ou todos se ainda não existem).
  const meses = [...new Set(dias.map((d) => d.slice(0, 7)))];
  for (const mes of meses) {
    if (!mesesMudados.has(mes) && fs.existsSync(new URL(`mes/${mes}/crops.json`, SAIDA))) continue;
    const dm = dias.filter((d) => d.startsWith(mes));
    const porCat = Object.fromEntries(CATEGORIAS.map((c) => [c, {}]));
    dm.forEach((d, j) => {
      const atual = brutos.get(d).itens, ant = brutos.get(somaDias(d, -1))?.itens;
      for (const [k, i] of Object.entries(atual)) {
        if (!quem[k] || individual(k)) continue;
        const serie = (porCat[quem[k][1]][k] ||= Array(dm.length).fill(null));
        serie[j] = linha(i, ant?.[k] || (ant ? {} : null));
      }
    });
    for (const c of CATEGORIAS) gravar(new URL(`mes/${mes}/${c}.json`, SAIDA), { mes, dias: dm, itens: porCat[c] });
  }

  // 4) Preço do FLOWER em dólar: a API só dá o valor atual (igual para qualquer data), então guardamos
  //    o de cada dia daqui pra frente (o último valor do dia fica).
  const arqFlower = new URL("flower.json", SAIDA);
  const flower = fs.existsSync(arqFlower) ? JSON.parse(fs.readFileSync(arqFlower, "utf8")).filter((x) => x[0] !== hoje) : [];
  if (agoraBruto.flower != null) flower.push([hoje, sig(agoraBruto.flower)]);
  gravar(arqFlower, flower);

  // 5) Situação atual de cada item.
  const ultimoFechado = brutos.get(dias[dias.length - 1])?.itens || {};
  const precoEm = (k, n) => precoDe(brutos.get(somaDias(hoje, -n))?.itens?.[k]);
  const itens = [];
  for (const [k, i] of Object.entries(agoraBruto.itens)) {
    if (!quem[k]) continue;
    const p = precoDe(i);
    const ant = ultimoFechado[k];
    const vol7 = ant && brutos.get(somaDias(hoje, -8))?.itens?.[k] ? (i.volume || 0) - brutos.get(somaDias(hoje, -8)).itens[k].volume : null;
    const varia = (n) => { const a = precoEm(k, n); return p != null && a ? sig((p / a - 1) * 100) : null; };
    const spark = [];
    for (let n = 30; n >= 1; n--) spark.push(sig(precoEm(k, n)));
    spark.push(sig(p));
    itens.push({
      k, n: quem[k][0], c: quem[k][1], p: sig(p), f: sig(i.floor), o: sig(i.bestOffer), s: sig(i.latestSale),
      l: i.listingCount ?? 0, q: i.offerCount ?? 0,
      v1: ant ? sig(Math.max(0, (i.volume || 0) - (ant.volume || 0))) : null, t1: ant ? Math.max(0, (i.trades || 0) - (ant.trades || 0)) : null,
      v7: vol7 == null ? null : sig(Math.max(0, vol7)), vt: sig(i.volume), ch1: varia(1), ch7: varia(7), ch30: varia(30), sp: spark,
    });
    const ult = itens[itens.length - 1];
    if (individual(k)) {
      if (!(ult.l > 0 || ult.v7 > 0)) itens.pop(); // NFT único parado: não entra na lista
      else { delete ult.sp; ult.u = 1; } // sem histórico mensal (só o valor atual)
    }
  }
  itens.sort((a, b) => (b.v7 || 0) - (a.v7 || 0));
  const totAnt = brutos.get(dias[dias.length - 1])?.totais;
  gravar(new URL("agora.json", SAIDA), {
    atualizado_em: agoraBruto.buscado_em, dia: hoje, primeiro_dia: dias[0], flower: sig(agoraBruto.flower),
    volume_hoje: totAnt && agoraBruto.totais ? sig(agoraBruto.totais.volume - totAnt.volume) : null,
    trades_hoje: totAnt && agoraBruto.totais ? agoraBruto.totais.trades - totAnt.trades : null,
    itens,
  });
  console.log(`agora: ${itens.length} itens; histórico ${dias[0]} a ${dias[dias.length - 1]} (${dias.length} dias).`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
