// Dados FICTICIOS dos exemplos do Manual (empresas, itens e valores inventados; os capitulos avisam com o selo "Exemplo fictício").
// Tudo tipado aqui para o texto dos capitulos ficar so no JSX.

// ---------- Capitulo 2: matriz de perfis ----------
export type Marca = 'sim' | 'nao' | 'ver' | 'parcial';

export const PERFIS = ['Admin', 'Comprador', 'Gestor', 'Viewer', 'Comercial'] as const;

export interface LinhaDePerfis {
  texto: string;
  // Na ordem de PERFIS.
  marcas: readonly [Marca, Marca, Marca, Marca, Marca];
}

// Conferida com as rotas (allowRoles) do backend; o gestor so GERA link novo e REVOGA links existentes nas cotacoes (por isso "parcial" na 2a linha).
export const MATRIZ_PERFIS: readonly LinhaDePerfis[] = [
  { texto: 'Consultar cotações, fornecedores, itens e relatórios', marcas: ['sim', 'sim', 'sim', 'sim', 'nao'] },
  { texto: 'Criar e editar cotações, enviar aos fornecedores, gerar links', marcas: ['sim', 'sim', 'parcial', 'nao', 'nao'] },
  { texto: 'Lançar resposta manual e enviar Ordem de Compra', marcas: ['sim', 'sim', 'nao', 'nao', 'nao'] },
  { texto: 'Definir a vencedora', marcas: ['sim', 'sim', 'sim', 'nao', 'nao'] },
  { texto: 'Fechar, concluir e reabrir cotações', marcas: ['sim', 'nao', 'sim', 'nao', 'nao'] },
  { texto: 'Aprovar adjudicação acima da alçada', marcas: ['sim', 'nao', 'sim', 'nao', 'nao'] },
  { texto: 'Cadastrar itens, famílias, fornecedores, documentos e forwarders', marcas: ['sim', 'sim', 'nao', 'nao', 'nao'] },
  { texto: 'Atender solicitações do Comercial', marcas: ['sim', 'sim', 'ver', 'ver', 'nao'] },
  { texto: 'Criar solicitações de cotação', marcas: ['nao', 'nao', 'nao', 'nao', 'sim'] },
  { texto: 'Editar o perfil da Empresa', marcas: ['sim', 'parcial', 'sim', 'nao', 'nao'] },
  { texto: 'Consultar a Auditoria', marcas: ['sim', 'nao', 'sim', 'nao', 'nao'] },
  { texto: 'Salvar templates de e-mail', marcas: ['sim', 'ver', 'ver', 'ver', 'nao'] },
  { texto: 'Gerenciar usuários', marcas: ['sim', 'nao', 'nao', 'nao', 'nao'] },
];

// ---------- Capitulo 3: indicadores do Overview ----------
export interface KpiDeExemplo {
  rotulo: string;
  valor: string;
  detalhe: string;
}

export const KPIS_OVERVIEW: readonly KpiDeExemplo[] = [
  { rotulo: 'Cotações', valor: '184', detalhe: '612 respostas recebidas' },
  { rotulo: 'Comparações', valor: '139', detalhe: 'taxa de adjudicação: 87%' },
  { rotulo: 'Fornecedores', valor: '96', detalhe: 'cadastrados e ativos' },
  { rotulo: 'Economia gerada', valor: 'US$ 412.900', detalhe: '6,8% em média por comparação' },
];

// ---------- Capitulo 5: itens de exemplo (os mesmos dos capitulos seguintes) ----------
export interface ItemDeExemplo {
  nomeComercial: string;
  nomeDeMercado: string;
  familia: string;
  ncm: string;
  dbcorp: string;
}

export const ITENS_DE_EXEMPLO: readonly ItemDeExemplo[] = [
  { nomeComercial: 'Ácido cítrico anidro', nomeDeMercado: 'Citric Acid Anhydrous', familia: 'Acidulantes', ncm: '29181400', dbcorp: 'MP-0187' },
  { nomeComercial: 'Benzoato de sódio', nomeDeMercado: 'Sodium Benzoate', familia: 'Conservantes', ncm: '29163100', dbcorp: 'MP-0233' },
];

// ---------- Capitulo 8: a cotacao de exemplo que acompanha o resto do manual ----------
export const COTACAO_DE_EXEMPLO = {
  codigo: 'COT-2026-0412',
  incoterms: ['FOB', 'CFR', 'CIF'],
  embarque: 'Shanghai',
  destino: 'Porto de Santos',
  moeda: 'USD',
  prazo: '31/10/2026',
  itens: [
    { nome: 'Ácido cítrico anidro', quantidade: '20.000 KG' },
    { nome: 'Benzoato de sódio', quantidade: '5.000 KG' },
  ],
} as const;

