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
