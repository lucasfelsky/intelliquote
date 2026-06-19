export interface HelpArticle {
  id: string;
  category: 'general' | 'fornecedor' | 'cotacao' | 'proposta' | 'comparacao' | 'auditoria' | 'usuarios' | 'anexos' | 'relatorios' | 'onboarding';
  title: string;
  content: string;
  displayOrder: number;
}

export const helpArticles: HelpArticle[] = [
  {
    id: 'welcome',
    category: 'general',
    title: 'Bem-vindo ao IntelliQuote',
    content:
      'O IntelliQuote organiza fornecedores, cotacoes, propostas e comparacoes internacionais. Use o menu superior para navegar entre os modulos. Em caso de duvida, clique nos icones de ajuda em cada formulario.',
    displayOrder: 1,
  },
  {
    id: 'onboarding-overview',
    category: 'onboarding',
    title: 'Como comecar em 3 passos',
    content:
      '1) Cadastre um fornecedor em Fornecedores > Novo. 2) Abra Cotacoes > Nova para registrar a solicitacao (defina moeda, prazo e descricao). 3) Receba as propostas em Propostas, compare em Comparacao e acompanhe em Relatorios.',
    displayOrder: 2,
  },
  {
    id: 'supplier',
    category: 'fornecedor',
    title: 'Cadastrar fornecedores',
    content:
      'Acesse Fornecedores, preencha nome, e-mail, pais, status e incoterms aceites. Adicione contatos clicando em "Adicionar contato" dentro do detalhe do fornecedor. Use o botao Guardar para finalizar.',
    displayOrder: 3,
  },
  {
    id: 'quote',
    category: 'cotacao',
    title: 'Criar cotacoes',
    content:
      'Em Cotacoes > Nova cotacao, informe produto, quantidade, prazo, descricao tecnica, moeda e Incoterm desejado. Adicione itens detalhados no modulo Itens. Anexe documentos pelo icone de clipe na listagem.',
    displayOrder: 4,
  },
  {
    id: 'response',
    category: 'proposta',
    title: 'Registar propostas (wizard)',
    content:
      'Em Propostas > Nova, siga o wizard de 4 etapas: 1) Identificacao (cotacao, fornecedor, moeda, taxa de cambio). 2) Preco e Incoterm. 3) Custos adicionais (frete, seguro, outras taxas). 4) Impostos e observacoes. As taxas sao normalizadas automaticamente para BRL.',
    displayOrder: 5,
  },
  {
    id: 'compare',
    category: 'comparacao',
    title: 'Comparar propostas',
    content:
      'No modulo Comparacao, selecione a cotacao, ajuste os pesos de preco/pagamento/Incoterm e clique em Comparar. O sistema grava a comparacao, marca a vencedora e fecha a cotacao.',
    displayOrder: 6,
  },
  {
    id: 'audit',
    category: 'auditoria',
    title: 'Auditoria operacional',
    content:
      'O modulo Auditoria lista todas as acoes relevantes. Filtre por tipo de entidade, acao ou usuario para localizar eventos especificos. Cada evento guarda snapshot antes/depois.',
    displayOrder: 7,
  },
  {
    id: 'users',
    category: 'usuarios',
    title: 'Gestao de usuarios',
    content:
      'Administradores acessam o modulo Usuarios para criar, ativar/desativar e redefinir senhas. Outros perfis veem apenas o proprio cadastro. A recuperacao de senha esta disponivel na tela de login.',
    displayOrder: 8,
  },
  {
    id: 'attachments',
    category: 'anexos',
    title: 'Anexar documentos',
    content:
      'Em Cotacoes, Propostas e Fornecedores, abra o detalhe e clique em "Adicionar anexo". O arquivo (ate 5MB) e armazenado em /uploads e listado na auditoria.',
    displayOrder: 9,
  },
  {
    id: 'reports',
    category: 'relatorios',
    title: 'Relatorios gerenciais',
    content:
      'O modulo Relatorios apresenta economia estimada, lead time medio, top fornecedores e taxa de adjudicacao. Use os filtros de periodo para detalhar.',
    displayOrder: 10,
  },
];
