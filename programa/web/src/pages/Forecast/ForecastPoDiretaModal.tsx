import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Modal } from '@/components/Modal';
import { Icon } from '@/components/icons';
import { useConfirm } from '@/components/useConfirm';
import { ehArquivoPdf, useSoltarArquivo } from '@/components/useSoltarArquivo';
import type { ForecastItemRelatorio } from '@/services/forecast';
import {
  forecastPoDiretaErrorMessage,
  forecastPoDiretaKeys,
  getForecastPoDestinatarios,
  novaChaveDeEnvio,
  postForecastPoPrecoFechado,
  precisaDeChaveNova,
  type ForecastPoDiretaEnviada,
} from '@/services/forecastPoDireta';
import { formatForwarderInfo, listForwarders } from '@/services/forwarders';
import { moedaBr } from '@/services/forecastPrecoFechado';
import { useCriarCotacao } from './ForecastCriarCotacao';
import { useDecisoesDaQuinzena } from './ForecastDecisaoCompra';
import { dataBr, kgBr } from './forecastPainel';

// "Enviar Ordem de Compra" de itens de PRECO FECHADO, direto do Relatorio de compras (sem cotacao). Mesmo desenho do modal da PO
// da cotacao (PurchaseOrderModal): destinatarios Para/Cc, assunto, PDF em base64, forwarder e mensagem. Acrescenta a quantidade da
// PO de cada item (soma na Qtd. final do item). Um envio leva UM ou VARIOS itens do mesmo fornecedor: um e-mail e um PDF, uma PO por
// item. O preco (so admin/comprador, que sao quem abre este modal) aparece para conferencia e para o total estimado, mas NUNCA
// viaja daqui: o backend o le do cadastro. O estado nasce a cada abertura.

// Espelham o backend (app.ts / quotePurchaseOrderSchema / forecastPoPrecoFechadoSchema).
const MAX_PO_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FORWARDER_INFO_LENGTH = 2000;
const MAX_QUANTIDADE_KG = 1_000_000_000;
const ASSUNTO_NOMES_MAX = 150;

function formatRecipient(contact: { name: string; email: string }): string {
  return contact.name.trim() ? `${contact.name} <${contact.email}>` : contact.email;
}

function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Quantidade digitada em kg (aceita virgula): > 0, ate 1 bilhao e ate 3 casas decimais (mesma regra do backend). */
export function lerQuantidadePo(texto: string): { ok: true; valor: number } | { ok: false; erro: string } {
  const limpo = texto.trim().replace(',', '.');
  if (limpo === '') return { ok: false, erro: 'Informe a quantidade da PO em kg.' };
  const valor = Number(limpo);
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, erro: 'A quantidade deve ser maior que zero.' };
  if (valor > MAX_QUANTIDADE_KG) return { ok: false, erro: 'A quantidade passa do limite de 1.000.000.000 kg.' };
  if (Math.abs(valor * 1000 - Math.round(valor * 1000)) > 1e-6) return { ok: false, erro: 'A quantidade aceita no máximo 3 casas decimais.' };
  return { ok: true, valor };
}

/** Assunto padrao: "Purchase Order - <produto>"; com varios itens, os nomes separados por virgula (cortados em 150 caracteres). */
export function assuntoPadraoDaPo(nomes: readonly string[]): string {
  const juntos = nomes.map((n) => n.trim()).filter(Boolean).join(', ');
  if (juntos === '') return 'Purchase Order - SQ Quimica';
  return `Purchase Order - ${juntos.length > ASSUNTO_NOMES_MAX ? `${juntos.slice(0, ASSUNTO_NOMES_MAX - 1)}…` : juntos}`;
}

/**
 * Quantidade de referencia da PO: a da ANALISE FORECAST (a quantidade fechada na decisao de compra do item) quando existe; sem
 * analise, a sugerida pelo Forecast (Qtd. final calculada). E o valor que o campo traz; pode ser ajustado.
 */
