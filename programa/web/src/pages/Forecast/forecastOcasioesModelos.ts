import type { ForecastOcasiaoEtapa } from '@/services/forecastOcasioes';
import { anoDe, somarDias } from './forecastOcasioes';

// Catalogo estatico de MODELOS de ocasiao: so preenchem o formulario (nada e gravado ate o usuario salvar). Os dias e as
// janelas sao SUGESTOES; nenhuma data de negocio real mora aqui. Sem Diwali/Eid/Ramada (datas dependem de observacao).

export type TipoModelo = 'fixo' | 'pascoa' | 'lunar';

export interface ModeloOcasiao {
  id: string;
  /** Nome da ocasiao ao preencher (modelos moveis ganham o ano no fim). */
  nome: string;
  /** Texto do seletor, quando difere do nome da ocasiao. */
  rotulo?: string;
  tipo: TipoModelo;
  escopo: 'global' | 'pais';
  /** `null` com escopo `pais` = o usuario escolhe o pais. */
  pais: string | null;
  etapa: ForecastOcasiaoEtapa;
  dias: number;
  nota: string;
  /** fixo: MM-DD (fim antes do inicio = vira o ano). */
  inicio?: string;
  fim?: string;
  /** pascoa: deslocamento em dias a partir do domingo de Pascoa. */
  deslocInicio?: number;
  deslocFim?: number;
  /** lunar: dias antes e depois da data do Ano Novo chines. */
  antes?: number;
  depois?: number;
}

export interface PreenchimentoModelo {
  modeloId: string;
  nome: string;
  escopo: 'global' | 'pais';
  pais: string | null;
  inicio: string;
  fim: string;
  anual: boolean;
  /** Data movel: nao repete todo ano. */
  movel: boolean;
  etapa: ForecastOcasiaoEtapa;
  dias: number;
  avisos: string[];
}

/** Domingo de Pascoa (calendario gregoriano; algoritmo anonimo de Meeus/Jones/Butcher), AAAA-MM-DD. */
export function domingoDePascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Dia do Ano Novo chines (lua nova) por ano; a tabela e curta de proposito (atualizar o catalogo a cada ciclo). */
export const ANO_NOVO_CHINES: Readonly<Record<number, string>> = {
  2026: '2026-02-17',
  2027: '2027-02-06',
  2028: '2028-01-26',
  2029: '2029-02-13',
  2030: '2030-02-03',
  2031: '2031-01-23',
  2032: '2032-02-11',
};
export const TABELA_LUNAR_ATE = 2032;

export const MODELOS: readonly ModeloOcasiao[] = [
  {
    id: 'natal-ano-novo',
    nome: 'Natal e Ano Novo',
    tipo: 'fixo',
    escopo: 'global',
    pais: null,
    inicio: '12-20',
    fim: '01-05',
    etapa: 'embarque',
    dias: 7,
    nota: 'Recesso de fim de ano: de 20/12 a 05/01, todo ano, sobre o embarque.',
  },
  {
    id: 'primeiro-maio',
    nome: 'Dia do Trabalho (1º de maio)',
    tipo: 'fixo',
    escopo: 'pais',
    pais: null,
    inicio: '05-01',
    fim: '05-01',
    etapa: 'prontidao',
    dias: 1,
    nota: 'Feriado de 1º de maio em vários países; escolha o país.',
  },
  {
    id: 'unidade-alema',
    nome: 'Dia da Unidade Alemã (3 de outubro)',
    tipo: 'fixo',
    escopo: 'pais',
    pais: 'DE',
    inicio: '10-03',
    fim: '10-03',
    etapa: 'prontidao',
    dias: 1,
    nota: 'Feriado nacional da Alemanha, todo ano em 3 de outubro.',
  },
  {
    id: 'golden-week',
    nome: 'Golden Week (China, aproximada)',
    tipo: 'fixo',
    escopo: 'pais',
    pais: 'CN',
    inicio: '10-01',
    fim: '10-07',
    etapa: 'prontidao',
    dias: 7,
    nota: 'Feriadão de outubro na China; a janela é aproximada.',
  },
  {
    id: 'ferias-agosto',
    nome: 'Férias de verão europeias (agosto)',
    tipo: 'fixo',
    escopo: 'pais',
    pais: null,
    inicio: '08-01',
    fim: '08-31',
    etapa: 'prontidao',
    dias: 7,
    nota: 'Fábricas europeias reduzem o ritmo em agosto; escolha o país.',
  },
  {
    id: 'sexta-santa',
    nome: 'Sexta-feira Santa',
    tipo: 'pascoa',
    escopo: 'pais',
    pais: 'DE',
    deslocInicio: -2,
    deslocFim: -2,
    etapa: 'prontidao',
    dias: 1,
    nota: 'Dois dias antes do domingo de Páscoa; muda a cada ano.',
  },
  {
    id: 'segunda-pascoa',
    nome: 'Segunda-feira de Páscoa',
    tipo: 'pascoa',
    escopo: 'pais',
    pais: 'DE',
    deslocInicio: 1,
    deslocFim: 1,
    etapa: 'prontidao',
    dias: 1,
    nota: 'Dia seguinte ao domingo de Páscoa; muda a cada ano.',
  },
  {
    id: 'ascensao',
    nome: 'Ascensão',
    tipo: 'pascoa',
    escopo: 'pais',
    pais: 'DE',
    deslocInicio: 39,
    deslocFim: 39,
    etapa: 'prontidao',
    dias: 1,
    nota: '39 dias depois do domingo de Páscoa; muda a cada ano.',
  },
  {
    id: 'segunda-pentecostes',
    nome: 'Segunda-feira de Pentecostes',
    tipo: 'pascoa',
    escopo: 'pais',
    pais: 'DE',
    deslocInicio: 50,
    deslocFim: 50,
    etapa: 'prontidao',
    dias: 1,
    nota: '50 dias depois do domingo de Páscoa; muda a cada ano.',
  },
  {
    id: 'carnaval',
    nome: 'Carnaval (Brasil)',
    tipo: 'pascoa',
    escopo: 'global',
    pais: null,
    deslocInicio: -48,
    deslocFim: -46,
    etapa: 'liberacao',
    dias: 2,
    nota: 'Da segunda-feira de Carnaval à Quarta-feira de Cinzas; muda a cada ano.',
  },
  {
    id: 'ano-novo-chines',
    nome: 'Ano Novo chinês',
    rotulo: 'Ano Novo chinês (Festival da Primavera)',
    tipo: 'lunar',
    escopo: 'pais',
    pais: 'CN',
    antes: 7,
    depois: 14,
    etapa: 'prontidao',
    dias: 14,
    nota: 'Janela de 7 dias antes a 14 dias depois do Ano Novo chinês; a data muda a cada ano.',
  },
];

