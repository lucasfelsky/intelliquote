import type { ReactNode } from 'react';
import type { ForecastDbcorpSlot, ForecastDbcorpSummary, ForecastRelatorioResumo } from '@/services/forecast';
import {
  avisosSemRedundancia,
  diasDaRegraFup,
  kgEmAberto,
  mesAno,
  percentualSemData,
  rotuloDoMotivo,
  rotuloDoSlot,
  SLOTS_DBCORP,
  totaisDeposito,
} from './forecastImport';
import { AvisosEErros, useFocoNoTitulo } from './ForecastResumoPlanilha';
import { dataBr, inteiroBr } from './forecastPainel';
import { TabelaPendentes } from './ForecastPendentesCadastro';
import { textoForaDoCalculoPrevia } from './forecastPendentes';
import type { ForecastPendentesResumo } from '@/services/forecastPendentes';

const SIM_NAO = (v: boolean) => (v ? 'Sim' : 'Não');

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="fci-bloco">
      <h4>{titulo}</h4>
      {children}
    </div>
  );
}

function ignoradasTexto(ignoradas: Record<string, number>): string {
  const partes = Object.entries(ignoradas).map(([motivo, n]) => `${rotuloDoMotivo(motivo)}: ${inteiroBr(n)}`);
  return partes.length > 0 ? partes.join(' · ') : '—';
}

function LinhasKg({ valor }: { valor: { linhas: number; kg: number } }) {
  return (
    <>
      {inteiroBr(valor.linhas)} linhas · {inteiroBr(valor.kg)} kg
    </>
  );
}