export function referenciaDaPo(item: ForecastItemRelatorio, analiseKg: number | null | undefined): { kg: number; origem: 'analise' | 'sugerida' } {
  return analiseKg != null && analiseKg > 0 ? { kg: analiseKg, origem: 'analise' } : { kg: item.quantidadeFinal, origem: 'sugerida' };
}

const kgParaCampo = (kg: number): string => String(kg).replace('.', ',');

interface Props {
  snapshotId: number;
  /** Rotulo da quinzena (ex.: 11-1), para o subtitulo. */
  quinzena: string;
  /** Itens do envio (todos do mesmo fornecedor; o servidor confere). Com `productId` (so quem tem cadastro chega aqui). */
  itens: ForecastItemRelatorio[];
  /** Quando a selecao tem varios fornecedores: "PO 2 de 3" (as POs saem uma por vez). */
  posicao?: { atual: number; total: number };
  onClose: () => void;
  onEnviada: (resultado: ForecastPoDiretaEnviada) => void;
}

export default function ForecastPoDiretaModal({ snapshotId, quinzena, itens, posicao, onClose, onEnviada }: Props) {
  const unico = itens.length === 1;
  const productIds = itens.map((i) => i.productId as number);
  const decisoes = useDecisoesDaQuinzena();
  const referencias = new Map(itens.map((i) => [i.productId as number, referenciaDaPo(i, decisoes?.mapa.get(i.productId as number)?.quantidadeKg)] as const));
  const [quantidades, setQuantidades] = useState<Record<number, string>>(() =>
    Object.fromEntries(itens.map((i) => [i.productId as number, kgParaCampo((referencias.get(i.productId as number) as { kg: number }).kg)])),
  );
  const [poSubject, setPoSubject] = useState(() => assuntoPadraoDaPo(itens.map((i) => i.item || 'SQ Quimica')));
  const [poForwarderInfo, setPoForwarderInfo] = useState('');
  const [poMessage, setPoMessage] = useState('');
  const [poFileName, setPoFileName] = useState('');
  const [poFileBase64, setPoFileBase64] = useState('');
  const [poFileSize, setPoFileSize] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [forwarderId, setForwarderId] = useState<number | null>(null);
  // Uma chave por TENTATIVA: repetir a mesma (rede caiu, duplo clique) nunca envia duas vezes; trocar so depois de uma recusa.
  const chaveRef = useRef(novaChaveDeEnvio());
  const confirm = useConfirm();
  const ctx = useCriarCotacao();
  const precoDe = (i: ForecastItemRelatorio) => ctx?.precoFechado(i.productId as number);

  const forwardersQuery = useQuery({
    queryKey: ['forwarders', { active: true }],
    queryFn: () => listForwarders({ active: true }),
  });
  const forwarders = forwardersQuery.data ?? [];

  // O backend valida de novo no envio; esta consulta avisa o bloqueio (fonte sem fornecedor, itens de fornecedores diferentes,
  // sem contato...) ANTES do formulario.
  const destinatariosQuery = useQuery({
    queryKey: forecastPoDiretaKeys.destinatarios(snapshotId, productIds),
    queryFn: () => getForecastPoDestinatarios(snapshotId, productIds),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const destinatarios = destinatariosQuery.data;

  const lastAutoTextRef = useRef('');
  const userTouchedRef = useRef(false);
  const initialAppliedRef = useRef(false);

  useEffect(() => {
    if (!forwardersQuery.data || initialAppliedRef.current) return;
    initialAppliedRef.current = true;
    if (userTouchedRef.current) return;
    const preferred = forwardersQuery.data.find((f) => f.isDefault && f.isActive);
    if (!preferred) return;
    const text = formatForwarderInfo(preferred);
    lastAutoTextRef.current = text;
    setForwarderId(preferred.id);
    setPoForwarderInfo(text);
  }, [forwardersQuery.data]);

  async function handleForwarderSelect(rawValue: string) {
    userTouchedRef.current = true;
    if (rawValue === '') {
      setForwarderId(null);
      return;
    }
    const chosen = forwarders.find((f) => f.id === Number(rawValue));
    if (!chosen) return;
    const untouched = poForwarderInfo.trim() === '' || poForwarderInfo === lastAutoTextRef.current;
    if (!untouched) {
      const ok = await confirm({
        title: 'Substituir contato do forwarder?',
        message: `O texto editado será substituído pelo cadastro de ${chosen.companyName}.`,
        confirmText: 'Substituir',
      });
      if (!ok) return;
    }
    const text = formatForwarderInfo(chosen);
    lastAutoTextRef.current = text;
    setForwarderId(chosen.id);
    setPoForwarderInfo(text);
  }

  const forwarderInfoLength = poForwarderInfo.trim().length;
  const forwarderInfoTooLong = forwarderInfoLength > MAX_FORWARDER_INFO_LENGTH;
  const lidas = itens.map((i) => ({ item: i, lida: lerQuantidadePo(quantidades[i.productId as number] ?? '') }));
  const todasValidas = lidas.every((l) => l.lida.ok);
  const invalidas = lidas.filter((l) => !l.lida.ok).map((l) => l.item.item);
  const primeiraLida = lidas[0]?.lida as ReturnType<typeof lerQuantidadePo>;

  // Total estimado por moeda: so itens com preco valido no cadastro e quantidade valida (nunca mistura moedas).
  const totais = new Map<string, number>();
  for (const { item, lida } of lidas) {
    const preco = precoDe(item);
    if (lida.ok && preco?.estado === 'ok') {
      const moeda = preco.moeda ?? '';
      totais.set(moeda, (totais.get(moeda) ?? 0) + Math.round(lida.valor * (preco.valorPorKg as number) * 100) / 100);
    }
  }
  const totalEstimado = [...totais.entries()].map(([moeda, v]) => moedaBr(Math.round(v * 100) / 100, moeda)).join(' + ');

  const envio = useMutation({
    mutationFn: () => {
      if (!todasValidas) throw new Error('Corrija as quantidades.');
      return postForecastPoPrecoFechado(snapshotId, {
        itens: lidas.map(({ item, lida }) => ({ productId: item.productId as number, quantidadeKg: lida.ok ? lida.valor : 0 })),
        chaveEnvio: chaveRef.current,
        subject: poSubject,
        message: poMessage,
        forwarderInfo: poForwarderInfo,
        ...(forwarderId !== null ? { forwarderId } : {}),
        fileName: poFileName,
        contentBase64: poFileBase64,
        fileType: 'application/pdf',
        fileSize: poFileSize,
      });
    },
    onSuccess: (resultado) => onEnviada(resultado),
    onError: (err) => {
      if (precisaDeChaveNova(err)) chaveRef.current = novaChaveDeEnvio();
      setErro(forecastPoDiretaErrorMessage(err));
    },
  });

  function handlePoFileChange(file: File | null) {
    if (!file) {
      setPoFileName('');
      setPoFileBase64('');
      setPoFileSize(0);
      return;
    }
    if (!ehArquivoPdf(file)) {
      setErro('Selecione um arquivo PDF.');
      return;
    }
    if (file.size > MAX_PO_FILE_SIZE_BYTES) {
      setErro('O PDF excede o limite de 10MB.');
      return;
    }
    setErro(null);
    const reader = new FileReader();
    reader.onload = () => {
      setPoFileName(file.name);
      setPoFileBase64(String(reader.result ?? ''));
      setPoFileSize(file.size);
    };
    reader.onerror = () => setErro('Não foi possível ler o arquivo selecionado.');
    reader.readAsDataURL(file);
  }

  // Arrastar o PDF direto para o campo (alem de clicar): mais de um arquivo e recusado; um so passa pela mesma validacao do seletor.
  const soltar = useSoltarArquivo((arquivos) => {
    if (arquivos.length === 0) return;
    if (arquivos.length > 1) {
      setErro('Solte um arquivo PDF por vez.');
      return;
    }
    handlePoFileChange(arquivos[0] ?? null);
  }, envio.isPending);
  const classeDoCampo = [
    'cmp-po__arquivo',
    poFileName ? 'cmp-po__arquivo--ok' : '',
    soltar.arrastando ? 'cmp-po__arquivo--arrastando' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Fechar (Cancelar, Esc, X) durante o envio abriria outra tentativa com chave nova e o e-mail poderia sair em dobro.
  const fechar = () => {
    if (!envio.isPending) onClose();
  };

  const bloqueada = destinatariosQuery.isError;
  const podeEnviar =
    !envio.isPending && !bloqueada && destinatarios !== undefined && todasValidas && poSubject.trim() !== '' && poFileBase64 !== '' && poForwarderInfo.trim() !== '' && !forwarderInfoTooLong;

  const subtitulo = unico ? (
    <>
      <span className="cmp-codigo">Quinzena {quinzena}</span> · {itens[0]?.item}
    </>
  ) : (
    <>
      <span className="cmp-codigo">Quinzena {quinzena}</span> · {itens.length} itens
    </>
  );

  return (
    <Modal
      isOpen
      onClose={fechar}
      size="wide"
      title={`${destinatarios ? `Enviar Ordem de Compra — ${destinatarios.fornecedor}` : 'Enviar Ordem de Compra'}${posicao ? ` (PO ${posicao.atual} de ${posicao.total})` : ''}`}
      subtitle={subtitulo}
    >
      <div className="cmp-po" {...soltar.recipiente}>
        <p className="cmp-po-aviso cmp-po-aviso--info" role="status">
          <Icon name="info" size={16} strokeWidth={1.9} />
          <span>
            {unico
              ? 'Item de preço fechado: a PO vai ao fornecedor da fonte sem passar por cotação, e o item fica como “PO enviada”.'
              : `Itens de preço fechado: um e-mail e um PDF para os ${itens.length} itens. Cada item vira uma PO, sem cotação, e fica como “PO enviada”.`}
          </span>
        </p>

        {unico ? (
          <>
            <div className="cmp-po__destinatarios-caixa">
              <p className="cmp-po__linha">
                <strong>Item:</strong> {itens[0]?.item}
              </p>
              <p className="cmp-po__linha">
                <strong>{referencias.get(productIds[0] as number)?.origem === 'analise' ? 'Análise Forecast:' : 'Sugerida pelo Forecast:'}</strong>{' '}
                <span className="cmp-mono">{kgBr(referencias.get(productIds[0] as number)?.kg)}</span> kg
              </p>
              {itens[0] && precoDe(itens[0])?.estado === 'ok' && (
                <p className="cmp-po__linha">
                  <strong>Preço fechado:</strong>{' '}
                  <span className="cmp-mono">{moedaBr(precoDe(itens[0])?.valorPorKg as number, precoDe(itens[0])?.moeda ?? null)}/kg</span> · {precoDe(itens[0])?.incoterm} · válido até{' '}
                  {dataBr(precoDe(itens[0])?.validoAte)}
                </p>
              )}
            </div>

            <div className="cmp-campo">
              <label className="field-label" htmlFor="poQuantidade">
                Quantidade da PO (kg)
              </label>
              <input
                id="poQuantidade"
                className="input cmp-mono"
                inputMode="decimal"
                value={quantidades[productIds[0] as number] ?? ''}
                aria-invalid={!primeiraLida.ok}
                aria-describedby="poQuantidadeDica"
                onChange={(e) => setQuantidades({ [productIds[0] as number]: e.target.value })}
              />
              <p id="poQuantidadeDica" className={primeiraLida.ok ? 'cmp-po__dica' : 'cmp-po__contador cmp-po__contador--excedido'}>
                {primeiraLida.ok ? 'Soma à Qtd. final (sistema) do item. Pode ajustar.' : primeiraLida.erro}
              </p>
              {primeiraLida.ok && itens[0] && precoDe(itens[0])?.estado === 'ok' && (
                <p className="cmp-po__dica" data-testid="po-total">
                  Valor total estimado: <strong className="cmp-mono">{totalEstimado}</strong> ({kgBr(primeiraLida.valor)} kg ×{' '}
                  {moedaBr(precoDe(itens[0])?.valorPorKg as number, precoDe(itens[0])?.moeda ?? null)}/kg)
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="cmp-campo">
            <span className="field-label" id="poItensTitulo">
              Itens da PO ({itens.length})
            </span>
            <div className="cmp-po__itens" role="region" tabIndex={0} aria-labelledby="poItensTitulo">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" className="num">
                      Análise / sugerida (kg)
                    </th>
                    <th scope="col" className="num">
                      Quantidade da PO (kg)
                    </th>
                    <th scope="col" className="num">
                      Preço
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lidas.map(({ item, lida }) => {
                    const id = item.productId as number;
                    const preco = precoDe(item);
                    return (
                      <tr key={id}>
                        <th scope="row">{item.item}</th>
                        <td className="num cmp-mono">
                          {kgBr(referencias.get(id)?.kg)}
                          <span className="cmp-po__dica"> {referencias.get(id)?.origem === 'analise' ? 'análise' : 'sugerida'}</span>
                        </td>
                        <td className="num">
                          <input
                            className="input cmp-mono"
                            inputMode="decimal"
                            aria-label={`Quantidade da PO de ${item.item} (kg)`}
                            aria-invalid={!lida.ok}
                            value={quantidades[id] ?? ''}
                            onChange={(e) => setQuantidades((q) => ({ ...q, [id]: e.target.value }))}
                          />
                          {!lida.ok && <span className="cmp-po__contador cmp-po__contador--excedido">{lida.erro}</span>}
                        </td>
                        <td className="num cmp-mono">
                          {preco?.estado === 'ok' ? `${moedaBr(preco.valorPorKg as number, preco.moeda)}/kg` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="cmp-po__dica">Cada quantidade soma na Qtd. final (sistema) do próprio item. Pode ajustar.</p>
            {totalEstimado !== '' && (
              <p className="cmp-po__dica" data-testid="po-total">
                Valor total estimado: <strong className="cmp-mono">{totalEstimado}</strong>
              </p>
            )}
          </div>
        )}

        <div data-testid="po-recipients" className="cmp-po__destinatarios">
          {destinatariosQuery.isLoading && <p className="cmp-po__destinatarios-estado">Carregando destinatários…</p>}
          {destinatariosQuery.isError && (
            <p role="alert" className="cmp-po__destinatarios-erro">
              <Icon name="alert-triangle" size={18} strokeWidth={1.9} />
              <span>{forecastPoDiretaErrorMessage(destinatariosQuery.error)}</span>
            </p>
          )}
          {destinatarios && (
            <div className="cmp-po__destinatarios-caixa">
              <p className="cmp-po__linha">
                <strong>Para:</strong> {formatRecipient(destinatarios.to)}
              </p>
              {destinatarios.contactCc.length > 0 && (
                <p className="cmp-po__linha">
                  <strong>Cc:</strong> {destinatarios.contactCc.map(formatRecipient).join(', ')}
                </p>
              )}
              {destinatarios.comexCc.length > 0 && (
                <p className="cmp-po__linha cmp-po__linha--suave">Equipe COMEX em cópia ({destinatarios.comexCc.length}).</p>
              )}
            </div>
          )}
        </div>

        <div className="cmp-campo">
          <label className="field-label" htmlFor="poSubject">
            Assunto
          </label>
          <input id="poSubject" className="input" value={poSubject} onChange={(e) => setPoSubject(e.target.value)} />
        </div>

        <div className="cmp-campo cmp-po__arquivo-campo">
          <label className="field-label" htmlFor="poFile">
            PDF da Ordem de Compra
          </label>
          <input
            id="poFile"
            type="file"
            className="cmp-po__arquivo-input"
            accept="application/pdf"
            onChange={(e) => handlePoFileChange(e.target.files?.[0] ?? null)}
          />
          <label htmlFor="poFile" className={classeDoCampo} {...soltar.campo}>
            <span className="cmp-po__arquivo-icone" aria-hidden="true">
              <Icon name={poFileName ? 'file-text' : 'upload'} size={poFileName ? 20 : 18} strokeWidth={1.9} />
            </span>
            <span className="cmp-po__arquivo-texto">
              <strong className={poFileName ? 'cmp-po__arquivo-nome cmp-mono' : 'cmp-po__arquivo-nome'}>
                {poFileName || 'Nenhum arquivo selecionado'}
              </strong>
              <span>{poFileName ? 'Somente PDF, até 10 MB' : 'Arraste o PDF para cá ou clique. Somente PDF, até 10 MB'}</span>
            </span>
            {poFileName && (
              <span className="cmp-po__arquivo-botao">
                <Icon name="upload" size={14} strokeWidth={2} />
                Escolher arquivo
              </span>
            )}
          </label>
          {poFileName && (
            <p className="cmp-po__selecionado">
              <span>Selecionado: {poFileName}</span>{' '}
              <span>
                (<span className="cmp-mono">{formatMb(poFileSize)}</span> MB)
              </span>
            </p>
          )}
        </div>

        <div className="cmp-campo">
          <label className="field-label" htmlFor="poForwarderSelect">
            Forwarder
          </label>
          <select
            id="poForwarderSelect"
            className="input"
            value={forwarderId === null ? '' : String(forwarderId)}
            disabled={forwardersQuery.isError}
            onChange={(e) => void handleForwarderSelect(e.target.value)}
          >
            <option value="">Digitar manualmente</option>
            {forwarders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.isDefault ? `${f.companyName} (padrão)` : f.companyName}
              </option>
            ))}
          </select>
          {forwardersQuery.isError && (
            <p className="cmp-po__dica">Não foi possível carregar os forwarders; digite o contato abaixo.</p>
          )}
          {forwardersQuery.isSuccess && forwarders.length === 0 && (
            <p className="cmp-po__dica">
              Nenhum forwarder cadastrado. Cadastre em{' '}
              <a href="/forwarders" target="_blank" rel="noreferrer">
                Forwarders
              </a>
              .
            </p>
          )}
        </div>

        <div className="cmp-campo">
          <label className="field-label" htmlFor="poForwarderInfo">
            Contato do despachante (forwarder)
          </label>
          <textarea
            id="poForwarderInfo"
            className="textarea"
            rows={Math.min(10, Math.max(4, poForwarderInfo.split('\n').length + 1))}
            value={poForwarderInfo}
            onChange={(e) => {
              userTouchedRef.current = true;
              setPoForwarderInfo(e.target.value);
            }}
            placeholder="Nome, e-mail e telefone do despachante responsável pelo embarque."
          />
          <p className={forwarderInfoTooLong ? 'cmp-po__contador cmp-po__contador--excedido' : 'cmp-po__contador'}>
            {forwarderInfoLength}/{MAX_FORWARDER_INFO_LENGTH}
          </p>
        </div>

        <div className="cmp-campo">
          <label className="field-label" htmlFor="poMessage">
            Mensagem
          </label>
          <textarea
            id="poMessage"
            className="textarea"
            rows={3}
            value={poMessage}
            onChange={(e) => setPoMessage(e.target.value)}
            placeholder="Opcional. Aparece logo após a saudação, no topo do e-mail."
          />
          <p className="cmp-po__dica">
            Assinatura: definida em{' '}
            <a href="/minha-conta" target="_blank" rel="noreferrer">
              Minha conta
            </a>
            .
          </p>
        </div>

        {!todasValidas && !unico && (
          <p className="cmp-po__dica">Corrija a quantidade de: {invalidas.join(', ')}.</p>
        )}

        {erro && (
          <p role="alert" className="cmp-po-aviso cmp-po-aviso--erro cmp-po__erro">
            <Icon name="alert-circle" size={16} strokeWidth={1.9} />
            <span>{erro}</span>
          </p>
        )}
      </div>

      <div className="modal-actions">
        <button type="button" className="ghost-button" disabled={envio.isPending} onClick={fechar}>
          Cancelar
        </button>
        <button type="button" className="primary-button" disabled={!podeEnviar} aria-busy={envio.isPending} onClick={() => { setErro(null); envio.mutate(); }}>
          <Icon name="file-text" size={16} strokeWidth={1.9} />
          {envio.isPending ? 'Enviando…' : 'Enviar Ordem de Compra'}
        </button>
      </div>
    </Modal>
  );
}
