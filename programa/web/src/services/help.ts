// Helpers e tipos para a Central de Ajuda.
// Os artigos podem ser filtrados por categoria e/ou por uma busca textual
// aproximada. O backend devolve o conteúdo já pronto para exibição.

import { api } from '@/api/client';

export type HelpCategory =
  | 'general'
  | 'fornecedor'
  | 'cotacao'
  | 'proposta'
  | 'comparacao'
  | 'auditoria'
  | 'usuarios'
  | 'anexos'
  | 'relatorios'
  | 'onboarding'
  | 'portal'
  | 'empresa';

export interface HelpArticle {
  id: number;
  category: HelpCategory;
  title: string;
  content: string;
  displayOrder: number;
}

export interface HelpFilters {
  search?: string | null;
  category?: HelpCategory | null;
}

export const HELP_CATEGORIES: readonly { value: HelpCategory; label: string }[] = [
  { value: 'general', label: 'Geral' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'fornecedor', label: 'Fornecedor' },
  { value: 'cotacao', label: 'Cotação' },
  { value: 'proposta', label: 'Proposta' },
  { value: 'comparacao', label: 'Comparação' },
  { value: 'auditoria', label: 'Auditoria' },
  { value: 'usuarios', label: 'Usuários' },
  { value: 'anexos', label: 'Anexos' },
  { value: 'relatorios', label: 'Relatórios' },
  { value: 'empresa', label: 'Empresa' },
  { value: 'portal', label: 'Portal do Fornecedor' },
];

export async function listHelpArticles(filters: HelpFilters = {}): Promise<HelpArticle[]> {
  const query: Record<string, string | undefined> = {};
  if (filters.search) query.search = filters.search;
  if (filters.category) query.category = filters.category;
  const data = await api.get<HelpArticle[]>('/v1/help/articles', query);
  return Array.isArray(data) ? data : [];
}

export interface HelpCategoryFaq {
  category: HelpCategory;
  label: string;
  questions: Array<{ question: string; answer: string }>;
}

