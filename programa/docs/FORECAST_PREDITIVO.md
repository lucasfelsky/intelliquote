# Forecast preditivo - fase 0 (biblioteca de metodos + backtest + CLI local)

Versao do modelo: `p0.1.0` (`PREDITIVO_VERSAO`). Modo sombra: **nada aqui altera o calculo da planilha**
(`forecastEngine.ts`), o relatorio de compras, o XLSX, o banco ou a UI. Sao funcoes puras em
`src/utils/forecastPreditivo*.ts` e um CLI que so escreve em stdout/stderr. O motor e importado apenas pelo teste de
paridade.

## Como rodar

Na pasta `programa` (o `node_modules` do worktree pode nao ter `.bin`; por isso `node <pacote>` em vez de `npx`):

```
node node_modules/ts-node-dev/lib/bin.js --transpile-only --quiet scripts/forecast-preditivo-backtest.ts --entrada C:\dados\series.csv
```

- `--quiet` e obrigatorio: sem ele o ts-node-dev imprime `[INFO]` em stdout e suja o JSON.
- O script tem try/catch total. Excecao nao capturada deixa o ts-node-dev pendurado (modo watch); se um comando nao
  voltar em 60 s, mate o processo `node`.
- Codigos de saida: `0` ok, `1` erro inesperado, `2` entrada ou opcao invalida / caminho recusado.

| Argumento | Padrao | Observacao |
|---|---|---|
| `--entrada <arquivo>` | obrigatorio (ou `--quinzena`) | `.csv` ou `.json`, ate 20 MB |
| `--quinzena <arquivo.json>` | - | formato da fixture de quinzena: uma serie por produto (J..N + O) |
| `--horizonte` | 6 | 1 a 12 |
| `--min-treino` | 6 | meses validos antes da 1a origem |
| `--metodos a,b` | todos | ids de `METODO_IDS` |
| `--lead-time-padrao` | 90 | dias, para serie sem `leadTimeDias` |
| `--razao-falta-excesso` | 3 | custo de falta = razao x custo de excesso |
| `--sem-mascara` | desligado | ignora atipico/ruptura (comparar vazamento) |
| `--formato texto\|json` | texto | so stdout |
| `--detalhe` | desligado | tabela por serie, com os ids como vieram na entrada |

**Dado real fica fora do repositorio.** O CLI recusa (codigo 2) qualquer arquivo sob um diretorio que tenha `.git`
(inclui este worktree e o checkout principal), com uma unica excecao: `programa/tests/fixtures/` (dado sintetico ou
anonimizado). Nunca escreve em disco. Com `--detalhe` o relatorio traz os ids como vieram: nao cole em lugar publico.

## Formato de entrada

CSV (cabecalho obrigatorio; separador `;` ou `,` detectado no cabecalho; com `;` a quantidade aceita `120,5` ou `120.5`):

```
serie;anoMes;quantidade;atipico;ruptura;fonte;familia;leadTimeDias
S001;2024-01;120,5;0;0;F01;FAM1;90
```

Colunas opcionais: `atipico` e `ruptura` (`0`/`1`, vazio = 0), `fonte`, `familia`, `leadTimeDias` (inteiro 0..3650; vale o
primeiro valor da serie). JSON: `{ "series": [ { "id", "fonte?", "familia?", "leadTimeDias?", "pontos": [ { "anoMes",
"qtd", "atipico?", "ruptura?" } ] } ] }`. Linha rejeitada vira `linha N: <motivo>` (nunca o valor) e e contada no
cabecalho do relatorio. Limites: 5.000 series e 240 pontos por serie.

## Serie mensal

- Calendario global: mes presente em alguma serie. Mes ausente de uma serie e presente no calendario = venda 0, **so a
  partir do primeiro mes da propria serie** (serie nova nao ganha zeros antes de existir).
- Mes que nenhuma serie tem = lacuna: vale so o trecho final (aviso `lacuna-cortada`).
- Duplicado soma (`mes-duplicado-somado`); negativo vira 0 (`negativo-zerado`).
- Mascara: `atipico` sempre; `ruptura` so se a venda ficou abaixo da media dos ate 3 meses anteriores nao mascarados.
  Mascarado sai das medias, nao atualiza o SES, so avanca o Holt e sai da sequencia do Croston/SBA.
- `degrau-nivel`: medias das duas metades com razao > 20 (ex.: troca de unidade). So avisa.

## Metodos (minimo de meses validos)

`planilha-q` (MA3, 1), `planilha-r` (MA6, 1), `ingenuo` (1), `ingenuo-sazonal` (13), `media-ponderada` 3-2-1 (3), `ses`
(4), `holt` (8), `holt-amortecido` (8), `croston` e `sba` (2 meses com venda). Parametros em grade fixa, escolhidos pelo
menor SSE de 1 passo in-sample (empate: primeiro da grade); sem otimizador. O SBA usa o alfa escolhido para o Croston.
`planilha-q` e `planilha-r` reproduzem Q e R do motor (teste de paridade nas 338 linhas da fixture 10-2).

## Backtest e relatorio

Origem movel por serie: cada mes com >= `min-treino` meses validos e ao menos 1 mes realizado depois. Comparacao com a
planilha Q sempre na intersecao (serie, origem) em que os dois deram resposta. Metricas: WAPE (h1, h3 e lead time),
viés, MAE e custo no lead time (horizonte = min(H, ceil(LT/30) + 1)). Segmentos: TOTAL, ABC, SBC e ABC/SBC. A cobertura
de intervalo esta implementada, mas na fase 0 nenhum metodo fornece p10/p90 (`n/a`).

Criterios de promocao (avaliados, **sem efeito**): 1 amostra, 2 WAPE, 3 viés, 4 custo, 5 vitoria; o 6 (itens A piores)
so lista ids com `--detalhe`; 7 (intervalo) n/a e 8 (2 rodadas) pendentes. Na fase 0 o maximo e `candidato`.
`contagem`: `comPrevisao` = series com ao menos 1 origem; `historicoCurto` = series sem origem; `semVenda` = serie toda
zero (as categorias podem se sobrepor).

## Fora da fase 0

TSB, intervalos empiricos, combinacoes, Holt-Winters/ETS, sazonalidade em pool, detector de atipicos, service, rota, UI e
migration ficam para as fases seguintes.
