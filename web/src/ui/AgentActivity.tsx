import { useEffect, useState } from 'react';
import { readAgentActivity, undoActivity } from '../agent/actions';
import type { AgentActivity as Activity } from '../agent/protocol';

const STATUS: Record<Activity['status'], string> = {
  confirmed: 'confirmée', refused: 'refusée', undone: 'annulée', conflict: 'conflit', error: 'erreur',
};

export function AgentActivity({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<Activity[]>(readAgentActivity);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const refresh = () => setItems(readAgentActivity());
    window.addEventListener('foodrecorder-agent-activity', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('foodrecorder-agent-activity', refresh); window.removeEventListener('storage', refresh); };
  }, []);
  const visible = compact ? items.slice(0, 8) : items;
  return <div className={compact ? 'agent-activity compact' : 'panel agent-activity'} data-agent-section="activite-agent">
    {!compact && <><h2>Activité de l’agent</h2><p className="small">Écritures confirmées, refus, conflits et annulations. Conservée séparément du journal nutritionnel.</p></>}
    {!visible.length ? <p className="small">Aucune action enregistrée.</p> : visible.map((item) => <div className="agent-activity-row" key={item.id}>
      <div><strong>{item.tool}</strong> · {STATUS[item.status]} <small>{new Date(item.at).toLocaleString('fr-FR')}</small></div>
      <div className="small">{item.preview}</div>
      {item.error && <div className="small tool-error">{item.error}</div>}
      {item.status === 'confirmed' && item.undoable && <button className="ghost small" onClick={() => { const result = undoActivity(item.id); setNotice(result.message); setItems(readAgentActivity()); }}>Annuler cette action</button>}
    </div>)}
    {notice && <div className="status">{notice}</div>}
  </div>;
}
