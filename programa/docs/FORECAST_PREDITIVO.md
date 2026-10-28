# Forecast preditivo - fase 0 + P1a + P1b-1 (biblioteca de metodos + backtest + referencia + CLI local)

Versao do modelo: `p1.1.0` (`PREDITIVO_VERSAO`). Modo sombra: **nada aqui altera o calculo da planilha**
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
| `--min-treino` | 6 | meses antes da 1a origem: validos no p0/p1; de **calendario** no p1b (nao depende da mascara). No p1/p1b roda tambem o cenario 12, o principal |
| `--metodos a,b` | todos | ids de `METODO_TODOS_IDS` (p1) ou `METODO_IDS` (`--relatorio p0`) |
| `--lead-time-padrao` | 90 | dias, para serie sem `leadTimeDias` |
| `--razao-falta-excesso` | 3 | custo de falta = razao x custo de excesso |
| `--sem-mascara` | desligado | ignora atipico/ruptura (comparar vazamento) |
| `--formato texto\|json` | texto | so stdout |
| `--detalhe` | desligado | tabela por serie, com os ids como vieram na entrada |
| `--relatorio p0\|p1\|p1b` | p1 | p0 reproduz o relatorio da fase 0; p1b = referencia (secao P1b-1) |
| `--teto-vies <0..1>\|sem` | sem | teto absoluto **adicional** do criterio 3 (so no p1); sem a flag, o criterio 3 e relativo puro |

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

## P1a (nasceu na versao `p1.0.0`; hoje `p1.1.0`): combinacao, regras de protecao, intervalos e criterios D5 completos

A P1a acrescenta metodos e relatorio sem tocar o motor da planilha, o relatorio de compras nem o XLSX. A fase 0 continua
disponivel, byte a byte, com `--relatorio p0` (so a string da versao muda). O relatorio padrao e o P1.

**hashConfig.** O relatorio P1 usa `hashConfigP1()` = hash de `{ base: PREDITIVO_CONFIG, p1: PREDITIVO_CONFIG_P1 }`, entao
o `config` do cabecalho mudou em relacao a fase 0. `PREDITIVO_CONFIG` nao mudou: o modo p0 mantem o `hashConfig` antigo.
Mudou um valor de config ou de regra: sobe a versao (`PREDITIVO_VERSAO`). Excecao registrada: a decisao do Lucas de
2026-10-27 (criterio 3 relativo, abaixo) trocou `PREDITIVO_CONFIG_P1.criterios.tetoViesPadrao` de 0,10 para `null`, entao o
`hashConfig` do P1 mudou, mas a versao ficou `p1.0.0` porque a P1a ainda nao tinha sido mergeada (nunca houve relatorio P1 oficial).
O `hashConfig` do `--relatorio p0` nao mudou.

### Metodos novos e regras de protecao

- `combinacao-ses-r-holt`: media simples (pesos iguais) de SES, planilha R e Holt amortecido. Com 8+ meses validos usa os
  tres; com 4 a 7, so SES e R (o Holt amortecido pede 8); com menos de 4, `historico-curto`. Os avisos dos componentes
  sao herdados (ex.: `previsao-negativa-zerada`).
- `preditivo-p1`: escolhe o metodo por regra de protecao, **recalculada so com dados ate a origem** (na serie cortada;
  nunca pelo aviso `degrau-nivel` da serie inteira, que usa o futuro). Ordem (a do codigo, `regraProtecao`): 1 sem dados -> `curto` (planilha Q); 2 media dos ultimos 6 meses = 0 (inclui serie toda
  zero) -> `dormente` (planilha Q); 3 menos de 8 meses validos -> `curto`; 4 degrau de nivel (razao > 20 entre as metades) ->
  `degrau` (Holt amortecido); 5 senao `padrao` (combinacao). A regra 2 vem antes da 3: serie com 5 a 7 meses validos e 6 zeros
  finais cai em `dormente`, nao em `curto`. Um alvo sem
  previsao cai na planilha Q. Parametros em `PREDITIVO_CONFIG_P1.protecao` (`criarPreditivoP1(cfg)` aceita outra).

