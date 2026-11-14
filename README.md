# Sunflower Land - Fazendas Banidas

Todo dia o GitHub Actions baixa o arquivo diário oficial do jogo (Community API, `type=nightlyDump`)
com todas as fazendas ativas, compara com o dia anterior e publica quem foi banido e desbanido. A página fica em `docs/`.

- Rotina: `.github/workflows/coletar.yml` (todo dia 23:30 UTC; ou "Run workflow" na aba Actions).
- Coletor: `coletar.mjs` (precisa do segredo `SFL_API_KEY`).
- Dados: `docs/data/` (resumo por dia e banidas de cada dia) e `estado/` (ids do último dia).

O jogo não informa data nem motivo do ban; a página mostra o que o arquivo traz: status do ban,
idade da conta, captcha, verificação social e VIP.
