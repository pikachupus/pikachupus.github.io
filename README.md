# Sunflower Land - Banidas e Preços

Dois painéis atualizados sozinhos pelo GitHub Actions, com dados do próprio jogo (Community API). As páginas ficam em `docs/`.

**Fazendas banidas** (`docs/index.html`)
- Rotina: `.github/workflows/coletar.yml` (todo dia 23:30 UTC).
- Coletor: `coletar.mjs`. Baixa o arquivo diário oficial (`type=nightlyDump`) com todas as fazendas ativas, compara com o dia anterior e publica quem foi banido e desbanido.
- Dados: `docs/data/dias.json`, `docs/data/novas/` e `estado/ultimo.json.gz`.
- O jogo não informa data nem motivo do ban; a página mostra status do ban, idade da conta, captcha, verificação social e VIP.

**Preços do market** (`docs/precos.html`)
- Rotina: `.github/workflows/precos.yml` (4 vezes por dia).
- Coletor: `precos.mjs`. Lê o relatório diário do market (`type=marketplaceActivity`, com histórico desde dez/2025): floor, maior oferta, última venda, volume e negociações de cada item.
- Dados: `docs/data/precos/` (situação atual e histórico por mês e categoria) e `estado/precos/` (resposta bruta de cada dia).
- Nomes dos itens: `estado/nomes.json`, gerado da biblioteca do jogo por `ferramentas/gerar-nomes.mjs`.

**Fazendas à venda** (`docs/venda.html`)
- Rotina: `.github/workflows/venda.yml` (4 vezes por dia).
- Coletor: `venda.mjs`. Lê os anúncios da OpenSea (coleção `sunflower-land`, Polygon) e confere cada fazenda no arquivo diário completo do jogo (`all.jsonl.gz`) e, ao longo do dia, na API do jogo (`/community/farms/{id}`): banimento, último save, level, skills e insígnias legacy, ilha, VIP, saldo e valor dos itens pelo preço do market.
- Dados: `docs/data/venda/fazendas.json` e `estado/venda.json.gz`.

Segredos (Settings > Secrets and variables > Actions): `SFL_API_KEY` (as três rotinas) e `OPENSEA_API_KEY` (fazendas à venda).
