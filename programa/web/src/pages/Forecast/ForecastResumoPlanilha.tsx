import { useEffect, useRef } from 'react';
import type { ForecastImportSummary } from '@/services/forecast';
import { mesAno } from './forecastImport';
import { dataBr, inteiroBr, textoDoSelo } from './forecastPainel';

/** Erros (bloqueiam o Confirmar) e avisos (texto do backend, como vem). */
export function AvisosEErros({ erros, avisos }: { erros: string[]; avisos: string[] }) {
  return (
    <>
      {erros.length > 0 && (
        <div className="alert alert--error" role="alert">
          <strong>Corrija antes de confirmar:</strong>
          <ul className="fci-lista">
            {erros.map((erro, i) => (
              <li key={i}>{erro}</li>
            ))}
          </ul>
        </div>
      )}
      <div aria-live="polite">
        {avisos.length > 0 && (
          <div className="fci-avisos">
            <strong>Avisos</strong>
            <ul className="fci-lista">
              {avisos.map((aviso, i) => (
                <li key={i}>{aviso}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}

/** Titulo do resumo: recebe o foco quando o preview chega. */
export function useFocoNoTitulo() {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

export default function ForecastResumoPlanilha({ resumo }: { resumo: ForecastImportSummary }) {
  const tituloRef = useFocoNoTitulo();
  const { produtos, codigos, fontes, historico } = resumo;
  const selo = resumo.erros.length === 0 ? textoDoSelo({ conferencia: resumo.conferencia, half: resumo.half }) : null;

  return (
    <section className="fci-resumo" aria-labelledby="fci-resumo-planilha">
      <h3 id="fci-resumo-planilha" ref={tituloRef} tabIndex={-1}>
        Pré-visualização da planilha
      </h3>
      <p className="fci-resumo__sub">
        Quinzena {resumo.label} · base {dataBr(resumo.baseDate)} · {resumo.half}ª quinzena
      </p>
      <AvisosEErros erros={resumo.erros} avisos={resumo.avisos} />
      <div className="table-wrapper">
        <table className="table">
          <caption className="sr-only">O que a importação da planilha vai gravar</caption>
          <thead>
            <tr>
              <th scope="col">Grupo</th>
              <th scope="col">Total</th>
              <th scope="col">Detalhe</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Produtos</th>
              <td>{inteiroBr(produtos.total)}</td>
              <td>
                novos {inteiroBr(produtos.novos)} · alterados {inteiroBr(produtos.alterados)} · inativados{' '}
                {inteiroBr(produtos.inativados)}
              </td>
            </tr>
            <tr>
              <th scope="row">Códigos</th>
              <td>{inteiroBr(codigos.total)}</td>
              <td>
                vinculados ao catálogo {inteiroBr(codigos.vinculadosCatalogo)} · movidos {inteiroBr(codigos.movidos)}
              </td>
            </tr>
            <tr>
              <th scope="row">Fontes</th>
              <td>{inteiroBr(fontes.total)}</td>
              <td>
                novas {inteiroBr(fontes.novas)} · alteradas {inteiroBr(fontes.alteradas)} · com fornecedor{' '}
                {inteiroBr(fontes.comFornecedor)}
              </td>
            </tr>
            <tr>
              <th scope="row">{historico.yearMonth ? `Histórico de ${mesAno(historico.yearMonth)}` : 'Histórico'}</th>
              <td>{inteiroBr(historico.linhas)}</td>
              <td>
                novas {inteiroBr(historico.novas)} · alteradas {inteiroBr(historico.alteradas)} · removidas{' '}
                {inteiroBr(historico.removidas)} — o mês é substituído por inteiro
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {selo && (
        <div className={`fc-selo-conferencia fc-selo-conferencia--${selo.tom}`}>
          <strong>{selo.titulo}</strong>
          {selo.detalhe && <span>{selo.detalhe}</span>}
          {selo.nota && <span className="fc-selo-conferencia__nota">{selo.nota}</span>}
        </div>
      )}
    </section>
  );
}
