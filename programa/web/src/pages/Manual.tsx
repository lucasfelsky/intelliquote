import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { capitulosVisiveis, kickerDoCapitulo, type CapituloMeta } from './Manual/capitulos';
import { RODAPE_DO_MANUAL } from './Manual/dados';
import { textoParaIndice } from './Manual/busca';
import Busca from './Manual/componentes/Busca';
import { MetaProvider, PerfilProvider } from './Manual/componentes/Capitulo';
import { TermoProvider } from './Manual/componentes/Destacar';
import { Indice, SeletorCapitulo } from './Manual/componentes/Indice';

// Rola ate o capitulo e leva o foco ao titulo (o h2 tem tabIndex -1): quem usa teclado ou leitor de tela continua dali.
// `instantaneo`: sem a rolagem suave do CSS (html:has(.manual-page) tem scroll-behavior: smooth). Na abertura de /manual#id a rolagem suave disputava com o layout que ainda
// assentava e terminava ~170 px depois do capitulo; ao abrir, o salto e direto. Clique no indice e no seletor seguem suaves (sem reduced-motion).
function irParaCapitulo(id: string, instantaneo = false, focar = true): boolean {
  const secao = document.getElementById(id);
  if (!secao) return false;
  if (typeof secao.scrollIntoView === 'function') secao.scrollIntoView(instantaneo ? { block: 'start', behavior: 'instant' } : { block: 'start' });
  if (focar) secao.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  return true;
}

// Um capitulo da pagina. Memoizado: digitar na busca ou trocar o capitulo ativo nao refaz o corpo dos capitulos; so quem le o termo (Destacar, FAQ) atualiza pelo contexto.
const CapituloDaPagina = memo(function CapituloDaPagina({ capitulo, oculto }: { capitulo: CapituloMeta; oculto: boolean }) {
  const meta = useMemo(() => ({ id: capitulo.id, titulo: capitulo.titulo, kicker: kickerDoCapitulo(capitulo), oculto }), [capitulo, oculto]);
  return (
    <MetaProvider value={meta}>
      <capitulo.Componente />
    </MetaProvider>
  );
});

