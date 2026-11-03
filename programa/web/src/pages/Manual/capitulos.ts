import type { ComponentType } from 'react';
import { isComercialRole } from '@/components/navConfig';
import Administracao from './capitulos/Administracao';
import ComeceAqui from './capitulos/ComeceAqui';
import Comparacao from './capitulos/Comparacao';
import CriarCotacao from './capitulos/CriarCotacao';
import Envio from './capitulos/Envio';
import Fornecedores from './capitulos/Fornecedores';
import Forwarders from './capitulos/Forwarders';
import Glossario from './capitulos/Glossario';
import Itens from './capitulos/Itens';
import OrdemDeCompra from './capitulos/OrdemDeCompra';
import Overview from './capitulos/Overview';
import Perfis from './capitulos/Perfis';
import Perguntas from './capitulos/Perguntas';
import Portal from './capitulos/Portal';
import Relatorios from './capitulos/Relatorios';
import Respostas from './capitulos/Respostas';
import Solicitacoes from './capitulos/Solicitacoes';

export interface CapituloMeta {
  // Ancora da URL (/manual#comparacao) e id da <section>.
  id: string;
  grupo: string;
  titulo: string;
  // Posicao no ciclo da cotacao (1 a TOTAL_ETAPAS); so os capitulos do grupo "O ciclo da cotacao" tem.
  etapa?: number;
  Componente: ComponentType;
}

export const TOTAL_ETAPAS = 6;

// Os 17 capitulos NA ORDEM do manual aprovado (previa manual-previa.html); os ids sao os da previa.
export const CAPITULOS: readonly CapituloMeta[] = [
  { id: 'comece-aqui', grupo: 'Comece aqui', titulo: 'O que é o IntelliQuote', Componente: ComeceAqui },
  { id: 'perfis', grupo: 'Comece aqui', titulo: 'Perfis e permissões', Componente: Perfis },
  { id: 'overview', grupo: 'Comece aqui', titulo: 'Overview', Componente: Overview },
  { id: 'solicitacoes', grupo: 'Cadastros e pedidos', titulo: 'Solicitações do Comercial', Componente: Solicitacoes },
  { id: 'itens', grupo: 'Cadastros e pedidos', titulo: 'Itens e Famílias', Componente: Itens },
  { id: 'fornecedores', grupo: 'Cadastros e pedidos', titulo: 'Fornecedores e documentos', Componente: Fornecedores },
  { id: 'forwarders', grupo: 'Cadastros e pedidos', titulo: 'Forwarders', Componente: Forwarders },
  { id: 'criar-cotacao', grupo: 'O ciclo da cotação', titulo: 'Criar uma cotação', etapa: 1, Componente: CriarCotacao },
  { id: 'envio', grupo: 'O ciclo da cotação', titulo: 'Enviar aos fornecedores', etapa: 2, Componente: Envio },
  { id: 'portal', grupo: 'O ciclo da cotação', titulo: 'O que o fornecedor vê', etapa: 3, Componente: Portal },
  { id: 'respostas', grupo: 'O ciclo da cotação', titulo: 'Respostas e negociação', etapa: 4, Componente: Respostas },
  { id: 'comparacao', grupo: 'O ciclo da cotação', titulo: 'Comparação e vencedora', etapa: 5, Componente: Comparacao },
  { id: 'ordem-de-compra', grupo: 'O ciclo da cotação', titulo: 'Ordem de Compra e conclusão', etapa: 6, Componente: OrdemDeCompra },
  { id: 'relatorios', grupo: 'Acompanhamento', titulo: 'Relatórios', Componente: Relatorios },
  { id: 'administracao', grupo: 'Administração', titulo: 'Empresa, usuários e e-mails', Componente: Administracao },
  { id: 'perguntas', grupo: 'Referência', titulo: 'Perguntas frequentes', Componente: Perguntas },
  { id: 'glossario', grupo: 'Referência', titulo: 'Glossário', Componente: Glossario },
];

// O Comercial so le o capitulo Solicitacoes (D8-2); os outros 16 nem sao desenhados (a busca tambem nao os acha).
export const CAPITULO_DO_COMERCIAL = 'solicitacoes';

export function capitulosVisiveis(role?: string | null): readonly CapituloMeta[] {
  return isComercialRole(role) ? CAPITULOS.filter((c) => c.id === CAPITULO_DO_COMERCIAL) : CAPITULOS;
}

// Texto pequeno em cima do titulo: o grupo e, no ciclo da cotacao, "etapa N de 6".
export function kickerDoCapitulo(capitulo: CapituloMeta): string {
  return capitulo.etapa ? `${capitulo.grupo} · etapa ${capitulo.etapa} de ${TOTAL_ETAPAS}` : capitulo.grupo;
}

export interface GrupoDeCapitulos {
  grupo: string;
  itens: CapituloMeta[];
}

// Agrupa mantendo a ordem (so junta capitulos vizinhos do mesmo grupo).
export function agruparCapitulos(capitulos: readonly CapituloMeta[]): GrupoDeCapitulos[] {
  const grupos: GrupoDeCapitulos[] = [];
  for (const capitulo of capitulos) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.grupo === capitulo.grupo) ultimo.itens.push(capitulo);
    else grupos.push({ grupo: capitulo.grupo, itens: [capitulo] });
  }
  return grupos;
}