// Conteudo estatico que complementa os artigos do backend com respostas
// rapidas sobre o fluxo mais comum (criar cotacao, enviar, comparar).
// Mantido em pt-BR e revisado a cada release.
export const FAQ_BY_CATEGORY: readonly HelpCategoryFaq[] = [
  {
    category: 'cotacao',
    label: 'Cotação',
    questions: [
      {
        question: 'Como crio uma nova cotação?',
        answer:
          'No menu Cotações, clique em "+ Nova cotação". Preencha código, produto, quantidade, ' +
          'incoterm desejado, moeda e prazo. Adicione ao menos um item do catálogo antes de ' +
          'enviar para fornecedores.',
      },
      {
        question: 'Posso editar uma cotação depois de enviada?',
        answer:
          'Sim. Cotações com status "Aberta" podem ter descrição, incoterm, moeda e prazo ' +
          'alterados, além de itens adicionados/removidos. Itens individuais podem ser editados ' +
          'até a cotação ser fechada. Para mudar o código, crie outra cotação.',
      },
      {
        question: 'Como funciona o item de catálogo?',
        answer:
          'Itens do catálogo (menu Itens) guardam nome comercial, nome de mercado, unidade, ' +
          'periculosidade e descrição padrão. Ao adicionar à cotação, você informa só quantidade, ' +
          'unidade e notas. O fornecedor vê o nome de mercado no e-mail/portal.',
      },
    ],
  },
  {
    category: 'fornecedor',
    label: 'Fornecedor',
    questions: [
      {
        question: 'Como cadastro um fornecedor?',
        answer:
          'Menu Fornecedores → "+ Novo fornecedor". Informe nome, país, prazo de pagamento ' +
          'padrão e dados de contato. Adicione um ou mais contatos (cada um com nome, e-mail, ' +
          'cargo). Marque o contato principal — ele será o destinatário padrão do envio.',
      },
      {
        question: 'Posso ter mais de um contato por fornecedor?',
        answer:
          'Sim. Ao enviar a cotação, marque o contato principal como destinatário. Os demais ' +
          'contatos do mesmo fornecedor entram automaticamente em cópia (CC), para que a equipe ' +
          'comercial inteira visualize o envio.',
      },
    ],
  },
  {
    category: 'proposta',
    label: 'Proposta',
    questions: [
      {
        question: 'Como o fornecedor envia a proposta?',
        answer:
          'O fornecedor recebe um e-mail com link mágico (sem login). Ao clicar, abre o Portal ' +
          'do Fornecedor, preenche preço, moeda, incoterm, prazo de pagamento, frete, ' +
          'observações e responde item a item. O link expira em 14 dias (configurável por ' +
          'cotação).',
      },
      {
        question: 'O fornecedor pode responder duas vezes?',
        answer:
          'Não. Cada link é único e só permite uma resposta. Para reabrir, gere um novo link ' +
          '(será criado um novo token e o anterior revogado automaticamente).',
      },
    ],
  },
  {
    category: 'comparacao',
    label: 'Comparação',
    questions: [
      {
        question: 'Como comparar as propostas?',
        answer:
          'Abra a cotação e clique em "Executar comparação". O sistema normaliza moedas usando ' +
          'a taxa de câmbio do dia, calcula custo landed (preço + frete + seguro) e ranqueia ' +
          'as propostas. O histórico fica salvo na aba Comparações.',
      },
      {
        question: 'O que é "custo landed"?',
        answer:
          'É o preço total colocado no seu armazém, somando o preço do fornecedor, frete ' +
          'internacional, seguro e despesas aduaneiras estimadas. Permite comparar propostas em ' +
          'moedas diferentes em uma base única.',
      },
    ],
  },
  {
    category: 'empresa',
    label: 'Empresa',
    questions: [
      {
        question: 'O que é a "cópia automática" (CC)?',
        answer:
          'É a lista de e-mails que recebem cópia de TODOS os envios desta empresa, sem precisar ' +
          'marcar destinatário por destinatário a cada envio. Você pode ativar o modo "Incluir ' +
          'todos os perfis ativos automaticamente" e desmarcar quem não deve receber, ou marcar ' +
          'apenas alguns perfis. Também é possível adicionar e-mails externos (ex: financeiro, ' +
          'auditoria) que não têm login no sistema.',
      },
      {
        question: 'Preciso preencher o perfil antes de enviar cotações?',
        answer:
          'Sim. Razão social e e-mail de compras são obrigatórios (validados no envio). Preencha ' +
          'os demais campos para que apareçam corretamente nos e-mails e PDFs.',
      },
    ],
  },
  {
    category: 'portal',
    label: 'Portal do Fornecedor',
    questions: [
      {
        question: 'O fornecedor precisa criar conta?',
        answer:
          'Não. O acesso é por link mágico enviado por e-mail. O fornecedor responde a cotação ' +
          'sem precisar se cadastrar.',
      },
      {
        question: 'O link expira?',
        answer:
          'Sim, após 14 dias por padrão. O admin pode revogar manualmente o token a partir da ' +
          'aba "Envios" da cotação. Ao gerar novo envio para o mesmo fornecedor, o link anterior ' +
          'é revogado automaticamente.',
      },
    ],
  },
  {
    category: 'usuarios',
    label: 'Usuários',
    questions: [
      {
        question: 'Como adiciono um novo usuário?',
        answer:
          'Menu Usuários → "+ Novo usuário". Informe nome, e-mail e perfil (admin, comprador, ' +
          'gestor ou visualizador). O sistema gera uma senha temporária que deve ser trocada no ' +
          'primeiro acesso.',
      },
      {
        question: 'Qual a diferença entre os perfis?',
        answer:
          'admin: tudo, incluindo gestão de usuários. comprador: cria e envia cotações, gerencia ' +
          'fornecedores e itens. gestor: visualiza tudo e pode fechar/reabrir cotações, mas ' +
          'não edita cadastros. visualizador: somente leitura.',
      },
    ],
  },
  {
    category: 'auditoria',
    label: 'Auditoria',
    questions: [
      {
        question: 'O que é registrado na auditoria?',
        answer:
          'Toda criação, atualização e exclusão de fornecedor, contato, cotação, item, proposta, ' +
          'comparação, envio e token de portal. Cada registro guarda usuário, data/hora, dados ' +
          'anteriores e novos.',
      },
    ],
  },
  {
    category: 'relatorios',
    label: 'Relatórios',
    questions: [
      {
        question: 'Quais relatórios estão disponíveis?',
        answer:
          'Resumo geral (cotações abertas/fechadas, taxa de resposta), economia estimada, lead ' +
          'time médio, top fornecedores por volume e taxa de adjudicação. Todos filtráveis por ' +
          'período.',
      },
    ],
  },
  {
    category: 'onboarding',
    label: 'Onboarding',
    questions: [
      {
        question: 'Por onde começo?',
        answer:
          '1) Preencha o perfil da empresa (menu Empresa). ' +
          '2) Cadastre os fornecedores (menu Fornecedores) com pelo menos um contato. ' +
          '3) Crie os itens de catálogo que você costuma cotar (menu Itens). ' +
          '4) Crie sua primeira cotação (menu Cotações), adicione itens e envie. ' +
          '5) Acompanhe as respostas na aba Propostas e rode a comparação quando tiver 2+.',
      },
    ],
  },
  {
    category: 'anexos',
    label: 'Anexos',
    questions: [
      {
        question: 'Como anexo um documento à cotação?',
        answer:
          'Na cotação, use a área de anexos para enviar PDFs, planilhas ou imagens. O fornecedor ' +
          'visualiza pelo Portal. Limite de 10 MB por arquivo.',
      },
    ],
  },
  {
    category: 'general',
    label: 'Geral',
    questions: [
      {
        question: 'Como acesso o IntelliQuote?',
        answer:
          'O IntelliQuote está integrado ao Portal COMEX. Faça login uma vez no Portal e abra ' +
          'o atalho para o IntelliQuote na barra lateral. A sessão é compartilhada.',
      },
      {
        question: 'Esqueci minha senha. O que faço?',
        answer:
          'Use "Esqueci minha senha" na tela de login do Portal COMEX. Um e-mail de redefinição ' +
          'será enviado. Se não receber, peça a um admin para resetar sua senha no menu Usuários.',
      },
    ],
  },
];

export { messageOf } from '@/services/quoteResponses';