export default function Manual() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const capitulos = useMemo(() => capitulosVisiveis(user?.role), [user?.role]);
  // Comercial: 1 capitulo, sem indice nem seletor (D-M-07).
  const comIndice = capitulos.length > 1;

  const [termo, setTermo] = useState('');
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [ativo, setAtivo] = useState(capitulos[0]?.id ?? '');
  const artigoRef = useRef<HTMLDivElement>(null);

  // Indice de texto: o texto de cada capitulo ja desenhado (inclui o de SVG), lido uma vez depois do 1o desenho.
  useEffect(() => {
    const secoes = artigoRef.current?.querySelectorAll<HTMLElement>('[data-manual-capitulo]') ?? [];
    const lidos: Record<string, string> = {};
    secoes.forEach((secao) => {
      lidos[secao.id] = textoParaIndice(secao.textContent ?? '');
    });
    setTextos(lidos);
  }, [capitulos]);

  const visiveis = useMemo(
    () => (termo ? capitulos.filter((c) => (textos[c.id] ?? '').includes(termo)) : capitulos),
    [capitulos, termo, textos],
  );
  const idsVisiveis = useMemo(() => new Set(visiveis.map((c) => c.id)), [visiveis]);
  const total = visiveis.length;
  const status = termo && total > 0 ? `${total} ${total === 1 ? 'capítulo encontrado' : 'capítulos encontrados'}` : '';
  const ativoVisivel = idsVisiveis.has(ativo) ? ativo : (visiveis[0]?.id ?? '');

  // Scrollspy: o capitulo que cruza a faixa do topo da janela vira o ativo (a faixa e a da previa aprovada).
  useEffect(() => {
    if (!comIndice || typeof IntersectionObserver === 'undefined') return undefined;
    const observador = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) if (e.isIntersecting) setAtivo(e.target.id);
      },
      { rootMargin: '-15% 0px -75% 0px' },
    );
    artigoRef.current?.querySelectorAll('[data-manual-capitulo]').forEach((secao) => observador.observe(secao));
    return () => observador.disconnect();
  }, [comIndice, capitulos]);

  // /manual#comparacao (e links do proprio texto): rola ate o capitulo. A chave da navegacao muda a cada clique, mesmo no mesmo hash.
  // "Abertura" = a navegacao que trouxe o leitor a pagina (a chave da 1a localizacao); depois dela, cada clique gera uma chave nova. Nada de booleano "primeira vez":
  // sob StrictMode o efeito roda duas vezes e a 2a execucao precisa chegar ao mesmo resultado (idempotente).
  const chaveDaAbertura = useRef(location.key);
  useEffect(() => {
    const id = location.hash.replace(/^#/, '');
    if (!id || !capitulos.some((c) => c.id === id)) return undefined;
    const naAbertura = location.key === chaveDaAbertura.current;
    if (irParaCapitulo(id, naAbertura)) setAtivo(id);
    if (!naAbertura || typeof document === 'undefined' || !document.fonts?.ready) return undefined;
    // Na abertura as fontes ainda podem mudar a altura do que vem antes do capitulo: realinha UMA vez quando carregarem, a menos que o leitor ja tenha
    // agido (roda, toque, tecla ou clique): quem rolou para outro capitulo nao pode ser puxado de volta.
    let vigente = true;
    const cancelar = () => {
      vigente = false;
    };
    const interacoes = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    for (const tipo of interacoes) window.addEventListener(tipo, cancelar, { passive: true });
    void document.fonts.ready.then(() => {
      if (vigente) irParaCapitulo(id, true, false);
    });
    return () => {
      vigente = false;
      for (const tipo of interacoes) window.removeEventListener(tipo, cancelar);
    };
  }, [location.key, location.hash, capitulos]);

  // Scrollspy no fim da pagina: os ultimos capitulos (Administracao, Perguntas, Glossario) nunca cruzam a faixa do topo porque a pagina acaba antes;
  // ao chegar no fim, o ultimo capitulo visivel vira o ativo.
  const ultimoVisivel = visiveis[visiveis.length - 1]?.id;
  useEffect(() => {
    if (!comIndice || !ultimoVisivel) return undefined;
    const noFim = () => {
      const alturaTotal = document.documentElement.scrollHeight;
      if (alturaTotal > 0 && window.innerHeight + window.scrollY >= alturaTotal - 2) setAtivo(ultimoVisivel);
    };
    window.addEventListener('scroll', noFim, { passive: true });
    return () => window.removeEventListener('scroll', noFim);
  }, [comIndice, ultimoVisivel]);

  // Impressao (M6): no papel o FAQ sai aberto. No beforeprint abrem os <details> fechados e no afterprint voltam so os que a impressao abriu
  // (o que o leitor ja tinha aberto continua aberto). Mexe so no DOM: o estado do React das perguntas nao muda.
  useEffect(() => {
    const abertosPelaImpressao: HTMLDetailsElement[] = [];
    const antes = () => {
      artigoRef.current?.querySelectorAll<HTMLDetailsElement>('details:not([open])').forEach((detalhe) => {
        detalhe.open = true;
        abertosPelaImpressao.push(detalhe);
      });
    };
    const depois = () => {
      for (const detalhe of abertosPelaImpressao) detalhe.open = false;
      abertosPelaImpressao.length = 0;
    };
    window.addEventListener('beforeprint', antes);
    window.addEventListener('afterprint', depois);
    return () => {
      window.removeEventListener('beforeprint', antes);
      window.removeEventListener('afterprint', depois);
    };
  }, []);

  const ir = useCallback(
    (id: string) => {
      setAtivo(id);
      navigate({ hash: `#${id}` }, { replace: true });
    },
    [navigate],
  );

  return (
    <div className="page manual-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Suporte</p>
          <h1>Manual do IntelliQuote</h1>
          <p>
            Como usar o IntelliQuote do pedido do Comercial até a Ordem de Compra: cada tela, cada botão e as regras por trás do ranking. Os exemplos usam empresas e valores
            fictícios.
          </p>
        </div>
        <Busca onTermo={setTermo} status={status} />
      </header>

      <div className={comIndice ? 'manual-layout' : 'manual-layout manual-layout--unico'}>
        {comIndice && visiveis.length > 0 ? <Indice capitulos={visiveis} ativo={ativoVisivel} onIr={ir} /> : null}
        <div className="manual-artigo" ref={artigoRef}>
          {comIndice && visiveis.length > 0 ? <SeletorCapitulo capitulos={visiveis} ativo={ativoVisivel} onIr={ir} /> : null}
          <PerfilProvider value={user?.role}>
            <TermoProvider value={termo}>
              {capitulos.map((capitulo) => (
                <CapituloDaPagina key={capitulo.id} capitulo={capitulo} oculto={!idsVisiveis.has(capitulo.id)} />
              ))}
            </TermoProvider>
          </PerfilProvider>
          {termo && total === 0 ? (
            <div className="card manual-vazio" role="status">
              <p className="manual-vazio__titulo">Nada encontrado</p>
              <p>Tente outra palavra, como “link”, “PO” ou “aprovação”.</p>
            </div>
          ) : null}
          <p className="manual-rodape">{RODAPE_DO_MANUAL}</p>
        </div>
      </div>
    </div>
  );
}