### Amostra comum e intervalos

- **Amostra comum.** Toda linha de metodo usa os mesmos pares (serie, origem) com lead time observado. O metodo que nao
  da previsao no par usa a planilha Q nesse par (fallback contado na coluna `Fallb` e em `amostra.fallbackPorMetodo`).
  Por isso o `n` e igual para todos os metodos de um segmento. Para os metodos da fase 0 sem fallback, as linhas TOTAL
  sao iguais as do backtest da fase 0 (teste).
- **Intervalos p10/p90 da soma no lead time**, sem vazamento: residuo do par = `(real - previsto) / (nivel medio dos 12
  ultimos meses x meses do lead time)`. Um residuo so vale para pares cuja origem seja >= ao ultimo mes realizado da
  janela dele. Pool por celula (SBC x meses do lead time); com menos de 30 residuos usa o pool TOTAL do mesmo prazo;
  com menos de 30 no TOTAL, sem intervalo. Quantil tipo 7; `p10 = max(0, previsto + q10 x escala)` (idem `p90`). Os
  quantis sao calculados uma vez por (mes, pool): custo ~ N log N. Relatorio: cobertura de `[p10, p90]` e pinball
  (soma da perda / soma do realizado) de p10 e p90; `nPoolTotal` conta os pares cujo intervalo veio do pool TOTAL.

### Criterios D5 1-8

1 amostra (>= 6 origens e >= 30 pares) | 2 WAPE LT <= 0,90 x planilha | 3 vies | 4 custo <= 0,95 x planilha | 5 vitoria >=
55% | 6 itens A piores (so listados) | 7 cobertura em [72%, 88%] com >= 30 pares com intervalo | 8 criterios 1-5 em **cada**
metade temporal das origens da amostra (k meses: os `floor(k/2)` primeiros e o resto; colunas `M1`/`M2`).

- **Criterio 3 relativo** (decisao do Lucas, 2026-10-27, no lugar do teto absoluto de 10%): o vies do metodo nao pode ser
  pior que o da planilha Q em mais de 2 pontos percentuais, em modulo, no mesmo segmento e na mesma janela:
  `|vies do metodo| <= |vies da planilha Q| + 0,02` (`C.promocao.viesFolga`), com vies = soma(previsto - real) / soma(real) sobre
  a amostra comum. Vale para vies positivo e negativo e tambem em cada metade temporal (criterio 8). Vies da Q indefinido
  (sem pares ou soma do realizado 0) vale 0; vies do metodo indefinido falha. Nao ha corte absoluto: com vies da Q de 0,29, um
  metodo com 0,30 passa. Os demais criterios nao mudaram (WAPE -10%, custo -5%, vitoria >= 55%, cobertura 72-88%, 2 rodadas).
- `--teto-vies <0..1>|sem` (padrao `sem`) e um modo opcional: com um numero acrescenta o corte `|vies| <= teto` ao criterio
  relativo (ex.: `--teto-vies 0,10` reproduz o criterio de antes da decisao, util para comparar). O cabecalho do relatorio mostra
  `teto absoluto de vies sem` ou o valor, e o JSON traz `opcoes.tetoVies` (`null` = sem). O relatorio nao mostra mais duas
  variantes: `Falhos` e `Promovivel` sao os do criterio relativo (mais o teto, se pedido); as chaves `criteriosFalhosSemTeto` e
  `promovivelSemTeto` do JSON deixaram de existir.
- **Legado da fase 0**: o criterio 3 da fase 0 (`PREDITIVO_CONFIG.promocao.viesMax` = 0,10: `|vies| <= 0,10` e `<= |vies Q| + 2 p.p.`)
  NAO mudou e continua valendo no `--relatorio p0`, cuja saida segue byte a byte a da fase 0 (so a string da versao muda).