// PO agrupada: os dois itens do exemplo em 2 POs, mais a coluna "Sem PO" vazia.
export interface GrupoDePo {
  id: string;
  titulo: string;
  contagem: string;
  itens: readonly { nome: string; quantidade: string }[];
  // Texto da coluna vazia ("Sem PO").
  dica?: string;
  semPo?: boolean;
}

export const GRUPOS_DE_PO: readonly GrupoDePo[] = [
  { id: 'po1', titulo: 'PO 1 · Acidulantes', contagem: '1 item', itens: [{ nome: 'Ácido cítrico anidro', quantidade: '20.000 KG' }] },
  { id: 'po2', titulo: 'PO 2 · Conservantes', contagem: '1 item', itens: [{ nome: 'Benzoato de sódio', quantidade: '5.000 KG' }] },
  { id: 'sem-po', titulo: 'Sem PO', contagem: '0', itens: [], dica: 'Arraste para uma PO ou use “Mover”.', semPo: true },
];

// ---------- Capitulo 9: e-mail de envio e semana de lembretes ----------
export interface LinhaDeEmail {
  rotulo: string;
  // Enderecos (cada um vira uma pilula); o tipo muda a cor: principal (destinatario), primeiro (copia so no 1o e-mail do envio) ou comum.
  enderecos?: readonly { endereco: string; tipo: 'principal' | 'primeiro' | 'comum' }[];
  nota?: string;
  texto?: string;
}

export const EMAIL_DE_EXEMPLO: readonly LinhaDeEmail[] = [
  { rotulo: 'Para', enderecos: [{ endereco: 'mei.chen@lianyun-chem.example', tipo: 'principal' }], nota: 'contato principal' },
  {
    rotulo: 'Cc',
    enderecos: [
      { endereco: 'sales@lianyun-chem.example', tipo: 'comum' },
      { endereco: 'export@lianyun-chem.example', tipo: 'comum' },
    ],
    nota: 'demais contatos, em todos os e-mails',
  },
  { rotulo: 'Cc', enderecos: [{ endereco: 'comex@sqquimica.example', tipo: 'primeiro' }], nota: 'Equipe COMEX + cópia fixa da empresa, só no 1º e-mail do envio' },
  { rotulo: 'Assunto', texto: 'Sourcing request COT-2026-0412 - Citric Acid Anhydrous' },
];

export interface DiaDaSemana {
  dia: string;
  // 04:00 nos dias uteis; "—" no fim de semana.
  hora: string;
  folga: boolean;
}

export const SEMANA_DE_LEMBRETES: readonly DiaDaSemana[] = [
  { dia: 'Seg', hora: '04:00', folga: false },
  { dia: 'Ter', hora: '04:00', folga: false },
  { dia: 'Qua', hora: '04:00', folga: false },
  { dia: 'Qui', hora: '04:00', folga: false },
  { dia: 'Sex', hora: '04:00', folga: false },
  { dia: 'Sáb', hora: '—', folga: true },
  { dia: 'Dom', hora: '—', folga: true },
];

// ---------- Capitulo 10: portal do fornecedor (em ingles, como o fornecedor ve) ----------
export const PORTAL_DE_EXEMPLO = {
  empresa: 'SQ Quimica · Supplier Portal',
  cotacao: 'Sourcing request COT-2026-0412',
  campos: [
    { rotulo: 'Currency', valor: 'USD' },
    { rotulo: 'Main incoterm', valor: 'FOB' },
    { rotulo: 'Payment terms (days)', valor: '60' },
    { rotulo: 'Offer validity (days)', valor: '30' },
  ],
  item: {
    nome: 'Citric Acid Anhydrous · 20,000 KG',
    po: 'PO 1 · Acidulantes',
    precos: [
      { rotulo: 'FOB · USD / KG', valor: '1.62', principal: true },
      { rotulo: 'CFR · USD / KG', valor: '1.71', principal: false },
      { rotulo: 'CIF · USD / KG', valor: '1.73', principal: false },
    ],
    leadTime: { rotulo: 'Lead time (days)', valor: '25' },
    marcas: ['Temporarily unavailable', 'Dangerous goods (DG)'],
  },
  total: { rotulo: 'Total price', valor: '41,250.00' },
} as const;

// ---------- Capitulo 6: regua dos avisos de vencimento de documento ----------
export interface MarcaDaRegua {
  id: string;
  dia: string;
  rotulo: string;
  // Classe com a posicao (left) da marca no trilho: uma por marca, sem estilo inline.
  classe: string;
}

