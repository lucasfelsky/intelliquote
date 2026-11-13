import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import type { DadosToast } from '@/pages/Forecast/ForecastToast';
import {
  createIndentPendingOrgClient,
  listIndentPendingOrgs,
  type IndentPendingOrg,
  type IndentPendingOrgCandidate,
  type IndentPendingOrgCreateClientResult,
  type IndentPendingOrgLinkResult,
} from '@/services/indentPipedrive';
import { formatCnpj, isValidCnpj, maskCnpjInput, normalizeCnpj } from './cnpj';
import { mensagemDoErro } from './indentFila';
import IndentVincularModal from './IndentVincularModal';

// IQ Indent: "Fila de vinculo" da Integracao Pipedrive (mock v14, painel da direita). Organizacao do Pipedrive sem cliente cadastrado
// deixa a solicitacao parada ate alguem criar o cliente ou ligar a um existente. Varias organizacoes no mesmo negocio NUNCA vinculam
// sozinhas: o usuario escolhe pelos radios. Viewer so le (sem botoes). O IQ nunca escreve no Pipedrive.

type Mostrar = (tipo: DadosToast['tipo'], titulo: string, texto: string) => void;

interface IndentIntegracaoFilaProps {
  canWrite: boolean;
  mostrar: Mostrar;
}

interface AlvoAcao {
  pendencia: IndentPendingOrg;
  /** Organizacao escolhida; null = negocio sem organizacao (so "Vincular a existente"). */
  candidato: IndentPendingOrgCandidate | null;
}

function nomeDaOrg(candidato: IndentPendingOrgCandidate): string {
  return candidato.name.trim() === '' ? `Organização #${candidato.orgId}` : candidato.name;
}

function rotuloSolicitacao(pendencia: IndentPendingOrg): string {
  return pendencia.processNumber ? `Solicitação ${pendencia.processNumber}` : 'Solicitação (referência pendente)';
}