function BlocoSaldo({ relatorio }: { relatorio: ForecastRelatorioResumo }) {
  const depositos = relatorio.porDeposito ?? [];
  const outras = relatorio.outrasEmpresas ?? [];
  const totais = totaisDeposito(depositos);
  return (
    <Bloco titulo="SALDO por depósito">
      <div className="table-wrapper">
        <table className="table">
          <caption className="sr-only">Saldo por depósito</caption>
          <thead>
            <tr>
              <th scope="col">Depósito</th>
              <th scope="col">Entra no estoque</th>
              <th scope="col">Linhas</th>
              <th scope="col">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {depositos.map((d) => (
              <tr key={d.deposito}>
                <th scope="row">{d.deposito}</th>
                <td>{SIM_NAO(d.incluido)}</td>
                <td>{inteiroBr(d.linhas)}</td>
                <td>{inteiroBr(d.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Incluído: {inteiroBr(totais.incluido)} · Excluído: {inteiroBr(totais.excluido)}
      </p>
      {outras.length > 0 && (
        <div className="table-wrapper">
          <table className="table">
            <caption className="sr-only">Saldo de outras empresas (fora do estoque)</caption>
            <thead>
              <tr>
                <th scope="col">Outra empresa</th>
                <th scope="col">Linhas</th>
                <th scope="col">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {outras.map((o) => (
                <tr key={o.empresa}>
                  <th scope="row">{o.empresa}</th>
                  <td>{inteiroBr(o.linhas)}</td>
                  <td>{inteiroBr(o.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Bloco>
  );
}

function TabelaStatus({
  legenda,
  unidade,
  linhas,
}: {
  legenda: string;
  unidade: 'qtd' | 'kg';
  linhas: NonNullable<ForecastRelatorioResumo['porStatus']>;
}) {
  return (
    <div className="table-wrapper">
      <table className="table">
        <caption className="sr-only">{legenda}</caption>
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Entra</th>
            <th scope="col">Linhas</th>
            <th scope="col">{unidade === 'kg' ? 'kg' : 'Quantidade'}</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((s) => (
            <tr key={s.status}>
              <th scope="row">{s.status}</th>
              <td>{SIM_NAO(s.incluido)}</td>
              <td>{inteiroBr(s.linhas)}</td>
              <td>{inteiroBr(unidade === 'kg' ? s.kg : s.qtd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlocoProgramacao({ relatorio }: { relatorio: ForecastRelatorioResumo }) {
  const fora = relatorio.foraDaJanela;
  return (
    <Bloco titulo="PROGRAMAÇÃO por status">
      <TabelaStatus legenda="Programação por status" unidade="qtd" linhas={relatorio.porStatus ?? []} />
      {fora && (
        <p>
          Fora da janela: {inteiroBr(fora.antes)} antes do mês base · {inteiroBr(fora.depois)} depois de 4 meses
        </p>
      )}
    </Bloco>
  );
}

function BlocoFup({ relatorio }: { relatorio: ForecastRelatorioResumo }) {
  const porStatus = relatorio.porStatus ?? [];
  const excluidas = relatorio.excluidas;
  // As linhas com ETA FINAL ficam no status que entra, mas a regra F3 as exclui: nao contam como "em aberto".
  const emAberto = kgEmAberto(porStatus, excluidas?.etaFinalPreenchida.kg ?? 0);
  const semData = relatorio.semData ?? null;
  const percentual = semData ? percentualSemData(semData, emAberto) : null;
  const dias = diasDaRegraFup(relatorio.regra);
  const naoReconhecida = relatorio.prontidaoNaoReconhecida;
  return (
    <Bloco titulo="FUP por status">
      {relatorio.regra && (
        <p>
          Regra {relatorio.regra.id}: atracadas e linhas com ETA FINAL ficam fora; chegada = ETA, senão ETD + {dias.etd}{' '}
          dias, senão DATA PRONTIDÃO + {dias.prontidao} dias (estimada).
        </p>
      )}
      <TabelaStatus legenda="FUP por status" unidade="kg" linhas={porStatus} />
      <p>Em aberto: {inteiroBr(emAberto)} kg</p>
      {excluidas && (
        <p>
          Excluídas pela regra: {(relatorio.regra?.statusExcluidos ?? ['ATRAC. AG. LIBERAÇÃO']).join(', ')} —{' '}
          <LinhasKg valor={excluidas.atracadas} /> · ETA FINAL preenchida — <LinhasKg valor={excluidas.etaFinalPreenchida} />
          {excluidas.etaFinalPreenchida.depoisDaDataBase.linhas > 0 &&
            ` (${inteiroBr(excluidas.etaFinalPreenchida.depoisDaDataBase.linhas)} com ETA FINAL depois da data base)`}
        </p>
      )}
      {naoReconhecida && naoReconhecida.linhas > 0 && (
        <div className="fci-destaque">
          <span className="fci-destaque__icone" aria-hidden="true">
            ⚠
          </span>
          <div>
            <strong>
              DATA PRONTIDÃO não reconhecida: {inteiroBr(naoReconhecida.linhas)} linhas · {inteiroBr(naoReconhecida.kg)} kg
              ficaram FORA das chegadas
            </strong>
            <div className="table-wrapper">
              <table className="table">
                <caption className="sr-only">Linhas do FUP com DATA PRONTIDÃO não reconhecida</caption>
                <thead>
                  <tr>
                    <th scope="col">Linha do FUP</th>
                    <th scope="col">Status</th>
                    <th scope="col">Código</th>
                    <th scope="col">kg</th>
                    <th scope="col">Texto</th>
                  </tr>
                </thead>
                <tbody>
                  {naoReconhecida.detalhes.map((d) => (
                    <tr key={d.linha}>
                      <th scope="row">{inteiroBr(d.linha)}</th>
                      <td>{d.status}</td>
                      <td>{d.codigo}</td>
                      <td>{inteiroBr(d.kg)}</td>
                      <td>{d.texto}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {naoReconhecida.omitidos > 0 && <p>… e mais {inteiroBr(naoReconhecida.omitidos)} linhas</p>}
          </div>
        </div>
      )}
      {semData && semData.linhas > 0 && (
        <div className="fci-destaque">
          <span className="fci-destaque__icone" aria-hidden="true">
            ⚠
          </span>
          <div>
            <strong>
              Sem data: {inteiroBr(semData.linhas)} linhas · {inteiroBr(semData.kg)} kg
              {percentual !== null && ` (${percentual}% do em aberto)`} ficaram FORA das chegadas
            </strong>
            {semData.porStatus.length > 0 && (
              <ul className="fci-lista">
                {semData.porStatus.map((s) => (
                  <li key={s.status}>
                    {s.status}: {inteiroBr(s.linhas)} linhas · {inteiroBr(s.kg)} kg
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {semData && semData.linhas === 0 && <p>Sem data: nenhuma linha ficou fora das chegadas.</p>}
      {relatorio.vencidasNoMesBase && (
        <p>
          Vencidas (entraram no mês base): <LinhasKg valor={relatorio.vencidasNoMesBase} />
        </p>
      )}
      {relatorio.estimadasPorEtd && (
        <p>
          Estimadas por ETD + {dias.etd} dias: <LinhasKg valor={relatorio.estimadasPorEtd} />{' '}
          <span className="badge badge--warning">ESTIMADA</span>
        </p>
      )}
      {relatorio.estimadasPorProntidao && (
        <p>
          Estimadas por DATA PRONTIDÃO + {dias.prontidao} dias: <LinhasKg valor={relatorio.estimadasPorProntidao} />{' '}
          <span className="badge badge--warning">ESTIMADA</span>
        </p>
      )}
      {relatorio.depoisDaJanela && (
        <p>
          Depois da janela de 5 meses (ignoradas): <LinhasKg valor={relatorio.depoisDaJanela} />
        </p>
      )}
    </Bloco>
  );
}

function BlocoPendentes({
  pendentes,
  onCompletar,
}: {
  pendentes: ForecastPendentesResumo;
  onCompletar?: (codigo: string, gatilho: HTMLElement) => void;
}) {
  return (
    <Bloco titulo={`Pendentes de cadastro (${inteiroBr(pendentes.totalItens)})`}>
      <p>{textoForaDoCalculoPrevia(pendentes.totalItens)}</p>
      <TabelaPendentes
        itens={pendentes.itens}
        omitidos={pendentes.omitidos}
        soSaldo={pendentes.soSaldo}
        regra={pendentes.regra}
        semVendaRecente={pendentes.semVendaRecente}
        podeCompletar={onCompletar !== undefined}
        onCompletar={onCompletar}
        legenda="Códigos do DBCorp pendentes de cadastro"
      />
    </Bloco>
  );
}

function BlocoHistorico({ historico }: { historico: ForecastDbcorpSummary['historico'] }) {
  const anterior = historico.mesAnterior;
  return (
    <Bloco titulo="Histórico de vendas">
      {historico.meses.length > 0 && (
        <div className="table-wrapper">
          <table className="table">
            <caption className="sr-only">Linhas de histórico por mês, no banco</caption>
            <thead>
              <tr>
                <th scope="col">Mês</th>
                <th scope="col">Linhas no banco</th>
              </tr>
            </thead>
            <tbody>
              {historico.meses.map((m) => (
                <tr key={m.yearMonth}>
                  <th scope="row">{mesAno(m.yearMonth)}</th>
                  <td>{inteiroBr(m.linhas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {historico.ausentes.length > 0 && <p>Meses sem histórico: {historico.ausentes.map(mesAno).join(', ')}</p>}
      {anterior && (
        <p>
          Ao confirmar, o histórico de {mesAno(anterior.yearMonth)} será substituído: {inteiroBr(anterior.linhas)} linhas (
          {inteiroBr(anterior.novas)} novas, {inteiroBr(anterior.alteradas)} alteradas, {inteiroBr(anterior.removidas)}{' '}
          removidas).
        </p>
      )}
    </Bloco>
  );
}

export default function ForecastResumoDbcorp({
  resumo,
  onCompletar,
}: {
  resumo: ForecastDbcorpSummary;
  /** Abre o dialogo de completar o cadastro de um codigo pendente (sem a prop, a lista e so de leitura). */
  onCompletar?: (codigo: string, gatilho: HTMLElement) => void;
}) {
  const tituloRef = useFocoNoTitulo();
  const presentes = SLOTS_DBCORP.flatMap((s) => {
    const relatorio = resumo.relatorios[s.id];
    return relatorio ? [{ id: s.id, relatorio }] : [];
  });
  const vendas = presentes.filter((p) => ['vendasMes', 'vendasAtual', 'vendasAnual'].includes(p.id));
  const de = (id: ForecastDbcorpSlot) => resumo.relatorios[id];
  const saldo = de('saldo');
  const programacao = de('programacao');
  const fup = de('fup');

  return (
    <section className="fci-resumo" aria-labelledby="fci-resumo-dbcorp">
      <h3 id="fci-resumo-dbcorp" ref={tituloRef} tabIndex={-1}>
        Pré-visualização dos relatórios DBCorp
      </h3>
      <p className="fci-resumo__sub">
        Quinzena {resumo.label} · base {dataBr(resumo.baseDate)} · {resumo.half}ª quinzena · {inteiroBr(resumo.produtos.total)}{' '}
        produtos ativos
      </p>
      <p className="fci-resumo__sub">
        Chegadas: {resumo.meses.chegada.join(', ')} · Programação: {resumo.meses.programacao.join(', ')}
      </p>
      <AvisosEErros erros={resumo.erros} avisos={avisosSemRedundancia(resumo.avisos)} />
      <div className="table-wrapper">
        <table className="table">
          <caption className="sr-only">Resumo por relatório</caption>
          <thead>
            <tr>
              <th scope="col">Relatório</th>
              <th scope="col">Arquivo</th>
              <th scope="col">Lidas</th>
              <th scope="col">Usadas</th>
              <th scope="col">Ignoradas por motivo</th>
              <th scope="col">Total</th>
              <th scope="col">Casado com produtos</th>
              <th scope="col">Códigos sem produto</th>
            </tr>
          </thead>
          <tbody>
            {presentes.map(({ id, relatorio }) => (
              <tr key={id}>
                <th scope="row">{rotuloDoSlot(id)}</th>
                <td>{relatorio.fileName}</td>
                <td>{inteiroBr(relatorio.lidas)}</td>
                <td>
                  {inteiroBr(relatorio.usadas)}
                  {relatorio.usadas === 0 && (
                    <>
                      {' '}
                      <span className="badge badge--warning">sem linhas úteis</span>
                    </>
                  )}
                </td>
                <td>{ignoradasTexto(relatorio.ignoradas)}</td>
                <td>{inteiroBr(relatorio.total)}</td>
                <td>{inteiroBr(relatorio.totalCasado)}</td>
                <td>{inteiroBr(relatorio.codigosSemProduto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {resumo.pendentes && resumo.pendentes.totalItens > 0 && (
        <BlocoPendentes pendentes={resumo.pendentes} onCompletar={onCompletar} />
      )}
      {saldo && <BlocoSaldo relatorio={saldo} />}
      {vendas.length > 0 && (
        <Bloco titulo="VENDAS">
          {vendas.map(({ id, relatorio }) => (
            <p key={id}>
              {rotuloDoSlot(id)} — Empresas encontradas: {(relatorio.empresas ?? []).join(', ') || '—'}
            </p>
          ))}
        </Bloco>
      )}
      {programacao && <BlocoProgramacao relatorio={programacao} />}
      {fup && <BlocoFup relatorio={fup} />}
      <BlocoHistorico historico={resumo.historico} />
    </section>
  );
}