export const MARCAS_DA_REGUA: readonly MarcaDaRegua[] = [
  { id: 'd30', dia: 'D-30', rotulo: '1º aviso', classe: 'manual-regua__marca manual-regua__marca--d30' },
  { id: 'd15', dia: 'D-15', rotulo: '2º aviso', classe: 'manual-regua__marca manual-regua__marca--d15' },
  { id: 'd7', dia: 'D-7', rotulo: '3º aviso', classe: 'manual-regua__marca manual-regua__marca--d7' },
  { id: 'd0', dia: 'D0', rotulo: 'vence hoje', classe: 'manual-regua__marca manual-regua__marca--d0 manual-regua__marca--vermelha' },
  { id: 'vencido', dia: 'Vencido', rotulo: 'aviso único', classe: 'manual-regua__marca manual-regua__marca--vencido manual-regua__marca--vermelha' },
];

// ---------- Capitulo 12: simulador de score e waterfall do landed cost ----------
export interface SimFornecedor {
  nome: string;
  // Cesta: soma de preco unitario x quantidade pedida, na moeda da proposta (US$).
  cesta: number;
  // Prazo de pagamento em dias.
  dias: number;
  incoterm: string;
  // Nivel de risco do incoterm (1 a 5).
  nivel: number;
  // Media das estrelas (0 = sem avaliacao).
  qualidade: number;
}

export const SIM_FORNECEDORES: readonly SimFornecedor[] = [
  { nome: 'Lianyun Fine Chemicals', cesta: 41250, dias: 60, incoterm: 'FOB', nivel: 3, qualidade: 4.3 },
  { nome: 'Qingdao Harbor Chem', cesta: 39800, dias: 30, incoterm: 'FOB', nivel: 3, qualidade: 3.8 },
  { nome: 'Jinhai Industrial', cesta: 43100, dias: 90, incoterm: 'CFR', nivel: 3, qualidade: 4.6 },
  { nome: 'Nordmar Química', cesta: 40600, dias: 45, incoterm: 'CIF', nivel: 4, qualidade: 0 },
];

// Proposta da Jinhai (US$ 43.100) com cambio e aliquotas ilustrativas; o total passa do gatilho de aprovacao.
export const WATERFALL = {
  precoUsd: 43100,
  cambio: 5.42,
  frete: 18500,
  seguro: 1200,
  aliquotaIi: 0.12,
  aliquotaIpi: 0.0325,
  aliquotaPis: 0.021,
  aliquotaCofins: 0.0965,
  outrasTaxas: 3500,
  gatilho: 300000,
} as const;


// ---------- Capitulo 14: cartoes dos Relatorios ----------
export interface CartaoDeRelatorio {
  titulo: string;
  texto: string;
}

export const CARTOES_RELATORIOS: readonly CartaoDeRelatorio[] = [
  { titulo: 'Resumo', texto: 'Cotações, propostas, comparações, fornecedores e taxa de adjudicação.' },
  { titulo: 'Economia estimada', texto: 'Quanto a vencedora ficou abaixo da proposta mais cara, por cotação. Só entram comparações com duas ou mais propostas.' },
  { titulo: 'Lead-time médio', texto: 'Média geral em dias e média por fornecedor.' },
  { titulo: 'Top fornecedores', texto: 'Os dez com mais vitórias: taxa de vitória, score médio, avaliação e propostas.' },
  { titulo: 'Taxa de adjudicação', texto: 'Quantas comparações terminaram com vencedora.' },
  { titulo: 'Engajamento', texto: 'Links enviados, respondidos, taxa de resposta e tempo médio até a resposta.' },
];

// ---------- Capitulo 15: variaveis dos templates de e-mail ----------
export const VARIAVEIS_DE_TEMPLATE: readonly string[] = [
  '{{requestCode}}',
  '{{productName}}',
  '{{supplierContactName}}',
  '{{portalLink}}',
  '{{expiresAt}}',
  '{{companyName}}',
];

// ---------- Capitulo 16: perguntas frequentes ----------
export interface PerguntaFrequente {
  pergunta: string;
  resposta: string;
}

