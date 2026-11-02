import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { capitulosVisiveis, kickerDoCapitulo } from './Manual/capitulos';
import { termoDeBusca, textoParaIndice } from './Manual/busca';
import Busca from './Manual/componentes/Busca';
import { MetaProvider } from './Manual/componentes/Capitulo';
import { TermoProvider } from './Manual/componentes/Destacar';
import { Indice, SeletorCapitulo } from './Manual/componentes/Indice';

const ATRASO_DA_BUSCA_MS = 180;

// Rola ate o capitulo e leva o foco ao titulo (o h2 tem tabIndex -1): quem usa teclado ou leitor de tela continua dali.
function irParaCapitulo(id: string): boolean {
  const secao = document.getElementById(id);
  if (!secao) return false;
  if (typeof secao.scrollIntoView === 'function') secao.scrollIntoView({ block: 'start' });
  secao.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  return true;
}

export default function Manual() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const capitulos = useMemo(() => capitulosVisiveis(user?.role), [user?.role]);
  // Comercial: 1 capitulo, sem indice nem seletor (D-M-07).
  const comIndice = capitulos.length > 1;

  const [entrada, setEntrada] = useState('');
  const [termo, setTermo] = useState('');
  const [textos, setTextos] = useState<Record<string, string>>({});
  const [ativo, setAtivo] = useState(capitulos[0]?.id ?? '');
  const artigoRef = useRef<HTMLDivElement>(null);

  // Busca com atraso: o termo so vale depois de 180 ms sem digitar; menos de 2 caracteres = tudo visivel.
  useEffect(() => {
    const espera = window.setTimeout(() => setTermo(termoDeBusca(entrada)), ATRASO_DA_BUSCA_MS);
    return () => window.clearTimeout(espera);
  }, [entrada]);

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
  useEffect(() => {
    const id = location.hash.replace(/^#/, '');
    if (!id || !capitulos.some((c) => c.id === id)) return;
    if (irParaCapitulo(id)) setAtivo(id);
  }, [location.key, location.hash, capitulos]);

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
        <Busca valor={entrada} onChange={setEntrada} status={status} />
      </header>

      <div className={comIndice ? 'manual-layout' : 'manual-layout manual-layout--unico'}>
        {comIndice && visiveis.length > 0 ? <Indice capitulos={visiveis} ativo={ativoVisivel} onIr={ir} /> : null}
        <div className="manual-artigo" ref={artigoRef}>
          {comIndice && visiveis.length > 0 ? <SeletorCapitulo capitulos={visiveis} ativo={ativoVisivel} onIr={ir} /> : null}
          <TermoProvider value={termo}>
            {capitulos.map((capitulo) => (
              <MetaProvider
                key={capitulo.id}
                value={{ id: capitulo.id, titulo: capitulo.titulo, kicker: kickerDoCapitulo(capitulo), oculto: !idsVisiveis.has(capitulo.id) }}
              >
                <capitulo.Componente />
              </MetaProvider>
            ))}
          </TermoProvider>
          {termo && total === 0 ? (
            <div className="card manual-vazio" role="status">
              <p className="manual-vazio__titulo">Nada encontrado</p>
              <p>Tente outra palavra, como “link”, “PO” ou “aprovação”.</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