export default function IndentIntegracaoFila({ canWrite, mostrar }: IndentIntegracaoFilaProps) {
  const qc = useQueryClient();
  const fila = useQuery({ queryKey: ['indent', 'pending-orgs'], queryFn: listIndentPendingOrgs });
  const [escolhas, setEscolhas] = useState<Record<number, number>>({});
  const [vincular, setVincular] = useState<AlvoAcao | null>(null);
  const [novoCliente, setNovoCliente] = useState<AlvoAcao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [emCurso, setEmCurso] = useState<number | null>(null);

  // Depois de resolver, a linha some e o botao que abriu a acao sai do DOM: o foco volta para o titulo do painel (nao se perde no <body>).
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const [devolverFoco, setDevolverFoco] = useState(0);
  useEffect(() => {
    if (devolverFoco > 0) tituloRef.current?.focus();
  }, [devolverFoco]);

  const pendencias = fila.data?.data ?? [];
  const total = fila.data?.total ?? 0;

  function candidatoEscolhido(pendencia: IndentPendingOrg): IndentPendingOrgCandidate | null {
    const escolhida = escolhas[pendencia.id];
    return pendencia.candidates.find((entrada) => entrada.orgId === escolhida) ?? pendencia.candidates[0] ?? null;
  }

  function aoResolver() {
    setVincular(null);
    setNovoCliente(null);
    setErro(null);
    setDevolverFoco((n) => n + 1);
    void qc.invalidateQueries({ queryKey: ['indent'] });
  }

  function aoCriar(resultado: IndentPendingOrgCreateClientResult) {
    aoResolver();
    setAviso(null);
    mostrar('salvo', `Cliente “${resultado.client.name}” criado. Defina a restrição de fornecedores na aba Clientes`, '');
  }

  function aoVincular(resultado: IndentPendingOrgLinkResult, organizacao: string) {
    aoResolver();
    // CNPJ diferente nao bloqueia: o aviso fica visivel (alem do toast) ate ser dispensado.
    setAviso(
      resultado.cnpjDivergente
        ? `O CNPJ do cliente “${resultado.client.name}” é diferente do CNPJ da organização do Pipedrive. Confira o cadastro do cliente.`
        : null,
    );
    mostrar('salvo', `Organização vinculada a ${resultado.client.name}`, resultado.cnpjCompleted ? `CNPJ de ${organizacao} preenchido no cadastro do cliente.` : '');
  }

  const criarDireto = useMutation({
    mutationFn: ({ pendencia, candidato }: { pendencia: IndentPendingOrg; candidato: IndentPendingOrgCandidate }) =>
      createIndentPendingOrgClient(pendencia.id, { orgId: candidato.orgId }),
    onSuccess: (resultado) => aoCriar(resultado),
    onError: (err) => setErro(mensagemDoErro(err)),
    onSettled: () => setEmCurso(null),
  });

  function criarCliente(alvo: AlvoAcao) {
    // aria-disabled (e nao disabled) durante a chamada: o foco fica no botao.
    if (emCurso !== null || !alvo.candidato) return;
    setErro(null);
    // CNPJ valido na organizacao: cria direto. Ausente/invalido: abre "Novo cliente" preenchido (CNPJ opcional = "CNPJ pendente").
    if (alvo.candidato.cnpj !== null) {
      setEmCurso(alvo.pendencia.id);
      criarDireto.mutate({ pendencia: alvo.pendencia, candidato: alvo.candidato });
    } else {
      setNovoCliente(alvo);
    }
  }

  return (
    <section className="indent-painel" aria-labelledby="ii-fila-titulo">
      <div className="indent-painel__cabeca">
        <h2 id="ii-fila-titulo" ref={tituloRef} tabIndex={-1}>
          Fila de vínculo
        </h2>
        {fila.data &&
          (total > 0 ? (
            <span className="indent-tag indent-tag--manual">{total} {total === 1 ? 'pendente' : 'pendentes'}</span>
          ) : (
            <span className="indent-tag indent-tag--ok">Em dia</span>
          ))}
      </div>
      <p className="indent-cell-sub indent-painel__nota">
        Organizações do Pipedrive sem cliente cadastrado (sem CNPJ correspondente). As solicitações delas ficam paradas até o vínculo.
      </p>

      {fila.isError && (
        <div role="alert" className="alert alert--error">
          Não foi possível carregar a fila de vínculo: {mensagemDoErro(fila.error)}
        </div>
      )}
      {erro && (
        <div role="alert" className="alert alert--error">
          {erro}
        </div>
      )}
      {aviso && (
        <div role="status" className="alert alert--warning">
          {aviso}{' '}
          <button type="button" className="ghost-button" onClick={() => setAviso(null)}>
            Entendi
          </button>
        </div>
      )}

      {fila.isLoading && (
        <div className="indent-vazio" role="status">
          Carregando a fila de vínculo…
        </div>
      )}

      {fila.data && pendencias.length === 0 && <div className="indent-vazio">Nenhuma pendência.</div>}

      {pendencias.map((pendencia) => {
        const candidatos = pendencia.candidates;
        const varias = candidatos.length > 1;
        const escolhido = candidatoEscolhido(pendencia);
        const unico = candidatos.length === 1 ? candidatos[0] : undefined;
        const ocupada = emCurso === pendencia.id;
        const alvo: AlvoAcao = { pendencia, candidato: escolhido };
        return (
          <div key={pendencia.id} className="indent-fila-item">
            <div className="indent-fila-item__texto">
              <strong>{unico ? nomeDaOrg(unico) : rotuloSolicitacao(pendencia)}</strong>
              <small>
                {unico
                  ? `Org #${unico.orgId} · ${unico.cnpj ? `CNPJ ${formatCnpj(unico.cnpj)}` : 'sem CNPJ'}`
                  : `Pipedrive #${pendencia.dealId}${candidatos.length === 0 ? ' · negócio sem organização' : ''}`}
              </small>
              {varias && (
                <fieldset className="indent-orgs">
                  <legend>Negócio com {candidatos.length} organizações. Qual é o cliente?</legend>
                  {candidatos.map((candidato) => (
                    <label key={candidato.orgId} className="indent-orgopt">
                      <input
                        type="radio"
                        name={`org-${pendencia.id}`}
                        value={candidato.orgId}
                        checked={escolhido?.orgId === candidato.orgId}
                        disabled={!canWrite}
                        onChange={() => setEscolhas((atual) => ({ ...atual, [pendencia.id]: candidato.orgId }))}
                      />
                      <span>
                        {nomeDaOrg(candidato)} <small>Org #{candidato.orgId}</small>
                      </span>
                    </label>
                  ))}
                  <small>Todas as organizações deste negócio vêm da mesma solicitação {pendencia.processNumber ?? '(referência pendente)'}.</small>
                </fieldset>
              )}
            </div>
            {canWrite && (
              <span className="indent-fila-item__acoes">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setErro(null);
                    setVincular({ pendencia, candidato: escolhido });
                  }}
                >
                  Vincular a existente
                </button>
                {escolhido && (
                  <button
                    type="button"
                    className="ghost-button"
                    aria-disabled={ocupada ? true : undefined}
                    onClick={() => criarCliente(alvo)}
                  >
                    Criar cliente
                  </button>
                )}
              </span>
            )}
          </div>
        );
      })}

      {vincular && (
        <IndentVincularModal
          pendenciaId={vincular.pendencia.id}
          titulo={vincular.candidato ? nomeDaOrg(vincular.candidato) : rotuloSolicitacao(vincular.pendencia)}
          candidato={vincular.candidato}
          onClose={() => {
            setVincular(null);
            // Outra pessoa pode ter resolvido a pendencia enquanto o modal estava aberto (409): a fila e relida.
            void qc.invalidateQueries({ queryKey: ['indent', 'pending-orgs'] });
          }}
          onLinked={(resultado) => aoVincular(resultado, vincular.candidato ? nomeDaOrg(vincular.candidato) : 'organização')}
        />
      )}

      {novoCliente && novoCliente.candidato && (
        <NovoClienteModal
          pendenciaId={novoCliente.pendencia.id}
          candidato={novoCliente.candidato}
          onClose={() => setNovoCliente(null)}
          onCreated={aoCriar}
        />
      )}

      {fila.data && total > pendencias.length && (
        <p className="indent-cell-sub indent-painel__nota">
          Mostrando as {pendencias.length} mais antigas de {total} pendências.
        </p>
      )}
    </section>
  );
}

