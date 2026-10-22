import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/client';
import { Modal } from '@/components/Modal';
import { Tab, TabList, TabPanel, Tabs } from '@/components/Tabs';
import {
  confirmForecastDbcorp,
  confirmForecastWorkbook,
  forecastImportErrorMessage,
  ForecastLocalError,
  previewForecastDbcorp,
  previewForecastWorkbook,
  type ForecastDbcorpBody,
  type ForecastDbcorpSlot,
  type ForecastDbcorpSummary,
  type ForecastImportOptions,
  type ForecastImportSummary,
  type ForecastWorkbookBody,
} from '@/services/forecast';
import { inteiroBr } from './forecastPainel';
import { inativosDosPendentes, useDialogoCompletar } from './ForecastPendentesCadastro';
import ForecastResumoDbcorp from './ForecastResumoDbcorp';
import ForecastResumoPlanilha from './ForecastResumoPlanilha';
import {
  dataBaseValida,
  faltando,
  lerCorpoDbcorp,
  lerCorpoPlanilha,
  mesAno,
  prontidaoPendente,
  rotuloDaQuinzena,
  rotuloDoSlot,
  slotsSemLinhasUteis,
  SLOTS_DBCORP,
  textoEntendiProntidao,
} from './forecastImport';
import { mensagemCadastroNaPrevia, type EstadoPrevia } from './forecastPendentes';
import type { ResultadoCadastro } from './ForecastCompletarCadastroModal';

type Aba = 'planilha' | 'dbcorp';
type Fase = 'lendo' | 'previa' | 'gravando' | null;
type Previa =
  | { aba: 'planilha'; corpo: ForecastWorkbookBody; resumo: ForecastImportSummary }
  | { aba: 'dbcorp'; corpo: ForecastDbcorpBody; resumo: ForecastDbcorpSummary };

interface Props {
  aberto: boolean;
  onFechar: () => void;
  /** Rotulos (`MM-q`) das quinzenas que a pagina ja carregou. */
  quinzenasExistentes: string[];
  onImportada: (snapshotId: number, label: string) => void;
}

const ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const OPCOES_INICIAIS: ForecastImportOptions = { atualizarCadastro: true, gravarHistorico: true, criarQuinzena: true };

function tamanhoLegivel(bytes: number): string {
  const [valor, unidade] = bytes < 1024 * 1024 ? [bytes / 1024, 'KB'] : [bytes / (1024 * 1024), 'MB'];
  return `${valor.toFixed(1).replace('.', ',')} ${unidade}`;
}

function ArquivoEscolhido({ file, onRemover }: { file: File; onRemover: () => void }) {
  return (
    <p className="fci-slot__arquivo">
      Selecionado: {file.name} ({tamanhoLegivel(file.size)}){' '}
      <button type="button" className="ghost-button ghost-button--sm" onClick={onRemover} aria-label={`Remover ${file.name}`}>
        Remover
      </button>
    </p>
  );
}

