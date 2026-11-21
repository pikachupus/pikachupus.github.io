// xp.mjs -- "e se" de XP de uma fazenda, com as funções reais do jogo (ferramentas/xp-lib.mjs).
//
//   potencial: XP que o Bumpkin ganharia comendo TODA a comida do inventário agora,
//              com os bônus que a fazenda tem (getFoodExpBoost, o mesmo que o jogo usa ao comer)
//   bonus:     nomes dos bônus de XP de comida ativos (NFTs, vestíveis, skills, VIP, buds, pet)
//   asc/nivel: ascensão e nível dentro da ascensão (ex.: A5 L50)
//
// xp-lib.mjs é gerado do código aberto do jogo (sfl-terminal/tools/build-game-lib com entry de XP);
// regenere quando o jogo mudar comidas ou bônus.

import { getFoodExpBoost, CONSUMABLES, FISH_CONSUMABLES, getAscensionLevel } from "./ferramentas/xp-lib.mjs";

// comidas de cada tipo, para descobrir os bônus mesmo de quem está sem comida no inventário
const AMOSTRAS = (() => {
  const nomes = Object.keys(CONSUMABLES);
  const achar = (f) => nomes.find((n) => f(CONSUMABLES[n], n));
  return [
    achar((c, n) => !(n in FISH_CONSUMABLES) && c.building === "Deli"),
    achar((c, n) => !(n in FISH_CONSUMABLES) && c.building === "Smoothie Shack"),
    achar((c, n) => n in FISH_CONSUMABLES),
    achar((c, n) => /Cake$/.test(n)),
    achar((c, n) => /Honey/.test(n) || c.ingredients?.Honey),
    achar((c, n) => c.ingredients?.Cheese),
    "Fermented Carrots",
    achar((c, n) => /^Aged |^Prime Aged /.test(n)),
  ].filter((n) => n && CONSUMABLES[n]);
})();

// A conversão completa do jogo (makeGame) leva ~150 ms por fazenda e não entra no pacote. O XP de comida
// só lê estes campos, todos usados como vêm da API, menos o inventário (só o "Lifetime Farmer Banner" é
// consultado como número decimal, para o VIP vitalício). Conferido igual ao makeGame em fazendas reais.
const dec = (v) => { const n = Number(v) || 0; return { gt: (x) => n > Number(x), toNumber: () => n }; };
function minima(f) {
  return {
    ...f,
    inventory: { "Lifetime Farmer Banner": dec(f.inventory?.["Lifetime Farmer Banner"]) },
    collectibles: f.collectibles || {},
    home: { ...(f.home || {}), collectibles: f.home?.collectibles || {} },
    farmHands: { bumpkins: f.farmHands?.bumpkins || {} },
    petHouse: { ...(f.petHouse || {}), pets: f.petHouse?.pets || {} },
    buds: f.buds || {},
  };
}

export function xpDaFazenda(farmBruta, agora = Date.now()) {
  const game = minima(farmBruta);
  const inventario = farmBruta.inventory || {};
  const exp = Number(game.bumpkin?.experience) || 0;
  const ascensao = Number(game.island?.ascensionLevel) || 0;
  let potencial = 0;
  const bonus = new Set();
  for (const [nome, qtd] of Object.entries(inventario)) {
    const food = CONSUMABLES[nome];
    const q = Number(qtd);
    if (!food || !(q > 0)) continue;
    const { boostedExp, boostsUsed } = getFoodExpBoost({ food, game, createdAt: agora });
    potencial += Number(boostedExp) * q;
    for (const b of boostsUsed) bonus.add(b.name);
  }
  for (const nome of AMOSTRAS) {
    try { for (const b of getFoodExpBoost({ food: CONSUMABLES[nome], game, createdAt: agora }).boostsUsed) bonus.add(b.name); } catch {}
  }
  let nivel = null;
  try { nivel = getAscensionLevel({ experience: exp, ascensionLevel: ascensao }).level; } catch {}
  return { exp, potencial: Math.round(potencial), bonus: [...bonus], asc: ascensao, nivel };
}
