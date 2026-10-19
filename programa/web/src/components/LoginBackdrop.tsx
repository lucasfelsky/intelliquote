/**
 * Fundo "Rotas de fornecimento" da tela de login.
 * Dois SVGs inline (desktop 1440x900 / mobile 390x844); a troca e feita em CSS (login.css).
 * Cores so via classes (tokens CSS em login.css). Animacao em CSS, sem SMIL.
 */
export default function LoginBackdrop() {
  return (
    <div className="login-backdrop" aria-hidden="true">
      <svg
        className="login-backdrop__svg login-backdrop__svg--desktop"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <pattern id="iq-login-d-dots" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle className="login-backdrop__dot" cx="2" cy="2" r="1" fillOpacity="0.16" />
          </pattern>
          <radialGradient id="iq-login-d-fadeg" cx="0.5" cy="0.5" r="0.62">
            <stop offset="0" stopColor="#000" />
            <stop offset="0.45" stopColor="#000" />
            <stop offset="1" stopColor="#fff" />
          </radialGradient>
          <mask id="iq-login-d-fade">
            <rect width="1440" height="900" fill="url(#iq-login-d-fadeg)" />
          </mask>
          <clipPath id="iq-login-d-globe">
            <circle cx="1250" cy="1010" r="560" />
          </clipPath>
        </defs>

        <rect
          className="login-backdrop__dots"
          width="1440"
          height="900"
          fill="url(#iq-login-d-dots)"
          mask="url(#iq-login-d-fade)"
        />

        <circle
          className="login-backdrop__globe"
          cx="1250"
          cy="1010"
          r="560"
          fillOpacity="0.05"
          strokeOpacity="0.22"
          strokeWidth="1.2"
        />
        <g
          className="login-backdrop__graticule"
          clipPath="url(#iq-login-d-globe)"
          fill="none"
          strokeOpacity="0.16"
          strokeWidth="1"
          strokeDasharray="2 6"
        >
          <ellipse cx="1250" cy="1010" rx="430" ry="560" />
          <ellipse cx="1250" cy="1010" rx="280" ry="560" />
          <ellipse cx="1250" cy="1010" rx="110" ry="560" />
          <path d="M600 560 Q1250 520 1900 560 M600 680 Q1250 640 1900 680 M600 800 Q1250 760 1900 800" />
        </g>

        <g
          className="login-backdrop__route"
          fill="none"
          strokeOpacity="0.24"
          strokeWidth="1.2"
          strokeLinecap="round"
        >
          <path d="M300 150 Q760 20 1080 770" />
          <path d="M140 560 Q560 1000 1080 770" />
          <path d="M1300 140 Q1180 420 1080 770" />
          <path d="M1370 360 Q1300 600 1080 770" />
        </g>
        <g fill="none" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="14 1400">
          <path className="login-backdrop__pulse login-backdrop__pulse--deham" d="M300 150 Q760 20 1080 770" />
          <path className="login-backdrop__pulse login-backdrop__pulse--ushou" d="M140 560 Q560 1000 1080 770" />
          <path className="login-backdrop__pulse login-backdrop__pulse--cnsha" d="M1300 140 Q1180 420 1080 770" />
          <path className="login-backdrop__pulse login-backdrop__pulse--innsa" d="M1370 360 Q1300 600 1080 770" />
        </g>

        <g className="login-backdrop__star" fillOpacity="0.28">
          <circle cx="520" cy="92" r="2.5" />
          <circle cx="92" cy="330" r="2.5" />
          <circle cx="980" cy="112" r="2.5" />
          <circle cx="1186" cy="262" r="2.5" />
          <circle cx="60" cy="800" r="2.5" />
          <circle cx="420" cy="826" r="2.5" />
          <circle cx="1400" cy="560" r="2.5" />
          <circle cx="720" cy="60" r="2.5" />
        </g>

        <g className="login-backdrop__labels" fontSize="10" letterSpacing="1.2">
          <g transform="translate(300 150)">
            <circle className="login-backdrop__node-ring" r="9" fill="none" strokeOpacity="0.4" />
            <circle className="login-backdrop__node" r="4" />
            <text className="login-backdrop__label" x="16" y="4" fillOpacity="0.7">
              <tspan fontWeight="700">DEHAM</tspan>
              <tspan fillOpacity="0.75">{' · Hamburgo'}</tspan>
            </text>
          </g>
          <g transform="translate(140 560)">
            <circle className="login-backdrop__node-ring" r="9" fill="none" strokeOpacity="0.4" />
            <circle className="login-backdrop__node" r="4" />
            <text className="login-backdrop__label" x="16" y="4" fillOpacity="0.7">
              <tspan fontWeight="700">USHOU</tspan>
              <tspan fillOpacity="0.75">{' · Houston'}</tspan>
            </text>
          </g>
          <g transform="translate(1300 140)">
            <circle className="login-backdrop__node-ring" r="9" fill="none" strokeOpacity="0.4" />
            <circle className="login-backdrop__node" r="4" />
            <text className="login-backdrop__label" x="-16" y="4" textAnchor="end" fillOpacity="0.7">
              <tspan fontWeight="700">CNSHA</tspan>
              <tspan fillOpacity="0.75">{' · Xangai'}</tspan>
            </text>
          </g>
          <g transform="translate(1370 360)">
            <circle className="login-backdrop__node-ring" r="9" fill="none" strokeOpacity="0.4" />
            <circle className="login-backdrop__node" r="4" />
            <text className="login-backdrop__label" x="-16" y="4" textAnchor="end" fillOpacity="0.7">
              <tspan fontWeight="700">INNSA</tspan>
              <tspan fillOpacity="0.75">{' · Nhava Sheva'}</tspan>
            </text>
          </g>
          <g transform="translate(1080 770)">
            <circle className="login-backdrop__dest-ring" r="8" fill="none" strokeWidth="1.5" />
            <circle className="login-backdrop__dest-halo" r="13" fill="none" strokeOpacity="0.45" />
            <circle className="login-backdrop__dest-core" r="6" />
            <text className="login-backdrop__label" x="22" y="26" fillOpacity="0.8">
              <tspan fontWeight="700">BRSSZ</tspan>
              <tspan fillOpacity="0.75">{' · Santos'}</tspan>
            </text>
          </g>
        </g>
      </svg>

      <svg
        className="login-backdrop__svg login-backdrop__svg--mobile"
        viewBox="0 0 390 844"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <pattern id="iq-login-m-dots" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle className="login-backdrop__dot" cx="2" cy="2" r="1" fillOpacity="0.16" />
          </pattern>
          <clipPath id="iq-login-m-globe">
            <circle cx="300" cy="1080" r="380" />
          </clipPath>
        </defs>

        <rect className="login-backdrop__dots" width="390" height="190" fill="url(#iq-login-m-dots)" />
        <rect className="login-backdrop__dots" y="660" width="390" height="184" fill="url(#iq-login-m-dots)" />

        <circle
          className="login-backdrop__globe"
          cx="300"
          cy="1080"
          r="380"
          fillOpacity="0.05"
          strokeOpacity="0.22"
          strokeWidth="1.2"
        />
        <g
          className="login-backdrop__graticule"
          clipPath="url(#iq-login-m-globe)"
          fill="none"
          strokeOpacity="0.16"
          strokeWidth="1"
          strokeDasharray="2 5"
        >
          <ellipse cx="300" cy="1080" rx="290" ry="380" />
          <ellipse cx="300" cy="1080" rx="180" ry="380" />
          <ellipse cx="300" cy="1080" rx="70" ry="380" />
          <path d="M-100 760 Q300 735 700 760 M-100 820 Q300 795 700 820" />
        </g>

        <g
          className="login-backdrop__route"
          fill="none"
          strokeOpacity="0.24"
          strokeWidth="1.2"
          strokeLinecap="round"
        >
          <path d="M56 70 Q200 300 250 770" />
          <path d="M330 48 Q420 400 250 770" />
          <path d="M350 140 Q300 500 250 770" />
          <path d="M44 735 Q140 830 250 770" />
        </g>
        <g fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray="10 900">
          <path className="login-backdrop__pulse login-backdrop__pulse--deham" d="M56 70 Q200 300 250 770" />
          <path className="login-backdrop__pulse login-backdrop__pulse--cnsha" d="M330 48 Q420 400 250 770" />
          <path className="login-backdrop__pulse login-backdrop__pulse--ushou" d="M44 735 Q140 830 250 770" />
        </g>

        <g className="login-backdrop__star" fillOpacity="0.28">
          <circle cx="150" cy="40" r="2.2" />
          <circle cx="230" cy="110" r="2.2" />
          <circle cx="24" cy="150" r="2.2" />
          <circle cx="140" cy="812" r="2.2" />
        </g>

        <g className="login-backdrop__labels" fontSize="10" letterSpacing="1.1">
          <g transform="translate(56 70)">
            <circle className="login-backdrop__node-ring" r="8" fill="none" strokeOpacity="0.4" />
            <circle className="login-backdrop__node" r="3.5" />
            <text className="login-backdrop__label" x="14" y="4" fillOpacity="0.7">
              <tspan fontWeight="700">DEHAM</tspan>
              <tspan fillOpacity="0.75">{' · Hamburgo'}</tspan>
            </text>
          </g>
          <g transform="translate(330 48)">
            <circle className="login-backdrop__node-ring" r="8" fill="none" strokeOpacity="0.4" />
            <circle className="login-backdrop__node" r="3.5" />
            <text className="login-backdrop__label" x="-14" y="4" textAnchor="end" fillOpacity="0.7">
              <tspan fontWeight="700">CNSHA</tspan>
            </text>
          </g>
          <g transform="translate(350 140)">
            <circle className="login-backdrop__node-ring" r="8" fill="none" strokeOpacity="0.4" />
            <circle className="login-backdrop__node" r="3.5" />
            <text className="login-backdrop__label" x="-14" y="4" textAnchor="end" fillOpacity="0.7">
              <tspan fontWeight="700">INNSA</tspan>
            </text>
          </g>
          <g transform="translate(44 735)">
            <circle className="login-backdrop__node-ring" r="8" fill="none" strokeOpacity="0.4" />
            <circle className="login-backdrop__node" r="3.5" />
            <text className="login-backdrop__label" x="14" y="-10" fillOpacity="0.7">
              <tspan fontWeight="700">USHOU</tspan>
            </text>
          </g>
          <g transform="translate(250 770)">
            <circle className="login-backdrop__dest-ring" r="7" fill="none" strokeWidth="1.5" />
            <circle className="login-backdrop__dest-halo" r="11" fill="none" strokeOpacity="0.45" />
            <circle className="login-backdrop__dest-core" r="5" />
            <text className="login-backdrop__label" x="-18" y="28" textAnchor="end" fillOpacity="0.8">
              <tspan fontWeight="700">BRSSZ</tspan>
              <tspan fillOpacity="0.75">{' · Santos'}</tspan>
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}