function ImportModal({ onFechar, quinzenasExistentes, onImportada }: Omit<Props, 'aberto'>) {
  const queryClient = useQueryClient();
  const [aba, setAba] = useState<Aba>('planilha');
  const [baseDate, setBaseDate] = useState('');
  const [quinzena, setQuinzena] = useState<1 | 2 | null>(null);
  const [planilha, setPlanilha] = useState<File | null>(null);
  const [relatorios, setRelatorios] = useState<Partial<Record<ForecastDbcorpSlot, File>>>({});
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [entendi, setEntendi] = useState(false);
  const [entendiProntidao, setEntendiProntidao] = useState(false);
  const [opcoes, setOpcoes] = useState<ForecastImportOptions>(OPCOES_INICIAIS);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState('');
  const [fase, setFase] = useState<Fase>(null);
  // Retorno do "Completar cadastro" dentro do import: o cadastro gravou e a pre-visualizacao roda de novo.
  const [cadastro, setCadastro] = useState<{ resultado: ResultadoCadastro; estado: EstadoPrevia } | null>(null);
  const cadastroRef = useRef<HTMLDivElement>(null);
  // Muda a `key` do <input type="file"> ao remover: o campo volta vazio e reescolher o mesmo arquivo dispara `change`.
  const [versoesInput, setVersoesInput] = useState<Record<string, number>>({});
  const emCurso = useRef(false);
  const erroRef = useRef<HTMLDivElement>(null);

  // O dialogo rola por dentro: leva a mensagem de erro (no fim) para a vista.
  useEffect(() => {
    if (erro) erroRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [erro]);

  // O botao do codigo some quando ele sai da lista: o foco vai para a mensagem de retorno (aria-live).
  useEffect(() => {
    if (cadastro?.estado === 'atualizando') cadastroRef.current?.focus();
  }, [cadastro?.estado]);

  const rotulo = rotuloDaQuinzena(baseDate, quinzena);
  const rotuloExiste = rotulo !== '' && quinzenasExistentes.includes(rotulo);
  const ocupado = fase !== null;

  // A nova pre-visualizacao pos-cadastro falhou: a previa antiga ainda lista como FORA o codigo que acabou de ser
  // cadastrado e o confirm (que re-le os arquivos) ja o incluiria. Descarta a previa e as caixas "Entendi".
  useEffect(() => {
    if (cadastro?.estado !== 'falhou') return;
    setPrevia(null);
    setEntendi(false);
    setEntendiProntidao(false);
  }, [cadastro?.estado]);

  const descartar = () => {
    setCadastro(null);
    setPrevia(null);
    setEntendi(false);
    setEntendiProntidao(false);
    setErro('');
  };

  const avisarSeInconclusivo = (err: unknown) => {
    if (err instanceof ApiError && [502, 503, 504].includes(err.status)) {
      void queryClient.invalidateQueries({ queryKey: ['forecast'] });
    }
  };

  const aoFalhar = {
    onError: (err: unknown) => {
      setErro(forecastImportErrorMessage(err, rotulo));
      setCadastro((c) => (c?.estado === 'atualizando' ? { ...c, estado: 'falhou' } : c));
      avisarSeInconclusivo(err);
    },
    onSettled: () => {
      setFase(null);
      emCurso.current = false;
    },
  };

  // gcTime 0: o corpo em base64 (ate ~10 MB) nao fica retido no cache de mutations depois de fechar o modal.
  const previsualizar = useMutation({
    gcTime: 0,
    mutationFn: async (): Promise<Previa> => {
      setFase('lendo');
      if (aba === 'planilha') {
        if (!planilha) throw new ForecastLocalError('Escolha o arquivo da planilha.');
        const corpo = await lerCorpoPlanilha(planilha, rotulo, baseDate);
        setFase('previa');
        return { aba: 'planilha', corpo, resumo: await previewForecastWorkbook(corpo) };
      }
      const corpo = await lerCorpoDbcorp(relatorios, rotulo, baseDate);
      setFase('previa');
      return { aba: 'dbcorp', corpo, resumo: await previewForecastDbcorp(corpo) };
    },
    onSuccess: (pronta) => {
      setPrevia(pronta);
      setEntendi(false);
      setEntendiProntidao(false);
      setCadastro((c) => (c?.estado === 'atualizando' ? { ...c, estado: 'atualizada' } : c));
    },
    ...aoFalhar,
  });

  const confirmar = useMutation({
    gcTime: 0,
    mutationFn: async (congelada: Previa) => {
      setFase('gravando');
      if (congelada.aba === 'planilha') {
        return confirmForecastWorkbook(congelada.corpo, opcoesEfetivas(congelada.resumo));
      }
      return confirmForecastDbcorp(congelada.corpo);
    },
    onSuccess: (dados, congelada) => {
      if (dados.snapshotId === null) {
        void queryClient.invalidateQueries({ queryKey: ['forecast'] });
        setResultado('Importação concluída. Nenhuma quinzena nova foi criada.');
        return;
      }
      onImportada(dados.snapshotId, congelada.corpo.label);
    },
    ...aoFalhar,
  });

  const historicoGravavel = (r: ForecastImportSummary) => r.historico.linhas > 0 && r.historico.yearMonth !== null;
  function opcoesEfetivas(r: ForecastImportSummary): ForecastImportOptions {
    return {
      atualizarCadastro: opcoes.atualizarCadastro,
      gravarHistorico: opcoes.gravarHistorico && historicoGravavel(r),
      criarQuinzena: opcoes.criarQuinzena && !rotuloExiste,
    };
  }

  const fechar = () => {
    if (!confirmar.isPending) onFechar();
  };

  const limparInput = (chave: string) => setVersoesInput((atual) => ({ ...atual, [chave]: (atual[chave] ?? 0) + 1 }));

  const alterar = (fn: () => void) => {
    fn();
    descartar();
  };

  const trocarAba = (valor: string) => {
    if (ocupado || (valor !== 'planilha' && valor !== 'dbcorp')) return;
    setAba(valor);
    descartar();
  };

  const faltas = [
    ...(dataBaseValida(baseDate) ? [] : ['data-base']),
    ...(quinzena === null ? ['quinzena'] : []),
    ...(aba === 'planilha'
      ? planilha
        ? []
        : ['arquivo da planilha']
      : faltando(relatorios, quinzena).map(rotuloDoSlot)),
  ];

  const aoPrevisualizar = () => {
    if (emCurso.current || faltas.length > 0) return;
    emCurso.current = true;
    setErro('');
    setFase('lendo');
    previsualizar.mutate();
  };

  // Cadastro gravado: pre-visualiza de novo com os MESMOS arquivos (o backend re-le; nada vem do cliente).
  const dialogo = useDialogoCompletar((resultado) => {
    if (emCurso.current) return;
    emCurso.current = true;
    setErro('');
    setCadastro({ resultado, estado: 'atualizando' });
    setFase('lendo');
    previsualizar.mutate();
  });

  const aoConfirmar = () => {
    if (emCurso.current || !previa) return;
    emCurso.current = true;
    setErro('');
    setFase('gravando');
    confirmar.mutate(previa);
  };

  const semLinhas = previa?.aba === 'dbcorp' ? slotsSemLinhasUteis(previa.resumo) : [];
  const prontidao = previa?.aba === 'dbcorp' ? prontidaoPendente(previa.resumo) : null;
  const efetivas = previa?.aba === 'planilha' ? opcoesEfetivas(previa.resumo) : null;
  const nenhumaOpcao = efetivas !== null && !efetivas.atualizarCadastro && !efetivas.gravarHistorico && !efetivas.criarQuinzena;
  const confirmarBloqueado =
    !previa ||
    previa.resumo.erros.length > 0 ||
    nenhumaOpcao ||
    (previa.aba === 'dbcorp' && (rotuloExiste || (semLinhas.length > 0 && !entendi) || (prontidao !== null && !entendiProntidao)));
  const rotuloDoBotao =
    fase === 'lendo' ? 'Lendo arquivos…' : fase === 'previa' ? 'Pré-visualizando…' : fase === 'gravando' ? 'Gravando…' : null;

  function escolherSlot(id: ForecastDbcorpSlot, file: File | null) {
    setRelatorios((atual) => {
      const proximo = { ...atual };
      if (file) proximo[id] = file;
      else delete proximo[id];
      return proximo;
    });
    descartar();
  }

  return (
    <Modal isOpen onClose={fechar} title="Importar quinzena" size="xl">
      <div className="fci-modal" aria-busy={ocupado}>
        {resultado ? (
          <>
            <div className="alert alert--success" role="status">{resultado}</div>
            <div className="modal-actions">
              <button type="button" className="primary-button" onClick={onFechar}>Concluir</button>
            </div>
          </>
        ) : (
          <>
            <fieldset className="fci-fieldset" disabled={ocupado}>
              <div className="fci-comuns">
                <div>
                  <label className="field-label" htmlFor="fci-data-base">
                    Data-base
                  </label>
                  <input
                    id="fci-data-base"
                    className="input"
                    type="date"
                    value={baseDate}
                    onChange={(e) => alterar(() => setBaseDate(e.target.value))}
                  />
                </div>
                <fieldset className="fci-quinzena">
                  <legend className="field-label">Quinzena</legend>
                  <div className="fci-quinzena__opcoes">
                    {([1, 2] as const).map((q) => (
                      <label key={q} className="checkbox-field">
                        <input
                          type="radio"
                          name="fci-quinzena"
                          value={q}
                          checked={quinzena === q}
                          onChange={() => alterar(() => setQuinzena(q))}
                        />
                        {q}ª
                      </label>
                    ))}
                  </div>
                </fieldset>
                <p className="fci-rotulo">Rótulo: {rotulo || '—'}</p>
              </div>
              {rotuloExiste && aba === 'dbcorp' && (
                <div className="alert alert--error" role="alert">Já existe a quinzena {rotulo}. A confirmação será recusada.</div>
              )}

              <Tabs value={aba} onValueChange={trocarAba} baseId="fci">
                <TabList aria-label="Origem dos dados">
                  <Tab value="planilha">Planilha (.xlsx)</Tab>
                  <Tab value="dbcorp">Relatórios DBCorp</Tab>
                </TabList>
                <TabPanel value="planilha">
                  <label className="field-label" htmlFor="fci-planilha">
                    Arquivo da planilha
                  </label>
                  <input
                    key={`planilha-${versoesInput.planilha ?? 0}`}
                    id="fci-planilha"
                    className="file-input"
                    type="file"
                    accept={ACCEPT}
                    onChange={(e) => alterar(() => setPlanilha(e.target.files?.[0] ?? null))}
                  />
                  {planilha && <ArquivoEscolhido file={planilha} onRemover={() => {
                    limparInput('planilha');
                    alterar(() => setPlanilha(null));
                  }} />}
                </TabPanel>
                <TabPanel value="dbcorp">
                  <div className="fci-slots">
                    {SLOTS_DBCORP.map((slot) => {
                      const file = relatorios[slot.id];
                      const obrigatorio = slot.obrigatorio(quinzena);
                      return (
                        <div key={slot.id} className="fci-slot">
                          <div className="fci-slot__topo">
                            <label className="field-label" htmlFor={`fci-slot-${slot.id}`}>
                              {slot.rotulo}
                            </label>
                            <span className={obrigatorio ? 'badge badge--info' : 'badge badge--muted'}>
                              {obrigatorio ? 'obrigatório' : 'opcional'}
                            </span>
                          </div>
                          {(slot.origem || slot.ajuda) && (
                            <p className="fci-slot__ajuda">
                              {[slot.origem ? `DBCORP · ${slot.origem}` : '', slot.ajuda ?? ''].filter(Boolean).join(' — ')}
                            </p>
                          )}
                          <input
                            key={`${slot.id}-${versoesInput[slot.id] ?? 0}`}
                            id={`fci-slot-${slot.id}`}
                            className="file-input"
                            type="file"
                            accept={ACCEPT}
                            onChange={(e) => escolherSlot(slot.id, e.target.files?.[0] ?? null)}
                          />
                          {file && <ArquivoEscolhido file={file} onRemover={() => {
                    limparInput(slot.id);
                    escolherSlot(slot.id, null);
                  }} />}
                        </div>
                      );
                    })}
                  </div>
                </TabPanel>
              </Tabs>
            </fieldset>

            {faltas.length > 0 && <p className="fci-faltam">Faltam: {faltas.join(', ')}</p>}

            {previa?.aba === 'planilha' && <ForecastResumoPlanilha resumo={previa.resumo} />}
            {cadastro && (
              <div ref={cadastroRef} className="alert alert--success" role="status" tabIndex={-1}>
                {mensagemCadastroNaPrevia(cadastro.resultado, cadastro.estado)}
              </div>
            )}
            {previa?.aba === 'dbcorp' && <ForecastResumoDbcorp resumo={previa.resumo} onCompletar={dialogo.abrir} />}

            {previa?.aba === 'planilha' && efetivas && (
              <fieldset className="fci-opcoes" disabled={ocupado}>
                <legend className="field-label">O que gravar</legend>
                {(
                  [
                    ['atualizarCadastro', 'Atualizar cadastro (produtos, códigos e fontes)', false],
                    ['gravarHistorico', 'Gravar histórico de ' + mesAno(previa.resumo.historico.yearMonth), !historicoGravavel(previa.resumo)],
                    ['criarQuinzena', 'Criar a quinzena ' + rotulo, rotuloExiste],
                  ] as const
                ).map(([chave, texto, desabilitada]) => (
                  <label key={chave} className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={efetivas[chave]}
                      disabled={desabilitada}
                      onChange={(e) => setOpcoes({ ...opcoes, [chave]: e.target.checked })}
                    />
                    {texto}
                  </label>
                ))}
                {rotuloExiste && <p className="fci-faltam">Já existe a quinzena {rotulo}: ela não pode ser criada de novo.</p>}
                {nenhumaOpcao && <p className="fci-faltam">Marque ao menos uma opção.</p>}
              </fieldset>
            )}

            {semLinhas.length > 0 && (
              <label className="fci-entendi">
                <input type="checkbox" checked={entendi} disabled={ocupado} onChange={(e) => setEntendi(e.target.checked)} />
                <span>
                  Entendi que {semLinhas.map(rotuloDoSlot).join(', ')} {semLinhas.length > 1 ? 'vieram' : 'veio'} sem linhas
                  úteis e quero criar a quinzena assim mesmo.
                </span>
              </label>
            )}

            {prontidao && (
              <label className="fci-entendi">
                <input
                  type="checkbox"
                  checked={entendiProntidao}
                  disabled={ocupado}
                  onChange={(e) => setEntendiProntidao(e.target.checked)}
                />
                <span>{textoEntendiProntidao(prontidao, inteiroBr)}</span>
              </label>
            )}

            {erro && (
              <div ref={erroRef} className="alert alert--error" role="alert">{erro}</div>
            )}

            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={fechar} disabled={confirmar.isPending}>
                Cancelar
              </button>
              {previa ? (
                <button type="button" className="primary-button" onClick={aoConfirmar} disabled={confirmarBloqueado || ocupado}>
                  {rotuloDoBotao ?? 'Confirmar importação'}
                </button>
              ) : (
                <button type="button" className="primary-button" onClick={aoPrevisualizar} disabled={faltas.length > 0 || ocupado}>
                  {rotuloDoBotao ?? 'Pré-visualizar'}
                </button>
              )}
            </div>
          </>
        )}
        {dialogo.renderizar(
          previa?.aba === 'dbcorp' && previa.resumo.pendentes
            ? inativosDosPendentes(previa.resumo.pendentes.itens)
            : undefined,
        )}
      </div>
    </Modal>
  );
}

export default function ForecastImportModal({ aberto, ...resto }: Props) {
  // Desmontado ao fechar: arquivos, base64 e resumo somem junto.
  return aberto ? <ImportModal {...resto} /> : null;
}
