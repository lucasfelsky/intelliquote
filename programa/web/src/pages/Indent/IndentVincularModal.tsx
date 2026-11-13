import { FormEvent, useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Icon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { listIndentClients, type IndentClient } from '@/services/indent';
import {
  linkIndentPendingOrg,
  type IndentPendingOrgCandidate,
  type IndentPendingOrgLinkResult,
} from '@/services/indentPipedrive';
import { formatCnpj } from './cnpj';
import { mensagemDoErro } from './indentFila';

// IQ Indent: "Vincular a existente" da fila de vinculo da Integracao Pipedrive (no mock v14 era um toast de protótipo; aqui e um modal).
// Busca no cadastro de clientes (GET /clients?q=), escolhe um por radio e liga a pendencia. O IQ nunca escreve no Pipedrive: o vinculo
// grava a Org # no cliente (e completa o CNPJ de cliente sem CNPJ, P5). CNPJ diferente do da organizacao AVISA, nao bloqueia.

const PAGE_SIZE = 20;

interface IndentVincularModalProps {
  pendenciaId: number;
  /** Titulo do modal: nome da organizacao escolhida (ou a solicitacao, quando o negocio nao tem organizacao). */
  titulo: string;
  /** Organizacao do Pipedrive a ligar; null = negocio sem organizacao (so o cliente e ligado). */
  candidato: IndentPendingOrgCandidate | null;
  onClose: () => void;
  onLinked: (resultado: IndentPendingOrgLinkResult) => void;
}

export default function IndentVincularModal({ pendenciaId, titulo, candidato, onClose, onLinked }: IndentVincularModalProps) {
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [escolhido, setEscolhido] = useState<IndentClient | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // A busca vai ao servidor; o atraso evita uma chamada por tecla.
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(busca.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [busca]);

  const clientes = useQuery({
    queryKey: ['indent', 'clients', 'vincular', { q }],
    queryFn: () => listIndentClients({ q, page: 1, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const vincular = useMutation({
    mutationFn: (cliente: IndentClient) =>
      linkIndentPendingOrg(pendenciaId, candidato ? { orgId: candidato.orgId, clientId: cliente.id } : { clientId: cliente.id }),
    onSuccess: (resultado) => onLinked(resultado),
    onError: (err) => setErro(mensagemDoErro(err)),
  });

  const linhas = clientes.data?.data ?? [];
  const total = clientes.data?.pagination.totalItems ?? 0;

  // Cliente ja ligado a OUTRA organizacao nao pode receber esta (o backend responde 409): nem entra na escolha.
  function ligadoAOutra(cliente: IndentClient): boolean {
    return candidato !== null && cliente.pipedriveOrgId !== null && cliente.pipedriveOrgId !== candidato.orgId;
  }

  const cnpjDaOrg = candidato?.cnpj ?? null;
  const divergente = escolhido !== null && escolhido.cnpj !== null && cnpjDaOrg !== null && escolhido.cnpj !== cnpjDaOrg;
  const completaCnpj = escolhido !== null && escolhido.cnpj === null && cnpjDaOrg !== null;

  function enviar(event: FormEvent) {
    event.preventDefault();
    // aria-disabled (e nao disabled) enquanto envia: o foco fica no botao.
    if (vincular.isPending) return;
    setErro(null);
    if (!escolhido) {
      setErro('Escolha o cliente que deve receber esta organização.');
      return;
    }
    vincular.mutate(escolhido);
  }

  return (
    <Modal isOpen restoreFocus onClose={onClose} eyebrow="Fila de vínculo" title={titulo}>
      <form onSubmit={enviar} noValidate className="indent-form">
        {erro && (
          <div role="alert" className="alert alert--error">
            {erro}
          </div>
        )}

        {candidato && (
          <p className="indent-cell-sub indent-painel__nota">
            Org #{candidato.orgId} · {cnpjDaOrg ? `CNPJ ${formatCnpj(cnpjDaOrg)}` : 'sem CNPJ'}
          </p>
        )}

        <label className="indent-busca indent-busca--cheia">
          <Icon name="search" size={18} />
          <span className="sr-only">Buscar cliente por nome ou CNPJ</span>
          <input
            className="indent-busca__campo"
            type="search"
            data-autofocus
            placeholder="Buscar cliente por nome ou CNPJ"
            autoComplete="off"
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            // Enter na busca nao envia o formulario: vincular e sempre um clique no botao.
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
        </label>

        <div className="indent-lista-caixa" role="radiogroup" aria-label="Clientes">
          {clientes.isLoading && (
            <div className="indent-vazio" role="status">
              Carregando clientes…
            </div>
          )}
          {clientes.isError && (
            <div className="indent-vazio" role="alert">
              Não foi possível carregar os clientes: {mensagemDoErro(clientes.error)}
            </div>
          )}
          {!clientes.isLoading && !clientes.isError && linhas.length === 0 && <div className="indent-vazio">Nenhum cliente encontrado.</div>}
          {linhas.map((cliente) => {
            const bloqueado = ligadoAOutra(cliente);
            return (
              <div key={cliente.id} className="indent-check">
                <label>
                  <input
                    type="radio"
                    name="indent-vincular-cliente"
                    value={cliente.id}
                    checked={escolhido?.id === cliente.id}
                    disabled={bloqueado}
                    onChange={() => {
                      setEscolhido(cliente);
                      setErro(null);
                    }}
                  />
                  <span>{cliente.name}</span>
                  {cliente.cnpj === null ? (
                    <span className="indent-tag indent-tag--manual">CNPJ pendente</span>
                  ) : (
                    <span className="indent-cell-sub">{formatCnpj(cliente.cnpj)}</span>
                  )}
                  {cliente.city && <span className="indent-cell-sub">{cliente.city}</span>}
                  {bloqueado && <span className="indent-cell-sub">Já vinculado à Org #{cliente.pipedriveOrgId}</span>}
                </label>
              </div>
            );
          })}
        </div>
        {total > PAGE_SIZE && <span className="field-hint">Mostrando {PAGE_SIZE} de {total} clientes. Refine a busca para achar o cliente.</span>}

        {divergente && (
          <div role="status" className="alert alert--warning">
            O CNPJ deste cliente ({formatCnpj(escolhido.cnpj)}) é diferente do CNPJ da organização do Pipedrive ({formatCnpj(cnpjDaOrg)}). Você pode vincular mesmo assim,
            se for o mesmo grupo ou uma filial.
          </div>
        )}
        {completaCnpj && (
          <div role="status" className="alert alert--info">
            Este cliente não tem CNPJ: ao vincular, o CNPJ da organização ({formatCnpj(cnpjDaOrg)}) será preenchido no cadastro dele.
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="primary-button" disabled={escolhido === null} aria-disabled={vincular.isPending ? true : undefined}>
            Vincular
          </button>
        </div>
      </form>
    </Modal>
  );
}
