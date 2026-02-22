import React from 'react';
import PortalFeature from '../features/portal/Portal';

export default function Portal() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <PortalFeature />
      <div className="footer" style={{ padding: '32px 24px', fontSize: '0.76rem', borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
        <a href="/" style={{ color: 'var(--text-mid)' }}>Workflow Partners</a> · Technology-agnostic workflow optimisation
      </div>
    </div>
  );
}