- O maximo continua `candidato`: nada e promovido (decisao de sombra e do dono do projeto).
- Colunas do relatorio (iguais a LEGENDA impressa): `M1`/`M2` = criterios 1-5 que falham em cada metade (`-` = nenhum);
  `Fallb` = pares em que o metodo nao deu previsao e usou a planilha Q; `Cobert` = cobertura de `[p10, p90]`;
  `Pinb10`/`Pinb90` = pinball de p10 e p90; `Falhos` = criterios 1-5, 7 e 8 que falham (3 relativo; com teto absoluto so
  se `--teto-vies` foi dado; `-` = nenhum). `Promovivel`: `referencia` (a propria planilha Q), `candidato` (passa 1-5, 7 e 8) ou
  `nao (<criterios>)`, p. ex. `nao (1,3,7)` = falham os criterios 1, 3 e 7.

### Cenarios, segmentos e relatorio

- **Dois cenarios**: `min-treino 12` (principal, sempre) e o `--min-treino` pedido (padrao 6); se o pedido for 12, so um.
  Cenario sem nenhum par (serie curta) nao quebra: `linhas` vazias e a mensagem `Sem pares`.
- Segmentos (alem de TOTAL, ABC, SBC e ABC/SBC): `XYZ`; `LT` (`<=60`, `61-90`, `>90`, `padrao` = lead time nao
  informado); `FONTE` por **posto de volume** (`fonte-01..fonte-10`, `outras`, `sem-fonte`: o nome so sai com
  `--detalhe`); `REGRA` (`padrao`, `dormente`, `curto`, `degrau`). ABC `sem-venda` aparece como `sem venda >=6 meses`
  (ASCII: o console do PowerShell 5.1 corrompe o simbolo maior-ou-igual). Classe de lead time e fonte sao cadastro
  atual (vazamento de cadastro: so rotulam o segmento, nao entram na previsao).
- Aviso `lead-time-truncado`: o lead time pede mais meses do que o horizonte cobre (`max(1, ceil(LT/30)) + 1 > H`).
- Texto e JSON deterministicos e so ASCII; sem ids de serie nem nomes de fonte fora do `--detalhe`. JSON: topo `versao,
  hashConfig, hashEntrada, opcoes, cenariosMinTreino, linhasRejeitadas, cenarios` (+ `aviso`, `fontes` com detalhe).
- `--relatorio p0` aceita as opcoes da fase 0 (inclusive `--metodos` com `METODO_IDS`); `--teto-vies` so vale no p1
  (no p0 o criterio 3 e o legado, com teto fixo 0,10).

### Entrada por produto

O CSV ja aceita uma serie por produto: `serie` = id do produto, `leadTimeDias` e `fonte` por linha (vale o primeiro valor
nao vazio). **Nada muda no parser.** O mapa codigo -> produto e local, fora do repositorio. Linhas de varios codigos com o
mesmo `serie` e `anoMes` tambem sao somadas (aviso `mes-duplicado-somado`), mas o recomendado e agregar localmente.

## Fora da P1a

A referencia em todos os produtos veio na P1b-1 (secao abaixo). TSB e selecao de metodo por segmento ficam para a P1c. P2: sazonalidade em pool,
Holt-Winters/ETS, detector de atipicos, intervalos por mes e em producao. Sem service, rota, UI, banco nem migration.

## P1b-1 (versao `p1.1.0`): referencia em todos os produtos

Decisao do Lucas (2026-10-27): a previsao de referencia ("sombra") passa a ser a **combinacao SES + R + Holt amortecido em
todos os produtos**, com intervalos p10/p90 e custo de negocio completo. Continua modo sombra: `forecastEngine.ts`, o relatorio
de compras, o XLSX, o banco e a UI nao mudam. O `hashConfig` do p0 e do p1 **nao mudou**; so o relatorio p1b e a tabela de
calibracao usam `hashConfigRef()` (hash de `{ base, p1, ref }`).

### Regra da referencia (`previsaoBaseRef`, unico caminho do calculo)

