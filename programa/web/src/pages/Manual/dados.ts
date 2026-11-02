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
