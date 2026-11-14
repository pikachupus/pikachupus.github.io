// coletar.mjs -- fazendas banidas por dia no Sunflower Land, a partir do arquivo diário oficial.
//
// O jogo exporta todo dia (~22:00 UTC) todas as fazendas em JSONL.gz (Community API,
// type=nightlyDump; o arquivo baixa de community.sunflower-land.com sem chave). Cada linha:
// { id, nftId, farm, isBlacklisted, lastActivity }. Comparando com o dia anterior sai quem
// foi banido no dia. Usamos o arquivo "active" (jogaram nos últimos 90 dias).
//
// A API não informa data nem motivo do ban. Guardamos o que existe: ban.status, último save
// (lastActivity), idade da conta, XP, ilha, facção, captcha, verificação social e VIP.
//
// Saída (lida pela página em docs/):
//   docs/data/dias.json          resumo por dia
//   docs/data/novas/AAAA-MM-DD.json  fazendas banidas no dia
//   estado/ultimo.json.gz        ids do último dia (pra comparar com o próximo)
//
// Uso: SFL_API_KEY=sfl.xxx node coletar.mjs

import fs from "node:fs";
import zlib from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

const API = "https://api.sunflower-land.com";
const ARQUIVOS = "https://community.sunflower-land.com";
const DADOS = new URL("./docs/data/", import.meta.url);
const NOVAS = new URL("./docs/data/novas/", import.meta.url);
const ESTADO = new URL("./estado/ultimo.json.gz", import.meta.url);

const lerJson = (u, padrao) => (fs.existsSync(u) ? JSON.parse(fs.readFileSync(u, "utf8")) : padrao);
const gravarJson = (u, v) => fs.writeFileSync(u, JSON.stringify(v));

async function manifesto() {
  const chave = process.env.SFL_API_KEY;
  if (!chave) throw new Error("Falta a variável SFL_API_KEY (segredo do repositório).");
  const r = await fetch(`${API}/community/data?type=nightlyDump`, { headers: { "x-api-key": chave } });
  if (!r.ok) throw new Error(`manifesto: HTTP ${r.status}${r.status === 401 ? " (chave inválida ou VIP da fazenda dona vencido)" : ""}`);
  return ((await r.json()).data || [])
    .filter((f) => /\/active\.jsonl\.gz$/.test(f.filename))
    .map((f) => ({ dia: f.filename.slice(0, 10), arquivo: f.filename, modifiedAt: f.modifiedAt, size: f.size }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

function detalhes(j) {
  const f = j.farm || {}, fa = f.farmActivity || {};
  const soma = (re) => Object.keys(fa).filter((k) => re.test(k)).reduce((s, k) => s + (Number(fa[k]) || 0), 0);
  return {
    nft_id: j.nftId != null ? String(j.nftId) : null,
    username: f.username ?? null,
    ban_status: f.ban?.status ?? null,
    social_verified: f.ban?.isSocialVerified ? 1 : 0,
    verified: f.verified ? 1 : 0,
    criada_em: Number(f.createdAt) || null,
    ultima_atividade: Number(j.lastActivity) || null,
    xp: Number(f.bumpkin?.experience) || 0,
    ilha: f.island?.type ?? null,
    faccao: f.faction?.name ?? null,
    captcha_falhas: soma(/Captcha Failed$/),
    captcha_ok: soma(/Captcha Succeeded$/),
    coins: Number(f.coins) || 0,
    flower: Number(f.balance) || 0,
    vip_ate: Number(f.vip?.expiresAt) || null,
  };
}

// Lê o arquivo em streaming; só decodifica as linhas banidas.
async function lerArquivo(arquivo) {
  const res = await fetch(`${ARQUIVOS}/${arquivo}`);
  if (res.status === 403) return null; // expirou (só ficam 7 dias)
  if (!res.ok) throw new Error(`${arquivo}: HTTP ${res.status}`);
  const linhas = createInterface({ input: Readable.fromWeb(res.body).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  const presentes = new Set(), banidas = new Map();
  for await (const l of linhas) {
    if (!l) continue;
    const m = /^\{"id":(\d+)/.exec(l);
    const id = m ? m[1] : String(JSON.parse(l).id);
    presentes.add(id);
    if (l.slice(-200).includes('"isBlacklisted":true')) banidas.set(id, detalhes(JSON.parse(l)));
  }
  return { presentes, banidas };
}

async function main() {
  fs.mkdirSync(NOVAS, { recursive: true });
  fs.mkdirSync(new URL("./estado/", import.meta.url), { recursive: true });
  const dias = lerJson(new URL("dias.json", DADOS), []);
  let ant = fs.existsSync(ESTADO) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(ESTADO)).toString()) : null;
  const ultimo = ant ? ant.dia : "";
  const pendentes = (await manifesto()).filter((i) => i.dia > ultimo);
  if (!pendentes.length) { console.log("Nada novo no arquivo diário."); return; }

  for (const item of pendentes) {
    console.log(`${item.dia}: lendo ${item.arquivo} (${(item.size / 1e6).toFixed(0)} MB)...`);
    const lido = await lerArquivo(item.arquivo);
    if (!lido) { console.log(`${item.dia}: expirou no servidor — pulado.`); continue; }
    const { presentes, banidas } = lido;
    const antBanidas = ant ? new Set(ant.banidas) : null, antPresentes = ant ? new Set(ant.presentes) : null;
    const lista = [];
    let novas = 0, jaBanidas = 0, desbanidas = 0;
    if (ant) {
      for (const [id, d] of banidas) {
        if (antBanidas.has(id)) continue;
        const tipo = antPresentes.has(id) ? "nova" : "ja_banida";
        if (tipo === "nova") novas++; else jaBanidas++;
        lista.push({ id, tipo, ...d });
      }
      for (const id of antBanidas) if (presentes.has(id) && !banidas.has(id)) desbanidas++;
      gravarJson(new URL(`${item.dia}.json`, NOVAS), lista.sort((a, b) => (b.ultima_atividade || 0) - (a.ultima_atividade || 0)));
    }
    const resumo = {
      dia: item.dia, total_ativas: presentes.size, banidas_total: banidas.size,
      novas: ant ? novas : null, ja_banidas_entraram: ant ? jaBanidas : null, desbanidas: ant ? desbanidas : null,
      dia_anterior: ant ? ant.dia : null, exportado_em: item.modifiedAt,
    };
    const i = dias.findIndex((d) => d.dia === item.dia);
    if (i >= 0) dias[i] = resumo; else dias.push(resumo);
    dias.sort((a, b) => b.dia.localeCompare(a.dia));
    gravarJson(new URL("dias.json", DADOS), dias);
    ant = { dia: item.dia, presentes: [...presentes], banidas: [...banidas.keys()] };
    fs.writeFileSync(ESTADO, zlib.gzipSync(JSON.stringify(ant)));
    console.log(`${item.dia}: ${presentes.size} ativas, ${banidas.size} banidas` + (resumo.novas != null ? ` | novas ${novas}, desbanidas ${desbanidas}` : " | base de comparação"));
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
