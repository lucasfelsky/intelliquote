export interface HelpArticle {
  id: string;
  category: 'general' | 'fornecedor' | 'cotacao' | 'proposta' | 'comparacao' | 'auditoria' | 'usuarios' | 'anexos' | 'relatorios' | 'onboarding' | 'portal' | 'empresa';
  title: string;
  content: string;
  displayOrder: number;
}

// Conteudo da Central de Ajuda. Textos revisados (polish round 2026-06-23):
//  - tom uniformemente em portugues brasileiro
//  - estrutura Pre-requisitos / Passo a passo / Problemas comuns
//    quando aplicavel
//  - referencias a URLs finais (intelliquote.portal-comex.com) e
//    modulos atuais (Portal do Fornecedor, aba Itens, copia
//    automatica por empresa)
//  - removidas mencoes a "app.js" / "public/index.html" e ao
//    login por usuario/senha legado (substituido pelo login
//    via Firebase em /login).
export const helpArticles: HelpArticle[] = [
  {
    id: 'welcome',
    category: 'general',
    title: 'Bem-vindo ao IntelliQuote',
    content:
      'O IntelliQuote centraliza fornecedores, cotacoes, propostas e comparacoes internacionais em um unico lugar.\n\n' +
      'Pre-requisitos: navegador moderno (Chrome, Edge, Firefox) e acesso a https://intelliquote.portal-comex.com.\n\n' +
      'Passo a passo:\n' +
      '1) Faca login na tela inicial com sua conta corporativa.\n' +
      '2) Use o menu lateral para acessar Fornecedores, Cotacoes, Propostas, Comparacao, Relatorios, Auditoria ou Ajuda.\n' +
      '3) Para configurar dados da empresa e destinatarios em copia automatica, abra Empresa no menu lateral.\n\n' +
      'Problemas comuns: se a tela ficar em branco, atualize com Ctrl+Shift+R para ignorar o cache do navegador.',
    displayOrder: 1,
  },
  {
    id: 'onboarding-overview',
    category: 'onboarding',
    title: 'Como comecar em 3 passos',
    content:
      '1) Cadastre um fornecedor em "Fornecedores > Novo", incluindo o pais e os incoterms aceitos.\n' +
      '2) Em "Cotacoes > Nova", registre a solicitacao (produto, quantidade, moeda, incoterm, prazo) e adicione itens detalhados em "Itens".\n' +
      '3) Acompanhe as respostas em "Propostas", compare precos em "Comparacao" e feche a cotacao. Use "Relatorios" para visao consolidada.',
    displayOrder: 2,
  },
  {
    id: 'supplier',
    category: 'fornecedor',
    title: 'Cadastrar fornecedores',
    content:
      'Acesse o menu "Fornecedores" e clique em "Novo". Preencha razao social, pais, status e incoterms aceitos.\n\n' +
      'Passo a passo para adicionar contatos:\n' +
      '1) Abra o detalhe do fornecedor.\n' +
      '2) Em "Contatos", clique em "Adicionar contato" e preencha nome, e-mail, telefone e cargo.\n' +
      '3) Marque "Contato principal" se for o destino padrao dos envios. Salve ao final.\n\n' +
      'Dica: o sistema usa o contato principal como destinatario padrao quando voce abre o modal de envio de uma cotacao.',
    displayOrder: 3,
  },
  {
    id: 'quote',
    category: 'cotacao',
    title: 'Criar cotacoes',
    content:
      'Em "Cotacoes > Nova", informe o titulo, a descricao tecnica, a quantidade, a moeda, o incoterm desejado e o prazo de resposta.\n\n' +
      'Passo a passo para adicionar itens:\n' +
      '1) Salve a cotacao basica para liberar a aba "Itens".\n' +
      '2) Em "Itens", escolha o item do catalogo (produto + nome de mercado) e informe a quantidade.\n' +
      '3) Salve cada item. Eles aparecerao no Portal do Fornecedor e no e-mail automatico.\n\n' +
      'Problemas comuns: o botao "Enviar cotacao" so e habilitado quando ha pelo menos um item cadastrado.',
    displayOrder: 4,
  },
  {
    id: 'response',
    category: 'proposta',
    title: 'Registar propostas (wizard)',
    content:
      'Em "Propostas > Nova", siga o wizard de 4 etapas:\n' +
      '1) Identificacao: selecione a cotacao, o fornecedor, a moeda e a taxa de cambio do dia (ou use a PTAX automatica).\n' +
      '2) Preco e incoterm: informe preco unitario, condicao de pagamento e incoterm.\n' +
      '3) Custos adicionais: frete internacional, seguro e outras taxas.\n' +
      '4) Impostos e observacoes: finalize com impostos e comentarios.\n\n' +
      'Os valores sao normalizados automaticamente para BRL na comparacao.',
    displayOrder: 5,
  },
  {
    id: 'compare',
    category: 'comparacao',
    title: 'Comparar propostas',
    content:
      'No modulo "Comparacao", selecione a cotacao, ajuste os pesos de preco, prazo de pagamento e incoterm e clique em "Comparar".\n\n' +
      'O sistema:\n' +
      '- normaliza todas as propostas para a mesma moeda (BRL);\n' +
      '- aplica os pesos configurados;\n' +
      '- sugere a proposta vencedora (voce pode sobrescrever);\n' +
      '- registra a comparacao na auditoria.',
    displayOrder: 6,
  },
  {
    id: 'audit',
    category: 'auditoria',
    title: 'Auditoria operacional',
    content:
      'O modulo "Auditoria" lista todas as acoes relevantes do sistema: criacao, edicao e exclusao de registros, envios de cotacao, respostas de fornecedores, comparacoes e atualizacoes de perfil.\n\n' +
      'Filtre por tipo de entidade, acao ou usuario para localizar eventos especificos. Cada evento guarda snapshot antes/depois.',
    displayOrder: 7,
  },
  {
    id: 'users',
    category: 'usuarios',
    title: 'Gestao de usuarios',
    content:
      'Administradores acessam o modulo "Usuarios" para criar, ativar/desativar e redefinir acesso de outros usuarios.\n\n' +
      'Passo a passo para cadastrar um novo usuario:\n' +
      '1) Em "Usuarios > Novo", informe nome, e-mail e perfil (admin, gestor, comprador ou viewer).\n' +
      '2) Defina uma senha provisoria ou envie o convite pelo Firebase Auth.\n' +
      '3) O usuario podera trocar a senha no primeiro acesso.\n\n' +
      'A recuperacao de senha esta disponivel na tela de login.',
    displayOrder: 8,
  },
  {
    id: 'attachments',
    category: 'anexos',
    title: 'Anexar documentos',
    content:
      'Em Cotacoes, Propostas e Fornecedores, abra o detalhe e clique em "Adicionar anexo".\n\n' +
      'Limites: ate 5MB por arquivo. Formatos suportados: PDF, imagens, planilhas e documentos de texto.\n\n' +
      'Cada anexo e listado na auditoria e fica disponivel para os fornecedores via Portal do Fornecedor (quando aplicavel).',
    displayOrder: 9,
  },
  {
    id: 'reports',
    category: 'relatorios',
    title: 'Relatorios gerenciais',
    content:
      'O modulo "Relatorios" apresenta economia estimada, lead time medio, top fornecedores e taxa de adjudicacao.\n\n' +
      'Use os filtros de periodo (mes, trimestre, ano) para detalhar. Os dados consideram apenas cotacoes com comparacao registrada.',
    displayOrder: 10,
  },
  {
    id: 'company-profile',
    category: 'empresa',
    title: 'Perfil da empresa',
    content:
      'A tela "Empresa" (no menu lateral) concentra os dados que aparecem nos documentos e nos e-mails automaticos: razao social, CNPJ, endereco, telefone, website e logotipo.\n\n' +
      'Ha tambem uma area especifica de "Copia automatica (CC)" para cadastrar ate 50 e-mails que sempre recebem copia de todos os envios de cotacao desta empresa (ver artigo "Como configurar copias automaticas (CC)").\n\n' +
      'Problemas comuns: se o botao "Enviar cotacao" estiver bloqueado com erro 412, complete ao menos razao social e e-mail de compras.',
    displayOrder: 11,
  },
  {
    id: 'company-cc',
    category: 'empresa',
    title: 'Como configurar copias automaticas (CC)',
    content:
      'A area "Copia automatica (CC)" na tela Empresa permite cadastrar ate 50 e-mails fixos que sempre receberao copia de todos os envios de cotacao.\n\n' +
      'Quando usar: escritorio de compras, gerencia, financeiro ou controle de qualidade que precisam ser notificados sem precisar selecionar manualmente cada envio.\n\n' +
      'Passo a passo:\n' +
      '1) Abra Empresa no menu lateral.\n' +
      '2) Role ate a area "Copia automatica (CC)".\n' +
      '3) Digite um e-mail e clique em "Adicionar" (ou pressione Enter / virgula). O sistema normaliza para minusculas e remove duplicados.\n' +
      '4) Para remover, clique em "Remover" ao lado do e-mail.\n' +
      '5) Salve o perfil no botao "Salvar perfil" no fim do formulario.\n\n' +
      'O comportamento no modal de envio:\n' +
      '- O pill "+N CC empresa" mostra quantos enderecos serao adicionados automaticamente.\n' +
      '- O passo de preview lista todos os enderecos ao lado do e-mail renderizado.\n' +
      '- O destinatario principal nunca recebe copia de si mesmo, e duplicados sao removidos automaticamente.',
    displayOrder: 12,
  },
  {
    id: 'portal-overview',
    category: 'portal',
    title: 'Portal do Fornecedor - como funciona',
    content:
      'O Portal do Fornecedor e a area publica que o fornecedor acessa a partir do link magico enviado por e-mail.\n\n' +
      'Como o fornecedor entra:\n' +
      '1) Recebe um e-mail da sua empresa com o assunto "Sourcing request QR-...".\n' +
      '2) Clica no botao "View request". Abre uma pagina sem necessidade de login.\n' +
      '3) Visualiza os itens solicitados, preenche preco, incoterm, prazo, mensagem e envia a proposta.\n\n' +
      'Seguranca:\n' +
      '- Cada link e de uso unico: apos a primeira resposta, o link e marcado como respondido.\n' +
      '- O link expira em 7 dias por padrao (configuravel no momento do envio).\n' +
      '- O acesso e registrado na auditoria (data, IP aproximado, contagem de acessos).\n\n' +
      'Problemas comuns:\n' +
      '- Se o fornecedor relatar "link expirado", gere um novo envio a partir do IntelliQuote.\n' +
      '- Se a pagina abrir mas mostrar "Network error", peca para atualizar com Ctrl+Shift+R.',
    displayOrder: 13,
  },
  {
    id: 'items-catalog',
    category: 'cotacao',
    title: 'Aba de Itens (catalogo)',
    content:
      'A aba "Itens" no menu lateral e o catalogo de produtos que podem ser usados nas cotacoes.\n\n' +
      'Voce pode cadastrar itens manualmente ou usar o campo de busca para localizar um item ja existente pelo nome de mercado, pelo nome comercial ou pelo codigo interno.\n\n' +
      'Quando o item e selecionado em uma cotacao, o Portal do Fornecedor mostra o nome de mercado (marketName) e a quantidade, garantindo que o fornecedor saiba exatamente o que esta cotando.',
    displayOrder: 14,
  },
];
