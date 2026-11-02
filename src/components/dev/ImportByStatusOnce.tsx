import { useEffect, useRef } from 'react';
import { tryParseMorganStanleyByStatusFile } from '../../lib/parsers/morganStanleyByStatus';
import { usePortfolioStore } from '../../store/portfolioStore';

const FLAG = 'ep_imported_bystatus_v2';
const FIXTURE = '/fixtures/ByStatus_expanded.xlsx';

/**
 * DEV helper: once per browser profile, import the Morgan Stanley By Status fixture so
 * Dashboard sellable/vested numbers match the portal without a manual re-upload.
 */
export function ImportByStatusOnce() {
  const ran = useRef(false);
  const { setPendingGrants, setPendingSession, importPendingGrants, loadPortfolio } =
    usePortfolioStore();

  useEffect(() => {
    if (!import.meta.env.DEV || ran.current) return;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(FLAG) === '1') return;
    ran.current = true;

    void (async () => {
      try {
        const res = await fetch(FIXTURE);
        if (!res.ok) return;
        const blob = await res.blob();
        const file = new File([blob], 'ByStatus_expanded.xlsx', {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const grants = await tryParseMorganStanleyByStatusFile(file, file.name);
        if (!grants?.length) return;

        setPendingGrants(grants);
        setPendingSession({
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          documentIds: [],
          grantIds: grants.map((g) => g.id),
          status: 'review',
        });
        await importPendingGrants();
        await loadPortfolio();
        localStorage.setItem(FLAG, '1');
        console.info(
          `[EquityLens] Imported ${grants.length} grants from ByStatus fixture (sellable ≠ vested).`,
        );
      } catch (err) {
        console.warn('[EquityLens] ByStatus fixture import skipped:', err);
      }
    })();
  }, [setPendingGrants, setPendingSession, importPendingGrants, loadPortfolio]);

  return null;
}