interface NovoClienteModalProps {
  pendenciaId: number;
  candidato: IndentPendingOrgCandidate;
  onClose: () => void;
  onCreated: (resultado: IndentPendingOrgCreateClientResult) => void;
}

// "Criar cliente" de uma organizacao SEM CNPJ valido: o modal "Novo cliente" (Razao social, CNPJ opcional = "CNPJ pendente", Cidade) abre
// preenchido com a organizacao; o cliente nasce com a Org # do Pipedrive e liga a solicitacao.
function NovoClienteModal({ pendenciaId, candidato, onClose, onCreated }: NovoClienteModalProps) {
  const [nome, setNome] = useState(candidato.name);
  const [cnpj, setCnpj] = useState('');
  const [cidade, setCidade] = useState(candidato.city ?? '');
  const [erroNome, setErroNome] = useState<string | null>(null);
  const [erroCnpj, setErroCnpj] = useState<string | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);

  const criar = useMutation({
    mutationFn: () => {
      const digitos = normalizeCnpj(cnpj);
      return createIndentPendingOrgClient(pendenciaId, {
        orgId: candidato.orgId,
        name: nome.trim(),
        ...(digitos === '' ? {} : { cnpj: digitos }),
        ...(cidade.trim() === '' ? {} : { city: cidade.trim() }),
      });
    },
    onSuccess: onCreated,
    onError: (err) => setErroForm(mensagemDoErro(err)),
  });

  function enviar(event: FormEvent) {
    event.preventDefault();
    if (criar.isPending) return;
    setErroForm(null);
    const semNome = nome.trim().length === 0;
    // CNPJ e opcional (vazio = CNPJ pendente); preenchido, tem de ser valido (a mesma regra do backend).
    const cnpjInvalido = normalizeCnpj(cnpj) !== '' && !isValidCnpj(cnpj);
    setErroNome(semNome ? 'Informe a razão social.' : null);
    setErroCnpj(cnpjInvalido ? 'CNPJ inválido.' : null);
    if (semNome || cnpjInvalido) return;
    criar.mutate();
  }

  return (
    <Modal isOpen restoreFocus onClose={onClose} title="Novo cliente">
      <form onSubmit={enviar} noValidate className="indent-form">
        {erroForm && (
          <div role="alert" className="alert alert--error">
            {erroForm}
          </div>
        )}
        <p className="indent-cell-sub indent-painel__nota">A Org #{candidato.orgId} do Pipedrive será vinculada a este cliente e a solicitação deixa de ficar parada.</p>
        <div className="indent-campos">
          <div className="field">
            <label className="field-label" htmlFor="ii-nc-nome">
              Razão social
            </label>
            <input
              id="ii-nc-nome"
              className="input"
              data-autofocus
              value={nome}
              aria-invalid={erroNome ? true : undefined}
              onChange={(event) => setNome(event.target.value)}
            />
            {erroNome && (
              <p className="field-error" role="alert">
                {erroNome}
              </p>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ii-nc-cnpj">
              CNPJ
            </label>
            <input
              id="ii-nc-cnpj"
              className="input"
              inputMode="numeric"
              autoComplete="off"
              value={cnpj}
              aria-invalid={erroCnpj ? true : undefined}
              onChange={(event) => setCnpj(maskCnpjInput(event.target.value))}
            />
            <span className="field-hint">Opcional. Sem CNPJ o cliente fica como CNPJ pendente.</span>
            {erroCnpj && (
              <p className="field-error" role="alert">
                {erroCnpj}
              </p>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ii-nc-cidade">
              Cidade
            </label>
            <input id="ii-nc-cidade" className="input" value={cidade} onChange={(event) => setCidade(event.target.value)} />
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary-button" aria-disabled={criar.isPending ? true : undefined}>
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
}