Ordem das regras (a do codigo): 1 sem dados -> `sem-dados`, sem previsao; 2 media dos ultimos 6 meses = 0 -> `dormente`: planilha Q
(= 0) + `dormente-planilha`; 3 menos de 4 meses validos -> `curto`: planilha Q + `historico-curto-planilha`; 4 degrau de nivel
(razao > 20 entre as metades) -> Holt amortecido (pede 8 validos) + `degrau-holt`, ou planilha Q + `degrau-planilha`; 5 senao
`padrao`: combinacao, com **4 a 7 validos = SES + R (2 componentes)** e **8 ou mais = + Holt amortecido (3)**. Se ate a Q falhar
(todos os meses marcados), a serie fica sem previsao (`ok false`, `historico-curto-planilha`). A regra olha so a serie recebida
(no backtest, o treino da origem), nunca `degrau-nivel` da serie inteira. Avisos da referencia (ordem de `AVISO_REF_IDS`):
`historico-curto-planilha`, `dormente-planilha`, `degrau-holt`, `degrau-planilha`, `sem-calibracao`, `calibracao-incompativel`,
`sem-intervalo`, `correcao-sem-dados`, `correcao-no-limite`, `lead-time-padrao`, `lead-time-truncado`.

### API `preverReferencia(entradas, marcas, opcoes)` (funcao pura)

- `opcoes`: `horizonte` (6; 1 a 12), `leadTimePadraoDias` (90; 0 a 3650), `usarMascara` (true), `calibracao` (tabela ou `null`),
  `correcaoNivel` (false), `parametrosCorrecao`. Opcao invalida lanca `opcoes invalidas: ...`.
- Saida: `versao`, `hashConfig`, `hashCalibracao`, `calibracao` (`nenhuma`, `aplicada` ou `incompativel`), `opcoes`, `contagem`,
  `erros` e `series` (ordenadas por id). Por produto: `ok`, `regra`, `metodoUsado`, `componentes`, `origem`, `pontos` (h = 1..H com
  `p50`, `p10`, `p90`), `leadTime` (`dias`, `padrao`, `meses`, `truncado`, `p50`, `p10`, `p90`, `qHat`), `historico` (`meses`,
  `validos`, `mascarados`, `minimoExigido`, `minimoHolt`), `correcao`, `intervalo`, `parametros`, `avisos` e `avisosRef`.
- Lead time: `meses = min(H, max(1, ceil(dias/30)) + 1)`; `p50` do lead time = soma de `p50_1..p50_meses`; `qHat` = media dos
  primeiros `min(H, max(1, ceil(dias/30)))` meses (consumo diario medio = `qHat / 30`).

### Marcas de meses atipicos (`MarcasPorSerie`)

Mapa produto -> `yearMonth` marcados (espelho de `ForecastAtypicalMonth`). **So marcas reais mascaram** (D8): as flags `atipico` e
`ruptura` dos pontos de entrada sao ignoradas e contadas; a ruptura volta a ser discutida com o D7. Marca invalida, de produto
inexistente, repetida ou fora de `[1o mes da serie, ultimo mes do calendario]` nao se aplica e e contada; marca nunca cria mes no
calendario. Mes marcado sem linha na serie vira ponto 0 mascarado. A mascara e causal (`cortarAte` a corta junto). O mes marcado sai
do nivel do SES, so avanca o Holt, sai de Q e R e da escala do intervalo. No CLI, as marcas vem da coluna `atipico` do arquivo.

### Intervalos p10/p90 por tabela de calibracao

A tabela e **entrada** da previsao (em producao cada produto tem ~6-7 meses; calibrar no proprio lote deixaria h = 4..6 e o lead
time sem residuo). Ela e gerada pelo backtest local (`--gerar-calibracao`) e guarda **so agregados** adimensionais: quantis (tipo 7)
de residuos escalonados por celula (SBC x `m`; `m` = h no mensal e meses do lead time), contagens e a razao real/previsto. Nenhum id,
nome ou quantidade. Regras: celula com >= 30 residuos; senao o pool `TOTAL` do mesmo `m`; senao sem intervalo. `escala` = media dos
12 ultimos meses validos (x meses no lead time); `p = max(0, p50 + q x escala)`. So a combinacao tem intervalo (Q, Holt de degrau e
`curto` ficam sem, com `sem-intervalo`). Sem tabela: `sem-calibracao`; tabela de outro formato, `hashConfig` ou modo da correcao:
`calibracao-incompativel` (ignorada, nunca inventa intervalo). O p50 pode ficar fora de `[p10, p90]` (vies historico forte): nada e
forcado; e o sinal para a correcao. Leitura estrita: `lerTabelaCalibracao(texto)` e tudo-ou-nada, sem ecoar valor.

