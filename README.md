# Sunflower Land - Painéis

Site: https://pikachupus.github.io/ — banidas, preços do market, fazendas à venda e (em breve) terminal.
Tudo vem do próprio jogo (Community API), da OpenSea e do CoinGecko, atualizado sozinho pelo GitHub Actions.

**Rotina única:** `.github/workflows/site.yml`, de hora em hora. Roda as três partes em sequência
(se uma falhar, as outras publicam mesmo assim), publica o site direto no GitHub Pages e só salva
no repositório o histórico, no máximo uma vez por dia.

| Parte | Coletor | O que faz |
|---|---|---|
| Banidas (`docs/banidas/`) | `coletar.mjs` | Arquivo diário oficial (`nightlyDump`, ativas): quem foi banido e desbanido no dia. Só trabalha quando sai um arquivo novo. |
| Preços (`docs/prices/`) | `precos.mjs` | Relatório do market (`marketplaceActivity`, histórico desde 10/12/2025): preço, maior oferta, última venda, volume. Cotação diária do FLOWER em US$ e R$ pelo CoinGecko. |
| Fazendas à venda (`docs/fazendas/`) | `venda.mjs` | Anúncios da OpenSea (coleção `sunflower-land`, Polygon) conferidos no arquivo completo do jogo (1x por dia) e na API do jogo (60 fazendas por hora): banimento, último save, level, skills legacy, ilha, VIP, dono e valor dos itens. |

**Histórico no repositório:** `docs/data/dias.json`, `docs/data/novas/`, `docs/data/precos/mes/`, `estado/`.
Os dados "ao vivo" (`agora.json`, `cotacoes.json`, `fazendas.json`) vão só para o site.

**Nomes dos itens, tabela de level e insígnias legacy:** `estado/nomes.json`, gerado por
`ferramentas/gerar-nomes.mjs` a partir da biblioteca e do código aberto do jogo.

**Segredos** (Settings > Secrets and variables > Actions): `SFL_API_KEY` e `OPENSEA_API_KEY`.
