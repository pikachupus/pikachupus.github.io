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

As duas rotinas precisam do segredo `SFL_API_KEY` (Settings > Secrets and variables > Actions).
