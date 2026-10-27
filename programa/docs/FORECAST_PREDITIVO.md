# Forecast preditivo - fase 0 + P1a (biblioteca de metodos + backtest + CLI local)

Versao do modelo: `p1.0.0` (`PREDITIVO_VERSAO`). Modo sombra: **nada aqui altera o calculo da planilha**
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
| `--min-treino` | 6 | meses validos antes da 1a origem (no p1 roda tambem o cenario 12, o principal) |
| `--metodos a,b` | todos | ids de `METODO_TODOS_IDS` (p1) ou `METODO_IDS` (`--relatorio p0`) |
| `--lead-time-padrao` | 90 | dias, para serie sem `leadTimeDias` |
| `--razao-falta-excesso` | 3 | custo de falta = razao x custo de excesso |
| `--sem-mascara` | desligado | ignora atipico/ruptura (comparar vazamento) |
| `--formato texto\|json` | texto | so stdout |
| `--detalhe` | desligado | tabela por serie, com os ids como vieram na entrada |
| `--relatorio p0\|p1` | p1 | p0 reproduz o relatorio da fase 0 |
| `--teto-vies <0..1>\|sem` | 0,10 | teto absoluto do criterio 3 (so no p1) |

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

## P1a (versao `p1.0.0`): combinacao, regras de protecao, intervalos e criterios D5 completos

A P1a acrescenta metodos e relatorio sem tocar o motor da planilha, o relatorio de compras nem o XLSX. A fase 0 continua
disponivel, byte a byte, com `--relatorio p0` (so a string da versao muda). O relatorio padrao e o P1.

**hashConfig.** O relatorio P1 usa `hashConfigP1()` = hash de `{ base: PREDITIVO_CONFIG, p1: PREDITIVO_CONFIG_P1 }`, entao
o `config` do cabecalho mudou em relacao a fase 0. `PREDITIVO_CONFIG` nao mudou: o modo p0 mantem o `hashConfig` antigo.
Mudou um valor de config ou de regra: sobe a versao (`PREDITIVO_VERSAO`).

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

- Criterio 3 com **teto absoluto parametrizavel** (`--teto-vies`, padrao 0,10; `sem` desliga): `|vies| <= teto` (se
  houver) e `|vies| <= |vies da planilha| + 2 p.p.`. O relatorio mostra sempre as duas variantes: `Falhos teto <x>` e
  `Falhos sem teto` (o criterio 8 usa a mesma variante). Com teto 0,10 os criterios 1-5 sao os da fase 0 (teste).
- O maximo continua `candidato`: nada e promovido (decisao de sombra e do dono do projeto).
- Colunas do relatorio (iguais a LEGENDA impressa): `M1`/`M2` = criterios 1-5 que falham em cada metade (`-` = nenhum);
  `Fallb` = pares em que o metodo nao deu previsao e usou a planilha Q; `Cobert` = cobertura de `[p10, p90]`;
  `Pinb10`/`Pinb90` = pinball de p10 e p90; `Falhos teto <x>` e `Falhos sem teto` = criterios que falham com e sem o teto
  de vies (`-` = nenhum). `Promovivel`: `referencia` (a propria planilha Q), `candidato` (passa 1-5, 7 e 8) ou
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
- `--relatorio p0` aceita as opcoes da fase 0 (inclusive `--metodos` com `METODO_IDS`); `--teto-vies` so vale no p1.

### Entrada por produto

O CSV ja aceita uma serie por produto: `serie` = id do produto, `leadTimeDias` e `fonte` por linha (vale o primeiro valor
nao vazio). **Nada muda no parser.** O mapa codigo -> produto e local, fora do repositorio. Linhas de varios codigos com o
mesmo `serie` e `anoMes` tambem sao somadas (aviso `mes-duplicado-somado`), mas o recomendado e agregar localmente.

## Fora da P1a

P1b: TSB e avaliacao da selecao de metodo por segmento (escolha na 1a metade, medida na 2a). P2: sazonalidade em pool,
Holt-Winters/ETS, detector de atipicos, intervalos por mes e em producao. Sem service, rota, UI, banco nem migration.