### Correcao de nivel (desligada por padrao)

`w = n / (n + k)`, `fator = clamp(1 + w x (razao - 1), fatorMin, fatorMax)` com `k` 300, limites 0,85 a 1,25, janela de 12 meses de
liberacao e minimo de 30 pares (abaixo disso, fator 1 e `correcao-sem-dados`; no limite, `correcao-no-limite`). Pool unico (TOTAL), razao
com a previsao **sem** correcao (o fator nao se realimenta), so na combinacao. Janela sem vendas (soma do realizado = 0) ou razao que arredonda a 0 em `round6`: `razao` = `null` (backtest, tabela e producao concordam; fator 1 e `correcao-sem-dados`), para a tabela gerada continuar legivel por `lerTabelaCalibracao`. Para ligar: `PREDITIVO_CONFIG_REF.correcaoNivel.ativaPorPadrao
= true`, versao minor (`p1.2.0`) e nova tabela (o `hashConfig` muda), so por decisao do Lucas a partir do relatorio p1b com dado real.

### Backtest da referencia, custo completo e criterio 7

- Variantes: `planilha-q`, `referencia`, `referencia-corrigida`, na **amostra comum** (pares com lead time observado). Elegibilidade por
  **meses de calendario** (a amostra e igual com e sem mascara e com qualquer `--historico-max`). Realizado **bruto**: o mes marcado
  continua contando no erro; residuos de janela com mes marcado ficam fora dos pools (`residuosExcluidosMascara`). Se a janela de treino
  de uma origem tem **todos** os meses marcados (venda > 0; ex.: `--historico-max 3`), a Q usa a media sem mascara (como o motor com
  `sem-mes-valido`) e a referencia cai na Q: o par **nao** e descartado e conta em `amostra.fallbackReferencia` (0 no uso normal).
- Sem vazamento: treino cortado (e truncado em `--historico-max`) na origem; pools e razao de nivel so com residuos liberados ate a
  origem (`liberacao = origem + m`).
- Custo em KG (sem preco), `custoH = razao x falta + excesso` por horizonte e no lead time (razao padrao 3); `custoRelH` contra a Q nos
  mesmos pares; `Rupt sim` = fracao dos pares com realizado no lead time > previsto + `qHat/30` x lead time (igualdade nao e ruptura).
  O criterio 4 nao mudou (custo no lead time); custo por horizonte e ruptura sao informativos. Por produto so com `--detalhe`.
- Criterio 7 na linha TOTAL de cada variante de referencia (cobertura do lead time em [72%, 88%] com >= 30 pares); a cobertura mensal
  (`Cobert mes`) e informativa. Campos herdados (WAPE, vies, vitoria, pinball, M1/M2, criterios 1-5, 7 e 8) sao os da P1a.

### CLI: `--relatorio p1b`

| Argumento | Padrao | Observacao |
|---|---|---|
| `--relatorio p0\|p1\|p1b` | p1 | p0/p1 delegam ao CLI da P1a com o argv intacto |
| `--historico-max <1..240\|tudo>` | tudo | so os ultimos n meses de treino em cada origem (simula a producao, ~7 meses) |
| `--gerar-calibracao` | desligado | saida = tabela JSON (ignora `--formato`; nao vale com `--detalhe`) |
| `--correcao-nivel <sim\|nao>` | nao | so com `--gerar-calibracao`: modo da tabela gerada |

As demais flags da P1a valem (`--entrada`, `--quinzena`, `--horizonte`, `--min-treino`, `--lead-time-padrao`, `--razao-falta-excesso`,
`--sem-mascara`, `--formato`, `--detalhe`, `--teto-vies`); `--metodos` nao vale no p1b. Flag propria da P1b com p0/p1: erro `so vale
com --relatorio p1b`. Valor invalido de `--relatorio`: `--relatorio deve ser p0, p1 ou p1b`.

