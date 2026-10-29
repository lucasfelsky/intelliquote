import BrandMark from '@/components/BrandMark';
import SqLogo from '@/components/SqLogo';

/**
 * Login "Curvas de cambio" (board Login/LoginEscuro, D4): fundo claro com pontos e curvas de cambio animadas por CSS
 * (ondas em transform; ponto movel por offset-path), sem SMIL. Todas as cores vem de classes (tokens --rf-login-*), nunca de atributos;
 * opacidade e traco ficam como atributo numerico. A geometria e a do board (viewBox 600 0 840 900 = area direita de 1440 x 900).
 * O movimento e a contrapartida reduced-motion moram na regiao "tela F4" do globals.css.
 */

// Curva USD/BRL (a mesma geometria entra em offset-path do .login-backdrop__ponto no CSS; um teste confere a igualdade).
const CURVA_PRINCIPAL =
  'M-40 332 C-27 336 13 349 40 358 C67 367 93 376 120 384 C147 392 173 402 200 406 C227 410 253 413 280 408 C307 403 333 380 360 376 C387 373 413 390 440 387 C467 384 493 368 520 360 C547 352 573 341 600 339 C627 337 653 349 680 348 C707 347 733 337 760 333 C787 329 813 321 840 323 C867 325 893 342 920 344 C947 346 973 331 1000 335 C1027 339 1053 361 1080 367 C1107 373 1133 368 1160 371 C1187 374 1213 387 1240 387 C1267 387 1293 376 1320 370 C1347 364 1373 353 1400 350 C1427 347 1467 351 1480 351';

// Curvas finas EUR/BRL, CNY/BRL, GBP/BRL, a de baixo (parada) e a ultima (parada, sem rotulo).
const ONDA_1 =
  'M-40 126 C-27 126 13 128 40 128 C67 128 93 128 120 124 C147 121 173 106 200 107 C227 109 253 129 280 133 C307 137 333 132 360 132 C387 133 413 135 440 136 C467 137 493 138 520 138 C547 139 573 140 600 139 C627 138 653 133 680 130 C707 127 733 120 760 121 C787 122 813 137 840 137 C867 137 893 125 920 122 C947 120 973 120 1000 122 C1027 124 1053 127 1080 132 C1107 137 1133 149 1160 151 C1187 153 1213 149 1240 145 C1267 141 1293 131 1320 126 C1347 122 1373 117 1400 118 C1427 120 1467 132 1480 135';
const ONDA_2 =
  'M-40 230 C-27 228 13 217 40 215 C67 213 93 215 120 217 C147 219 173 225 200 226 C227 227 253 224 280 221 C307 218 333 212 360 208 C387 205 413 199 440 200 C467 201 493 210 520 214 C547 218 573 223 600 226 C627 229 653 227 680 231 C707 235 733 242 760 248 C787 254 813 266 840 266 C867 266 893 248 920 247 C947 246 973 260 1000 260 C1027 260 1053 251 1080 247 C1107 243 1133 237 1160 235 C1187 233 1213 237 1240 235 C1267 233 1293 224 1320 225 C1347 226 1373 240 1400 243 C1427 247 1467 246 1480 246';
const ONDA_3 =
  'M-40 536 C-27 536 13 531 40 536 C67 541 93 557 120 564 C147 571 173 573 200 577 C227 581 253 585 280 590 C307 595 333 602 360 607 C387 612 413 615 440 618 C467 621 493 622 520 623 C547 625 573 630 600 627 C627 624 653 608 680 605 C707 602 733 610 760 607 C787 604 813 596 840 588 C867 580 893 566 920 561 C947 556 973 560 1000 557 C1027 554 1053 543 1080 543 C1107 543 1133 555 1160 557 C1187 560 1213 559 1240 558 C1267 557 1293 549 1320 550 C1347 551 1373 558 1400 562 C1427 566 1467 571 1480 573';
const ONDA_4 =
  'M-40 628 C-27 634 13 664 40 665 C67 666 93 641 120 635 C147 629 173 630 200 627 C227 624 253 616 280 617 C307 618 333 629 360 632 C387 636 413 631 440 638 C467 645 493 673 520 673 C547 673 573 643 600 638 C627 633 653 645 680 645 C707 645 733 637 760 637 C787 637 813 646 840 643 C867 640 893 616 920 617 C947 618 973 638 1000 647 C1027 656 1053 672 1080 671 C1107 670 1133 646 1160 642 C1187 639 1213 649 1240 650 C1267 651 1293 648 1320 646 C1347 644 1373 637 1400 637 C1427 637 1467 644 1480 645';
const CURVA_BASE =
  'M-40 750 C-27 753 13 763 40 767 C67 771 93 770 120 772 C147 774 173 779 200 781 C227 784 253 786 280 787 C307 789 333 793 360 790 C387 788 413 775 440 772 C467 769 493 771 520 771 C547 771 573 770 600 771 C627 772 653 774 680 776 C707 778 733 780 760 783 C787 786 813 790 840 792 C867 794 893 797 920 795 C947 793 973 784 1000 782 C1027 780 1053 783 1080 783 C1107 783 1133 778 1160 780 C1187 782 1213 795 1240 797 C1267 799 1293 792 1320 792 C1347 792 1373 796 1400 795 C1427 795 1467 790 1480 789';

