import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// findBy*/waitFor resolvem no PRIMEIRO sucesso (polling 50 ms + MutationObserver); o timeout so define
// quanto esperar antes de declarar FALHA. Sob CPU saturada (varios processos vitest) o default de
// 1000 ms estoura de forma intermitente. Falha real continua falhando, com a mesma mensagem
// descritiva do Testing Library; so muda a janela de espera.
configure({ asyncUtilTimeout: 5000 });

// Medido em `web/` com o jsdom instalado pelo passo 2 (jsdom@29.1.1):
//   node --input-type=module -e "import {JSDOM} from 'jsdom'; const d=new JSDOM('<dialog id=x></dialog>');
//   const el=d.window.document.getElementById('x'); try { el.showModal(); console.log('NATIVO ok, open=', el.open); }
//   catch (e) { console.log('STUB NECESSARIO:', e.message); }"
// Saída: "STUB NECESSARIO: el.showModal is not a function" — jsdom@29.1.1 não implementa
// HTMLDialogElement.prototype.showModal/close. Stub mínimo abaixo, fiel só ao que Modal.tsx usa:
// showModal()/show() abrem, close() fecha e dispara o evento 'close'. Sem top layer, sem
// ::backdrop, sem inert — nenhum teste deste plano depende deles.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};

HTMLDialogElement.prototype.show = function (this: HTMLDialogElement) {
  this.open = true;
};

HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event('close'));
};

afterEach(() => {
  cleanup();
});