export const rotuloDoModelo = (m: ModeloOcasiao): string => m.rotulo ?? m.nome;

/** Anos oferecidos: o de hoje e os 2 seguintes (o lunar so ate onde a tabela cobre). */
export function anosDoModelo(m: ModeloOcasiao, hoje: string): number[] {
  const ano = anoDe(hoje);
  const anos = [ano, ano + 1, ano + 2];
  return m.tipo === 'lunar' ? anos.filter((a) => a in ANO_NOVO_CHINES) : anos;
}

function avisosDoModelo(m: ModeloOcasiao): string[] {
  const avisos = ['Os dias e a janela são sugestões: ajuste ao que a fonte costuma informar. Nada é gravado até você salvar.'];
  if (m.id === 'golden-week') {
    avisos.push('Datas aproximadas: o calendário oficial da China sai a cada ano. Confirme a data.');
  }
  if (m.id === 'ano-novo-chines') {
    avisos.push(`Confirme a data no calendário oficial. A tabela do Ano Novo chinês cobre até ${TABELA_LUNAR_ATE}.`);
  }
  if (m.id === 'carnaval') {
    avisos.push('O Carnaval no Brasil afeta a liberação de todas as fontes, por isso o alcance sugerido é Todas as fontes.');
  }
  if (m.escopo === 'pais' && m.pais === null) avisos.push('Escolha o país.');
  if (m.tipo !== 'fixo') avisos.push('Data móvel: cadastre uma ocasião por ano.');
  return avisos;
}

/** Valores do formulario para o modelo no ano; `null` = lunar fora da tabela. */
export function preencherComModelo(m: ModeloOcasiao, ano: number): PreenchimentoModelo | null {
  let inicio: string;
  let fim: string;
  if (m.tipo === 'fixo') {
    const a = String(ano).padStart(4, '0');
    const mmddInicio = m.inicio ?? '01-01';
    const mmddFim = m.fim ?? mmddInicio;
    inicio = `${a}-${mmddInicio}`;
    fim = `${mmddFim < mmddInicio ? String(ano + 1).padStart(4, '0') : a}-${mmddFim}`;
  } else if (m.tipo === 'pascoa') {
    const pascoa = domingoDePascoa(ano);
    inicio = somarDias(pascoa, m.deslocInicio ?? 0);
    fim = somarDias(pascoa, m.deslocFim ?? 0);
  } else {
    const data = ANO_NOVO_CHINES[ano];
    if (data === undefined) return null;
    inicio = somarDias(data, -(m.antes ?? 0));
    fim = somarDias(data, m.depois ?? 0);
  }
  const fixo = m.tipo === 'fixo';
  return {
    modeloId: m.id,
    nome: fixo ? m.nome : `${m.nome} ${ano}`,
    escopo: m.escopo,
    pais: m.pais,
    inicio,
    fim,
    anual: fixo,
    movel: !fixo,
    etapa: m.etapa,
    dias: m.dias,
    avisos: avisosDoModelo(m),
  };
}
