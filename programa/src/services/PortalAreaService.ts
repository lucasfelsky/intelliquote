// Area do usuario no Portal COMEX (Firestore `users/{uid}.area`).
// Usada no login Firebase: Area Comercial promove o usuario (claim `user`) para `comercial`.
// Qualquer falha na leitura = comportamento anterior (nunca derruba o login).
// Recebe o `App` por parametro para nao criar import circular com middlewares/firebaseAuth.

import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from '../lib/logger';
import {
  resolveFirebaseLoginRole,
  shouldLookupPortalArea,
  type UserRole,
} from '../constants/roles';

export const PORTAL_AREA_TIMEOUT_MS = 2000;

function normalizeComparableText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Mesma regra `isCommercialArea` do Portal (`src/lib/intelliquote.js`); nao-string nunca casa. */
export function isCommercialArea(area: unknown): boolean {
  if (typeof area !== 'string') return false;
  const n = normalizeComparableText(area).trim().replace(/\s+/g, ' ');
  return n === 'comercial' || n.startsWith('comercial ');
}

const TIMEOUT = Symbol('portal-area-timeout');

/** Le `users/{uid}.area`. Devolve `null` em qualquer falha, timeout, doc ou campo ausente. */
export async function fetchPortalArea(
  app: App,
  uid: string,
  timeoutMs: number = PORTAL_AREA_TIMEOUT_MS,
): Promise<string | null> {
  if (typeof uid !== 'string' || !uid) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = getFirestore(app).collection('users').doc(uid).get();
    // Evita unhandled rejection se a leitura rejeitar depois de o timeout vencer.
    read.catch(() => undefined);

    const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
    });

    const result = await Promise.race([read, timeoutPromise]);
    if (result === TIMEOUT) {
      logger.warn({ uid, reason: 'timeout', timeoutMs }, 'Leitura da Area do Portal excedeu o timeout');
      return null;
    }

    if (!result.exists) return null;
    const area = result.get('area');
    return typeof area === 'string' ? area : null;
  } catch (err) {
    // Ler `code` num try proprio: um getter que lanca nao pode escapar do catch.
    let code: unknown = null;
    try {
      code = (err as { code?: unknown })?.code ?? null;
    } catch {
      code = null;
    }
    logger.warn({ uid, reason: 'error', code }, 'Falha ao ler a Area do Portal');
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Papel efetivo no login Firebase considerando a Area do Portal. Nunca lanca. */
export async function resolveFirebaseLoginRoleWithArea(input: {
  app: App;
  uid: string;
  rawClaim: unknown;
  claimRole: UserRole;
  currentRole: string | null;
  /** O middleware global ja aplicou a Area neste request: nao le o Firestore de novo. */
  skipAreaLookup?: boolean;
}): Promise<UserRole> {
  const { app, uid, rawClaim, claimRole, currentRole, skipAreaLookup } = input;
  try {
    const portalCommercial =
      !skipAreaLookup && shouldLookupPortalArea({ rawClaim, currentRole })
        ? isCommercialArea(await fetchPortalArea(app, uid))
        : false;
    return resolveFirebaseLoginRole({ claimRole, currentRole, portalCommercial });
  } catch (err) {
    logger.warn({ uid, reason: 'resolve-error' }, 'Falha ao resolver o papel com a Area do Portal');
    return resolveFirebaseLoginRole({ claimRole, currentRole });
  }
}