```
node node_modules/ts-node-dev/lib/bin.js --transpile-only --quiet scripts/forecast-preditivo-backtest.ts --entrada C:\dados\series.csv --relatorio p1b --historico-max 7
```

Tabela de calibracao (sugestao: `--relatorio p1b --min-treino 6 --historico-max 7 --gerar-calibracao`): no PowerShell 5.1 grave com
`[IO.File]::WriteAllText(<arquivo>, <saida>)`, nunca com `>` (UTF-16). O CLI nunca escreve em disco. Texto: 1a linha `Forecast
preditivo - referencia P1b ...`, cabecalho (horizonte, cenarios, historico maximo, mascara, teto), `Marcas`, `Correcao de nivel`; por
cenario: contagens, `Amostra`, `Fator aplicado`, `Criterio 7 (TOTAL ...)`, tabela de segmentos x variantes, `Por horizonte (TOTAL)` e, com
`--detalhe`, `Por serie` e `Fontes`. JSON: topo `versao, hashConfig, hashEntrada, opcoes, cenariosMinTreino, linhasRejeitadas, marcas,
cenarios` (+ `aviso`, `fontes` com detalhe); a tabela nao sai no relatorio.

Formato da tabela de calibracao (`--gerar-calibracao`; JSON; lida por `lerTabelaCalibracao`, tudo-ou-nada: chave a mais ou a menos, ou valor fora da faixa, recusa a tabela inteira):

| Chave | Conteudo |
|---|---|
| `formato`, `versao`, `hashConfig` | `preditivo-calibracao-v1`; versao do codigo (`p1.1.0`); hash da config da referencia (outro hash = `calibracao-incompativel`) |
| `correcaoNivel` | `true` se gerada para o modo com correcao de nivel (modo diferente do da previsao = incompativel) |
| `parametros` | `horizonte`, `minTreino`, `historicoMaximo` (`null` = tudo), `usarMascara`, `janelaNivelMeses`; informativos, nao entram na compatibilidade |
| `ultimoMes` | `YYYY-MM`, ultimo mes do calendario da entrada |
| `mensal[]`, `leadTime[]` | celulas `{celula, m, n, q10, q90}`: `celula` = `smooth\|erratic\|intermittent\|lumpy\|insuficiente\|TOTAL`, `m` de 1 a 12 (h no mensal; meses do lead time), `n` residuos, `q10 <= q90` |
| `nivel` | `{n, razao}`: pares e razao soma(real)/soma(previsto) nos ultimos 12 meses de liberacao; `razao` > 0 ou `null` (sem dado ou sem vendas na janela) |

**A tabela gerada com dado real deriva de dado real** (quantis de residuos de vendas e contagens): **nao versionar neste repo publico** (R-14); onde guarda-la e decisao da P3. Os testes usam so `tabelaSintetica()`.

Limites conhecidos: (a) `hashConfig` cobre `PREDITIVO_CONFIG`, `PREDITIVO_CONFIG_P1` e `PREDITIVO_CONFIG_REF` (inclui os `k`, limites e `minPares` **padrao**); `parametrosCorrecao` customizados (so a API pura; o CLI nao os expoe) **nao** entram no `hashConfig` nem em `parametros`, entao uma tabela `correcaoNivel: true` gerada com outros `k`/limites (seus residuos usam o p50 corrigido) continua "compativel": nao a misture. Mudar o formato para cobri-los quebraria `preditivo-calibracao-v1`; decisao adiada. (b) `amostra.fallbackReferencia` so e > 0 no caso da janela de treino inteira marcada (ver Backtest); no uso normal e sempre 0 (ramo de defesa).

### Fora da P1b-1

Modo previsao do CLI e `--calibracao <arquivo>` (P1b-2); TSB e selecao de metodo por segmento (P1c); sazonalidade em pool, Holt-Winters/ETS
e detector de atipicos (P2); D7 (saldo de pedidos de venda e ruptura); service, rota, UI, leitura de `ForecastAtypicalMonth` e de
`ForecastMonthlySale` do banco, migration (P3/P4).