const NOS: ReadonlyArray<readonly [number, number]> = [
  [200, 406],
  [440, 387],
  [680, 348],
  [920, 344],
  [1160, 371],
  [1400, 350],
];

export default function LoginBackdrop() {
  return (
    <div className="login-backdrop" aria-hidden="true">
      <svg className="login-backdrop__svg" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="iq-login-pontos-padrao" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle className="login-backdrop__ponto-grade" cx="2" cy="2" r="1" />
          </pattern>
          <radialGradient id="iq-login-pontos-gradiente" cx="0.5" cy="0.5" r="0.62">
            <stop offset="0" stopColor="#000" />
            <stop offset="0.5" stopColor="#000" />
            <stop offset="1" stopColor="#fff" />
          </radialGradient>
          <mask id="iq-login-pontos-mascara">
            <rect width="100%" height="100%" fill="url(#iq-login-pontos-gradiente)" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="url(#iq-login-pontos-padrao)" mask="url(#iq-login-pontos-mascara)" />
      </svg>

      <svg
        className="login-backdrop__svg"
        viewBox="600 0 840 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <radialGradient id="iq-login-curvas-gradiente" cx="0.5" cy="0.5" r="0.6">
            <stop offset="0" stopColor="#444" />
            <stop offset="0.38" stopColor="#444" />
            <stop offset="1" stopColor="#fff" />
          </radialGradient>
          <mask id="iq-login-curvas-mascara">
            <rect x="-40" width="1520" height="900" fill="url(#iq-login-curvas-gradiente)" />
          </mask>
          <path id="iq-login-curva-principal" d={CURVA_PRINCIPAL} />
        </defs>
        <g mask="url(#iq-login-curvas-mascara)">
          <path
            className="login-backdrop__grade"
            d="M200 0 V900 M440 0 V900 M680 0 V900 M920 0 V900 M1160 0 V900 M1400 0 V900"
            strokeDasharray="2 6"
          />
          <g className="login-backdrop__finas" fill="none" strokeLinecap="round">
            <g className="login-backdrop__onda--1" strokeOpacity="0.24" strokeWidth="1.1">
              <path d={ONDA_1} />
            </g>
            <g className="login-backdrop__onda--2" strokeOpacity="0.20" strokeWidth="1.1">
              <path d={ONDA_2} />
            </g>
            <g className="login-backdrop__onda--3" strokeOpacity="0.18" strokeWidth="1.1">
              <path d={ONDA_3} />
            </g>
            <g className="login-backdrop__onda--4" strokeOpacity="0.22" strokeWidth="1.1">
              <path d={ONDA_4} />
            </g>
            <g strokeOpacity="0.16" strokeWidth="1.1">
              <path d={CURVA_BASE} />
            </g>
          </g>
          <path className="login-backdrop__area" d={`${CURVA_PRINCIPAL} V900 H-40 Z`} />
          <use
            className="login-backdrop__principal"
            href="#iq-login-curva-principal"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <g className="login-backdrop__nos" strokeWidth="1.6">
            {NOS.map(([cx, cy]) => (
              <circle key={cx} cx={cx} cy={cy} r="4" />
            ))}
          </g>
          <circle className="login-backdrop__ponto" r="5" />
        </g>
        <g className="login-backdrop__moedas" fontSize="10" fontWeight="600" letterSpacing="1.3" textAnchor="end">
          <text x="1420" y="104" fillOpacity="0.6">
            EUR/BRL
          </text>
          <text x="1420" y="214" fillOpacity="0.55">
            CNY/BRL
          </text>
          <text x="1420" y="334">
            USD/BRL · PTAX
          </text>
          <text x="1420" y="536" fillOpacity="0.55">
            GBP/BRL
          </text>
        </g>
        <g className="login-backdrop__eixo" fontSize="10" fontWeight="600" letterSpacing="1.6" textAnchor="middle">
          <text x="200" y="872">
            SEG
          </text>
          <text x="440" y="872">
            TER
          </text>
          <text x="680" y="872">
            QUA
          </text>
          <text x="920" y="872">
            QUI
          </text>
          <text x="1160" y="872">
            SEX
          </text>
        </g>
      </svg>
    </div>
  );
}

/** Painel navy estatico do login (board Login): textura de pontos, marca, nome e a assinatura SQ Quimica no canto inferior esquerdo. */
export function LoginPainel() {
  return (
    <section className="login-painel">
      <svg className="login-painel__textura" aria-hidden="true" focusable="false">
        <defs>
          <pattern id="iq-login-painel-pontos" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle className="login-painel__ponto" cx="2" cy="2" r="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#iq-login-painel-pontos)" />
      </svg>
      <div className="login-painel__marca">
        <BrandMark tone="dark" size={56} />
      </div>
      <p className="login-painel__nome">IntelliQuote</p>
      <div className="login-painel__assinatura">
        <SqLogo size={36} />
      </div>
    </section>
  );
}
