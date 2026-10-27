import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { forecastFontesKeys } from '@/services/forecastFontes';
import { forecastPaisFonteErrorMessage, patchForecastSourceCountry } from '@/services/forecastOcasioes';
import { lerCodigoPais, nomeDoPais, type OpcaoPais } from './forecastOcasioes';
import ForecastPaisCampo from './ForecastPaisCampo';

interface Props {
  sourceId: number;
  nome: string;
  /** `undefined` = a lista de fontes nao carregou (so leitura, sem editar). */
  countryCode: string | null | undefined;
  podeEditar: boolean;
  opcoes: readonly OpcaoPais[];
  onSalvo: (mensagem: string) => void;
}

/** Celula "Pais" da tabela de fontes: leitura e edicao inline (admin e comprador). */
export default function ForecastFontePais({ sourceId, nome, countryCode, podeEditar, opcoes, onSalvo }: Props) {
  const queryClient = useQueryClient();
  const baseId = useId();
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState('');
  const [erroCampo, setErroCampo] = useState('');
  const [devolverFoco, setDevolverFoco] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);

  const salvar = useMutation({
    mutationFn: (codigo: string | null) => patchForecastSourceCountry(sourceId, codigo),
    onSuccess: async (_salva, codigo) => {
      await queryClient.invalidateQueries({ queryKey: forecastFontesKeys.todas });
      onSalvo(codigo === null ? `País de ${nome} removido.` : `País de ${nome} salvo: ${nomeDoPais(codigo)}.`);
      setEditando(false);
      setDevolverFoco(true);
    },
  });
  const pendente = salvar.isPending;

  // O botao "Editar" some durante a edicao: o foco volta a ele quando o formulario sai.
  useEffect(() => {
    if (devolverFoco && !editando) {
      botao.current?.focus();
      setDevolverFoco(false);
    }
  }, [devolverFoco, editando]);

  if (countryCode === undefined || !podeEditar) return <>{nomeDoPais(countryCode)}</>;

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (pendente) return;
    if (rascunho.trim() === '') {
      setErroCampo('');
      salvar.mutate(null);
      return;
    }
    const lido = lerCodigoPais(rascunho);
    if ('erro' in lido) {
      setErroCampo(lido.erro);
      return;
    }
    setErroCampo('');
    salvar.mutate(lido.codigo);
  };

  if (!editando) {
    return (
      <>
        <span className="fco-pais__texto">{nomeDoPais(countryCode)}</span>{' '}
        <button
          ref={botao}
          type="button"
          className="ghost-button fco-pais__editar"
          aria-label={`Editar país de ${nome}`}
          onClick={() => {
            salvar.reset();
            setErroCampo('');
            setRascunho(countryCode ?? '');
            setEditando(true);
          }}
        >
          Editar
        </button>
      </>
    );
  }

  const erroId = `${baseId}-erro`;
  return (
    <form className="fco-pais__form" onSubmit={enviar} noValidate>
      <ForecastPaisCampo
        id={`${baseId}-pais`}
        rotulo={`País de ${nome}`}
        valor={rascunho}
        onMudar={(c) => {
          salvar.reset();
          setErroCampo('');
          setRascunho(c);
        }}
        opcoes={opcoes}
        permitirVazio
        rotuloVazio="Sem país"
        invalido={Boolean(erroCampo)}
        descritoPor={erroCampo ? erroId : undefined}
        desabilitado={pendente}
      />
      {erroCampo && (
        <p className="fcd-erro" id={erroId} role="alert">
          {erroCampo}
        </p>
      )}
      {salvar.isError && (
        <p className="fcd-erro" role="alert">
          {forecastPaisFonteErrorMessage(salvar.error)}
        </p>
      )}
      <div className="modal-actions">
        <button
          type="submit"
          className="primary-button"
          aria-label={`Salvar país de ${nome}`}
          disabled={pendente}
          aria-busy={pendente}
        >
          {pendente ? 'Salvando…' : 'Salvar'}
        </button>
        <button
          type="button"
          className="ghost-button"
          aria-label={`Cancelar país de ${nome}`}
          disabled={pendente}
          onClick={() => {
            salvar.reset();
            setErroCampo('');
            setEditando(false);
            setDevolverFoco(true);
          }}
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