export const PERGUNTAS_FREQUENTES: readonly PerguntaFrequente[] = [
  {
    pergunta: 'O fornecedor precisa de login para responder?',
    resposta: 'Não. Cada contato recebe um link único que vale pelo prazo escolhido no envio. Quem tem o link responde sem senha.',
  },
  {
    pergunta: 'O fornecedor perdeu o e-mail ou o link expirou. E agora?',
    resposta: 'Em Links do portal, clique em Gerar novo link. O link novo é copiado para você enviar e o anterior para de funcionar na hora.',
  },
  {
    pergunta: 'Por que um fornecedor não aparece na hora do envio?',
    resposta: 'Ele está Inativo ou Bloqueado, ou não tem nenhum contato cadastrado. Confira em Fornecedores. Se ele não cota a família dos itens, procure na pasta Todos.',
  },
  {
    pergunta: 'O mais barato não ficou em primeiro. Está errado?',
    resposta:
      'Não necessariamente. Se o critério Condição de pagamento, Incoterm ou Qualidade estiver ativo, ele pesa tanto quanto o preço. Deixe só Preço para ordenar pela cesta mais barata.',
  },
  {
    pergunta: 'Por que uma proposta está em “Fora do ranking”?',
    resposta: 'Ela tem item indisponível, item faltando, quantidade diferente ou foi lançada à mão sem itens. O motivo aparece na própria linha.',
  },
  {
    pergunta: 'O fornecedor pode corrigir a proposta depois de enviar?',
    resposta: 'Sim, enquanto o link valer. Cada revisão vira uma nova versão no Histórico e desfaz a vencedora, se já houver uma.',
  },
  {
    pergunta: 'Por que não consigo definir a vencedora?',
    resposta: 'O landed cost passou do gatilho de aprovação da Empresa, ou falta o câmbio da proposta. Nesse caso, só gestor ou admin podem adjudicar.',
  },
  {
    pergunta: 'Como paro os lembretes de um fornecedor?',
    resposta: 'Eles param sozinhos quando o fornecedor responde, quando a vencedora é escolhida, quando a PO é enviada, quando a cotação fecha ou quando o prazo vence.',
  },
  {
    pergunta: 'Dá para comparar propostas em moedas diferentes?',
    resposta: 'Não. O ranking pede todas as propostas na mesma moeda. Peça ao fornecedor que responda na moeda da cotação.',
  },
  {
    pergunta: 'Apareceu “Há uma nova versão do IntelliQuote”. O que faço?',
    resposta: 'Salve o que estiver editando e clique em Recarregar. Se algo continuar estranho depois de uma atualização, abra o sistema numa aba nova.',
  },
  { pergunta: 'Esqueci a senha.', resposta: 'A senha é a do Portal COMEX. Recupere por lá.' },
];

// ---------- Capitulo 17: glossario ----------
export interface TermoDoGlossario {
  termo: string;
  definicao: string;
}

export const GLOSSARIO: readonly TermoDoGlossario[] = [
  { termo: 'Adjudicação', definicao: 'Escolha formal da proposta vencedora.' },
  { termo: 'Alçada', definicao: 'Valor acima do qual a adjudicação precisa de gestor ou admin. Definida em Empresa.' },
  { termo: 'Cesta', definicao: 'Soma de preço unitário × quantidade pedida de todos os itens de uma proposta.' },
  { termo: 'CIF', definicao: 'Valor da mercadoria + frete + seguro, base dos impostos de importação.' },
  { termo: 'Credit Support', definicao: 'Encaminhar a proposta a um parceiro de crédito, que compra do fornecedor e revende com prazo próprio.' },
  { termo: 'DG', definicao: 'Dangerous goods: carga perigosa, informada pelo fornecedor por item.' },
  { termo: 'Forwarder', definicao: 'Agente de carga que organiza o embarque.' },
  { termo: 'Incoterm', definicao: 'Regra internacional que define até onde vão os custos e riscos do vendedor (FOB, CFR, CIF…).' },
  { termo: 'Landed cost', definicao: 'Custo da mercadoria posta no Brasil: CIF + II + IPI + PIS/COFINS + outras taxas.' },
  { termo: 'Lead time', definicao: 'Dias entre o pedido e a disponibilidade da carga. Na comparação vale a média dos itens, arredondada.' },
  { termo: 'Link do portal', definicao: 'Endereço único por contato e cotação que dá acesso ao Supplier Portal sem senha.' },
  { termo: 'PO', definicao: 'Purchase Order, a Ordem de Compra enviada ao fornecedor.' },
  { termo: 'PTAX', definicao: 'Taxa de câmbio oficial do Banco Central, atualizada todo dia no sistema.' },
];

// ---------- Rodape: data da ultima conferencia do conteudo (D-M-09) ----------
// ISO (AAAA-MM-DD) e fixa: o manual nao le a data do relogio, entao o texto e igual para todos e testavel. Atualize junto com a revisao do conteudo.
export const MANUAL_ATUALIZADO_EM = '2026-11-02';

// AAAA-MM-DD -> DD/MM/AAAA, sem Date (nada de fuso horario).
export function dataBr(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

export const RODAPE_DO_MANUAL = `Manual do IntelliQuote · atualizado em ${dataBr(MANUAL_ATUALIZADO_EM)}`;
